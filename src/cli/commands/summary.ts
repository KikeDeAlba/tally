import { FILTER_OPTIONS, BASE_OPTIONS, RANGE_OPTIONS, parseCommandArgs, readBoolean, readEstimateStepSeconds, readInteger, readRegistrationFilter, readString } from '../args.ts'
import { bitaRangeArgs } from '../range.ts'
import { renderTable } from '../table.ts'
import { successEnvelope, writeErr, writeJson, writeOut } from '../output.ts'
import { MAX_TASK_SECONDS } from '../../constants.ts'
import { UsageError } from '../../errors.ts'
import { groupEntries } from '../../domain/group.ts'
import { formatDuration } from '../../domain/duration.ts'
import { collectEntries } from '../../domain/collect.ts'
import { applyRegistrations, expandSegments } from '../../domain/expand.ts'
import { partitionByJira, summarizeNonJira } from '../../domain/no-jira.ts'
import { emptyDocs, loadSummaryDocs, parseNotesMode, type LoadedDocs } from '../../domain/notes.ts'
import type { RegistrationFilter } from '../../domain/filter.ts'
import type { TaskGroup } from '../../domain/types.ts'
import { requireBita, type BitaEntries, type BitaEntry } from '../../integrations/bita.ts'
import { findNotesProvider } from '../../integrations/inkwell.ts'
import { openDatabase } from '../../db/open.ts'
import { countRegistrations, countsAsRegistered, registrationsFor } from '../../db/registrations.ts'
import { jiraTarget, projectGoesToJira, readConfig, storyThemes, type TallyConfig } from '../../state/config.ts'

const SUMMARY_OPTIONS = {
  'case-insensitive': { type: 'boolean' as const, default: false },
  'max-task-hours': { type: 'string' as const },
  'estimate-step-minutes': { type: 'string' as const },
  'no-notes': { type: 'boolean' as const, default: false },
  'notes-mode': { type: 'string' as const },
  'notes-budget-kb': { type: 'string' as const },
  brief: { type: 'boolean' as const, default: false },
}

export interface SummaryOptions {
  filter: RegistrationFilter
  includeRunning: boolean
  maxTaskSeconds: number
  estimateStepSeconds?: number
  caseInsensitive: boolean
  now: Date
}

export interface SummaryInput {
  bita: BitaEntries
  registrations: Parameters<typeof applyRegistrations>[1]
  hasRegistrations: boolean
  config: TallyConfig
  docs?: (entryIds: number[]) => Promise<LoadedDocs>
  rangeWarnings?: string[]
}

export interface MergeConflict {
  entryId: number
  description: string
  issues: string[]
  registeredEntryIds: number[]
  pendingEntryIds: number[]
}

export function mergeConflicts(entries: readonly BitaEntry[], registrations: SummaryInput['registrations']): MergeConflict[] {
  const conflicts: MergeConflict[] = []
  for (const entry of entries) {
    if (entry.segments.length === 0) continue
    const blocks = entry.segments.map((segment) => segment.entryId)
    const registered = blocks.filter((id) => countsAsRegistered(registrations.get(id)))
    if (registered.length === 0) continue
    const issues = [...new Set(registered.map((id) => registrations.get(id)?.issueKey ?? '').filter((key) => key.length > 0))]
    const pending = blocks.filter((id) => !countsAsRegistered(registrations.get(id)))
    if (issues.length > 1 || pending.length > 0) {
      conflicts.push({ entryId: entry.id, description: entry.description, issues, registeredEntryIds: registered, pendingEntryIds: pending })
    }
  }
  return conflicts
}

export async function buildSummary(input: SummaryInput, options: SummaryOptions) {
  const timezone = input.bita.range.timezone
  const config = input.config
  const entries = input.bita.entries.map((entry) => ({ ...entry, jira: projectGoesToJira(config, entry.projectId, entry.jira) }))
  const expanded = applyRegistrations(expandSegments(entries, timezone), input.registrations)
  const conflicts = mergeConflicts(entries, input.registrations)
  const result = collectEntries(expanded, {
    filter: options.filter,
    includeRunning: options.includeRunning,
    requireDescription: true,
    requireProject: false,
    now: options.now,
  })
  const warnings = [...(input.rangeWarnings ?? []), ...result.warnings]
  for (const conflict of conflicts) {
    warnings.push(`Merged entry #${conflict.entryId} "${conflict.description}" has blocks registered in ${conflict.issues.join(', ') || 'Jira'}${conflict.pendingEntryIds.length > 0 ? ` and ${conflict.pendingEntryIds.length} pending` : ''}; check them before uploading.`)
  }

  if (!input.hasRegistrations && input.bita.entries.some((entry) => entry.bitaRegistered)) {
    warnings.push('tally has no registrations yet while bita still reports registered entries. Run "tally migrate --from-bita".')
  }

  const groups: TaskGroup[] = groupEntries(result.selected, {
    timezone,
    maxTaskSeconds: options.maxTaskSeconds,
    caseInsensitive: options.caseInsensitive,
    ...(options.estimateStepSeconds !== undefined ? { estimateStepSeconds: options.estimateStepSeconds } : {}),
  })

  const allEntryIds = groups.flatMap((group) => group.entryIds)
  const loaded = input.docs ? await input.docs(allEntryIds) : emptyDocs()
  const hasNote = (id: number) => loaded.byEntry.has(id) || loaded.pagesByEntry.has(id)
  const missingNotes = loaded.provider === null ? [] : allEntryIds.filter((id) => !hasNote(id))

  const withMapping = groups.map((group) => {
    const mapping = group.projectId === null ? undefined : config.projectMapping[String(group.projectId)]
    return {
      ...group,
      ...jiraTarget(mapping, config.jira?.site ?? null),
      jiraStoryIssueTypeName: mapping?.storyIssueTypeName ?? 'Historia',
      jiraWorkIssueTypeName: mapping?.workIssueTypeName ?? 'Subtarea',
      jiraIssueTypeName: mapping?.issueTypeName ?? config.defaults?.issueTypeName ?? null,
      docs: group.entryIds.flatMap((id) => loaded.byEntry.get(id) ?? []),
      pages: [...new Map(group.entryIds.flatMap((id) => (loaded.pagesByEntry.get(id) ?? []).map((page) => [page.pageId, page] as const))).values()],
      touchedFiles: [] as string[],
      noteCoverage: {
        withNote: group.entryIds.filter(hasNote).length,
        withoutNote: group.entryIds.filter((id) => !hasNote(id)).length,
      },
    }
  })

  const unmappedProjects = [
    ...new Map(
      withMapping
        .filter((group) => group.jira && group.projectId !== null && group.jiraProjectKey === null)
        .map((group) => [group.projectId, { projectId: group.projectId, projectName: group.projectName }]),
    ).values(),
  ]

  const totalSeconds = groups.reduce((sum, group) => sum + group.totalSeconds, 0)
  const jiraSeconds = groups.filter((group) => group.jira).reduce((sum, group) => sum + group.totalSeconds, 0)
  const nonJira = summarizeNonJira([...result.nonJira, ...partitionByJira(result.selected).nonJira])
  const splitCount = groups.filter((group) => group.partCount > 1).length
  if (splitCount > 0) warnings.push(`${splitCount} tasks were split to stay under the ${options.maxTaskSeconds / 3600}h per-task cap.`)

  return {
    data: {
      totalSeconds,
      totalHuman: formatDuration(totalSeconds),
      jiraSeconds,
      jiraHuman: formatDuration(jiraSeconds),
      nonJiraSeconds: nonJira.totalSeconds,
      nonJiraHuman: formatDuration(nonJira.totalSeconds),
      groups: withMapping,
    },
    meta: {
      range: { fromDay: input.bita.range.fromDay, toDay: input.bita.range.toDay, timezone },
      filter: result.filter,
      jira: config.jira ?? null,
      storyThemes: storyThemes(config),
      entryCount: result.selected.length,
      groupCount: groups.length,
      maxTaskSeconds: options.maxTaskSeconds,
      excluded: result.excluded,
      alreadyRegistered: result.alreadyRegistered,
      overlaps: result.overlaps,
      unmappedProjects,
      nonJira,
      conflicts,
      notes: {
        provider: loaded.provider,
        matched: loaded.byEntry.size,
        missing: missingNotes,
        missingFiles: loaded.missingFiles,
        inlinedBytes: loaded.inlinedBytes,
        truncatedEntryIds: loaded.truncatedEntryIds,
      },
      warnings,
    },
  }
}

type Summary = Awaited<ReturnType<typeof buildSummary>>
type SummaryGroup = Summary['data']['groups'][number]

function briefProject(group: SummaryGroup) {
  return {
    projectName: group.projectName,
    jiraProjectKey: group.jiraProjectKey,
    jiraSite: group.jiraSite,
    epicMode: group.epicMode,
    hierarchy: group.hierarchy,
    jiraEpicKey: group.jiraEpicKey,
    epicResolved: group.epicResolved,
    jiraBoardId: group.jiraBoardId,
    ...(group.epicMode === 'per-run' ? { jiraStoriesByEpic: group.jiraStoriesByEpic } : { jiraStories: group.jiraStories }),
    jiraStoryIssueTypeName: group.jiraStoryIssueTypeName,
    jiraWorkIssueTypeName: group.jiraWorkIssueTypeName,
    jiraIssueTypeName: group.jiraIssueTypeName,
  }
}

function briefGroup(group: SummaryGroup) {
  return {
    summary: group.summary,
    projectId: group.projectId,
    jira: group.jira,
    kind: group.kind,
    ...(group.issueKey !== null ? { issueKey: group.issueKey } : {}),
    totalHuman: group.totalHuman,
    estimateHuman: group.estimateHuman,
    days: group.days,
    entryIds: group.entryIds,
    worklogs: group.worklogs.map((worklog) => ({ entryId: worklog.entryId, startedJira: worklog.startedJira, startLocal: worklog.startLocal, timeSpent: worklog.timeSpent })),
    ...(group.partCount > 1 ? { part: { index: group.partIndex, count: group.partCount } } : {}),
    ...(group.meetings && group.meetings.length > 0 ? { meetings: group.meetings } : {}),
    docs: group.docs.map((doc) => ({ entryId: doc.entryId, path: doc.path, sections: doc.sections, markdown: doc.markdown, ...(doc.truncated ? { truncated: true } : {}), ...(doc.missing ? { missing: true } : {}) })),
    pages: group.pages.map((page) => ({ pageId: page.pageId, title: page.title, issues: page.issues })),
  }
}

export function briefSummary(summary: Summary) {
  const { data, meta } = summary
  const projects: Record<string, ReturnType<typeof briefProject>> = {}
  for (const group of data.groups) {
    if (group.projectId !== null && group.jira) projects[String(group.projectId)] ??= briefProject(group)
  }
  return {
    data: {
      totalHuman: data.totalHuman,
      jiraHuman: data.jiraHuman,
      nonJiraHuman: data.nonJiraHuman,
      groups: data.groups.map(briefGroup),
      projects,
    },
    meta: {
      range: meta.range,
      groupCount: meta.groupCount,
      entryCount: meta.entryCount,
      excluded: meta.excluded.map((entry) => ({ id: entry.id, description: entry.description, projectName: entry.projectName, localDay: entry.localDay, durationHuman: entry.durationHuman, reason: entry.reason })),
      alreadyRegistered: meta.alreadyRegistered.count,
      overlaps: meta.overlaps,
      unmappedProjects: meta.unmappedProjects,
      nonJira: { totalHuman: meta.nonJira.totalHuman, projects: meta.nonJira.projects.map((project) => ({ id: project.id, name: project.name, totalHuman: project.totalHuman })) },
      conflicts: meta.conflicts,
      notes: { provider: meta.notes.provider, missing: meta.notes.missing, truncatedEntryIds: meta.notes.truncatedEntryIds },
      warnings: meta.warnings,
    },
  }
}

export async function runSummary(argv: readonly string[], command = 'summary'): Promise<number> {
  const args = parseCommandArgs(argv, SUMMARY_OPTIONS, { ...BASE_OPTIONS, ...RANGE_OPTIONS, ...FILTER_OPTIONS })
  const config = await readConfig()
  const filter = readRegistrationFilter(args)
  const range = bitaRangeArgs(args, new Date(), typeof config.timezone === 'string' ? config.timezone : undefined)
  const bita = await requireBita()
  const fetched = await bita.entries(range.args)

  const db = openDatabase()
  let registrations
  let hasRegistrations
  try {
    const ids = fetched.entries.flatMap((entry) => [entry.id, ...entry.segments.map((segment) => segment.entryId)])
    registrations = registrationsFor(db, ids)
    hasRegistrations = countRegistrations(db) > 0
  } finally {
    db.close()
  }

  const maxTaskHours = readInteger(args, 'max-task-hours')
  if (maxTaskHours !== undefined && maxTaskHours < 1) throw new UsageError(`--max-task-hours must be 1 or more, got ${maxTaskHours}.`)
  const maxTaskSeconds = maxTaskHours === undefined ? MAX_TASK_SECONDS : maxTaskHours * 3600
  const estimateStepSeconds = readEstimateStepSeconds(args)
  const skipNotes = readBoolean(args, 'no-notes')
  const budgetKb = readInteger(args, 'notes-budget-kb')
  const provider = skipNotes ? null : await findNotesProvider()

  const summary = await buildSummary(
    {
      bita: fetched,
      registrations,
      hasRegistrations,
      config,
      rangeWarnings: range.warnings,
      ...(provider
        ? {
            docs: (ids: number[]) =>
              loadSummaryDocs(provider, ids, {
                mode: parseNotesMode(readString(args, 'notes-mode')),
                ...(budgetKb === undefined ? {} : { budgetBytes: budgetKb * 1024 }),
              }),
          }
        : {}),
    },
    {
      filter,
      includeRunning: readBoolean(args, 'include-running'),
      maxTaskSeconds,
      ...(estimateStepSeconds === undefined ? {} : { estimateStepSeconds }),
      caseInsensitive: readBoolean(args, 'case-insensitive'),
      now: new Date(),
    },
  )

  const { data, meta } = summary
  if (readBoolean(args, 'json')) {
    if (readBoolean(args, 'brief')) {
      const brief = briefSummary(summary)
      writeJson(successEnvelope(command, brief.data, brief.meta))
    } else {
      writeJson(successEnvelope(command, data, meta))
    }
    for (const warning of meta.warnings) writeErr(`Warning: ${warning}`)
    return 0
  }

  writeOut(
    renderTable(
      [
        { header: 'PROJECT' },
        { header: 'JIRA' },
        { header: 'PARENT' },
        { header: 'SUMMARY' },
        { header: 'DAYS' },
        { header: 'LOGS', align: 'right' },
        { header: 'TIME', align: 'right' },
        { header: 'EST', align: 'right' },
      ],
      data.groups.map((group) => [
        group.projectName ?? '(no project)',
        group.jira ? (group.jiraProjectKey ?? '?') : 'never',
        group.jiraParentKey ?? (group.epicMode === 'per-run' ? '(board)' : ''),
        group.summary,
        group.days.length === 1 ? (group.days[0] ?? '') : `${group.days[0]} .. ${group.days.at(-1)}`,
        String(group.worklogs.length),
        group.totalHuman,
        group.estimateHuman,
      ]),
    ),
  )
  writeOut('')
  writeOut(`${data.groups.length} tasks, ${meta.entryCount} entries, ${data.totalHuman} total.`)

  if (meta.nonJira.entryCount > 0) {
    writeOut('')
    writeOut(`Outside Jira: ${meta.nonJira.totalHuman} (${meta.nonJira.projects.map((project) => `${project.name ?? '(no project)'} ${project.totalHuman}`).join(', ')}), never uploaded.`)
  }

  if (meta.excluded.length > 0) {
    writeOut('')
    writeOut('Excluded:')
    const byReason = new Map<string, number>()
    for (const entry of meta.excluded) byReason.set(entry.reason, (byReason.get(entry.reason) ?? 0) + 1)
    for (const [reason, count] of byReason) writeOut(`  ${count} ${reason}`)
  }

  if (meta.unmappedProjects.length > 0) {
    writeOut('')
    writeOut('Projects without a Jira project mapped:')
    for (const project of meta.unmappedProjects) writeOut(`  ${project.projectId}  ${project.projectName ?? '(unnamed)'}`)
  }

  for (const warning of meta.warnings) writeErr(`Warning: ${warning}`)
  return 0
}
