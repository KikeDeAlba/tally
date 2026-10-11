import { BASE_OPTIONS, RANGE_OPTIONS, parseCommandArgs, readBoolean, readEstimateStepSeconds, readString } from '../args.ts'
import { bitaRangeArgs } from '../range.ts'
import { renderTable } from '../table.ts'
import { successEnvelope, writeErr, writeJson, writeOut } from '../output.ts'
import { ESTIMATE_STEP_SECONDS } from '../../constants.ts'
import { formatDuration } from '../../domain/duration.ts'
import { groupEntries } from '../../domain/group.ts'
import type { EnrichedTimeEntry } from '../../domain/types.ts'
import { exclusionReason, type ExclusionReason } from '../../domain/collect.ts'
import { applyRegistrations, expandSegments } from '../../domain/expand.ts'
import { findProject, projectNotFound, requireBita, type BitaEntries, type BitaProject } from '../../integrations/bita.ts'
import { describeOverlap, findOverlaps } from '../../domain/overlap.ts'
import { mergeConflicts } from './summary.ts'
import { openDatabase } from '../../db/open.ts'
import { countRegistrations, registrationsFor, type Registration } from '../../db/registrations.ts'
import { projectGoesToJira, readConfig, type TallyConfig } from '../../state/config.ts'

const STATUS_OPTIONS = {
  project: { type: 'string' as const },
  entries: { type: 'boolean' as const, default: false },
  'include-running': { type: 'boolean' as const, default: false },
  'estimate-step-minutes': { type: 'string' as const },
}

export interface StatusTotals {
  registeredSeconds: number
  pendingSeconds: number
  excludedSeconds: number
  nonJiraSeconds: number
}

export interface StatusEstimate {
  estimateSeconds: number
}

export interface StatusProject extends StatusTotals, StatusEstimate {
  projectId: number | null
  name: string | null
  jira: boolean
}

export interface StatusEntry {
  entryId: number
  registered: boolean
  issueKey: string | null
  jira: boolean
  excludedReason: ExclusionReason | null
  projectId: number | null
  localDay: string
  seconds: number
}

export interface StatusInput {
  bita: BitaEntries
  registrations: ReadonlyMap<number, Registration>
  hasRegistrations: boolean
  config: TallyConfig
  projectId?: number | null
  rangeWarnings?: string[]
}

export interface StatusOptions {
  includeRunning: boolean
  withEntries: boolean
  now: Date
  estimateStepSeconds?: number
}

function emptyTotals(): StatusTotals {
  return { registeredSeconds: 0, pendingSeconds: 0, excludedSeconds: 0, nonJiraSeconds: 0 }
}

function bucket(entry: StatusEntry): keyof StatusTotals {
  if (entry.registered) return 'registeredSeconds'
  if (entry.excludedReason !== null) return 'excludedSeconds'
  if (!entry.jira) return 'nonJiraSeconds'
  return 'pendingSeconds'
}

export function buildStatus(input: StatusInput, options: StatusOptions) {
  const timezone = input.bita.range.timezone
  const config = input.config
  const scoped = input.projectId === undefined ? input.bita.entries : input.bita.entries.filter((entry) => entry.projectId === input.projectId)
  const withJira = scoped.map((entry) => ({ ...entry, jira: projectGoesToJira(config, entry.projectId, entry.jira) }))
  const expanded = applyRegistrations(expandSegments(withJira, timezone), input.registrations)
  const rules = { includeRunning: options.includeRunning, requireDescription: true, requireProject: false }

  const totals: StatusTotals & StatusEstimate = { ...emptyTotals(), estimateSeconds: 0 }
  const countable: EnrichedTimeEntry[] = []
  const byProject = new Map<number | null, StatusProject>()
  const entries: StatusEntry[] = []
  for (const source of expanded) {
    const registered = source.registered
    const reason = registered ? null : exclusionReason(source, source.jira ? rules : { ...rules, requireDescription: false })
    const entry: StatusEntry = {
      entryId: source.id,
      registered,
      issueKey: registered ? source.issueKey : null,
      jira: source.jira,
      excludedReason: reason,
      projectId: source.projectId,
      localDay: source.localDay,
      seconds: source.durationSeconds,
    }
    entries.push(entry)
    if (exclusionReason(source, rules) === null) countable.push(source)
    const key = bucket(entry)
    totals[key] += entry.seconds
    let project = byProject.get(entry.projectId)
    if (!project) {
      project = { projectId: entry.projectId, name: source.projectName, jira: false, ...emptyTotals(), estimateSeconds: 0 }
      byProject.set(entry.projectId, project)
    }
    project.jira ||= entry.jira
    project[key] += entry.seconds
  }

  const estimateStepSeconds = options.estimateStepSeconds ?? ESTIMATE_STEP_SECONDS
  for (const group of groupEntries(countable, { timezone, estimateStepSeconds })) {
    byProject.get(group.projectId)!.estimateSeconds += group.estimateSeconds
    totals.estimateSeconds += group.estimateSeconds
  }

  const total = (item: StatusTotals) => item.registeredSeconds + item.pendingSeconds + item.excludedSeconds + item.nonJiraSeconds
  const projects = [...byProject.values()].sort((a, b) => total(b) - total(a) || (a.name ?? '').localeCompare(b.name ?? ''))

  const running = expanded.filter((entry) => entry.running)
  const runningSeconds = running.reduce((sum, entry) => sum + entry.durationSeconds, 0)
  const warnings = [...(input.rangeWarnings ?? [])]
  if (running.length > 0 && !options.includeRunning) warnings.push(`${running.length} running entries (${formatDuration(runningSeconds)}) were counted as excluded; pass --include-running to count them.`)
  for (const conflict of mergeConflicts(withJira, input.registrations)) {
    warnings.push(`Merged entry #${conflict.entryId} "${conflict.description}" has blocks registered in ${conflict.issues.join(', ') || 'Jira'}${conflict.pendingEntryIds.length > 0 ? ` and ${conflict.pendingEntryIds.length} pending` : ''}; check them before uploading.`)
  }
  for (const overlap of findOverlaps(expanded, options.now)) warnings.push(describeOverlap(overlap))
  if (!input.hasRegistrations && input.bita.entries.some((entry) => entry.bitaRegistered)) {
    warnings.push('tally has no registrations yet while bita still reports registered entries. Run "tally migrate --from-bita".')
  }

  return {
    data: {
      projects,
      totals,
      ...(options.withEntries ? { entries } : {}),
    },
    meta: {
      range: { fromDay: input.bita.range.fromDay, toDay: input.bita.range.toDay, timezone },
      projectId: input.projectId ?? null,
      entryCount: entries.length,
      runningSeconds,
      includeRunning: options.includeRunning,
      estimateStepMinutes: estimateStepSeconds / 60,
      warnings,
    },
  }
}

export function resolveProjectRef(ref: string, entries: BitaEntries['entries'], projects: readonly BitaProject[]): number | null {
  const project = findProject(projects, ref)
  if (project) return project.id
  const wanted = ref.toLowerCase()
  const entry = entries.find((candidate) => candidate.projectId !== null && (String(candidate.projectId) === ref || (candidate.projectName ?? '').toLowerCase() === wanted))
  if (entry) return entry.projectId
  throw projectNotFound(ref)
}

export async function runStatus(argv: readonly string[]): Promise<number> {
  const args = parseCommandArgs(argv, STATUS_OPTIONS, { ...BASE_OPTIONS, ...RANGE_OPTIONS })
  const estimateStepSeconds = readEstimateStepSeconds(args)
  const config = await readConfig()
  const range = bitaRangeArgs(args, new Date(), typeof config.timezone === 'string' ? config.timezone : undefined)
  const bita = await requireBita()
  const fetched = await bita.entries(range.args)

  const projectRef = readString(args, 'project')
  const projectId = projectRef === undefined ? undefined : resolveProjectRef(projectRef, fetched.entries, await bita.projects())

  const db = openDatabase()
  let registrations
  let hasRegistrations
  try {
    registrations = registrationsFor(db, fetched.entries.flatMap((entry) => [entry.id, ...entry.segments.map((segment) => segment.entryId)]))
    hasRegistrations = countRegistrations(db) > 0
  } finally {
    db.close()
  }

  const status = buildStatus(
    { bita: fetched, registrations, hasRegistrations, config, rangeWarnings: range.warnings, ...(projectId === undefined ? {} : { projectId }) },
    { includeRunning: readBoolean(args, 'include-running'), withEntries: readBoolean(args, 'entries'), now: new Date(), ...(estimateStepSeconds === undefined ? {} : { estimateStepSeconds }) },
  )

  const { data, meta } = status
  if (readBoolean(args, 'json')) {
    writeJson(successEnvelope('status', data, meta))
    for (const warning of meta.warnings) writeErr(`Warning: ${warning}`)
    return 0
  }

  const human = (seconds: number) => (seconds === 0 ? '-' : formatDuration(seconds))
  writeOut(
    renderTable(
      [
        { header: 'PROJECT' },
        { header: 'JIRA' },
        { header: 'REGISTERED', align: 'right' },
        { header: 'PENDING', align: 'right' },
        { header: 'EXCLUDED', align: 'right' },
        { header: 'OUTSIDE JIRA', align: 'right' },
        { header: 'ESTIMATE', align: 'right' },
      ],
      data.projects.map((project) => [
        project.name ?? '(no project)',
        project.jira ? 'yes' : 'never',
        human(project.registeredSeconds),
        human(project.pendingSeconds),
        human(project.excludedSeconds),
        human(project.nonJiraSeconds),
        human(project.estimateSeconds),
      ]),
    ),
  )
  writeOut('')
  writeOut(
    `${meta.range.fromDay} .. ${meta.range.toDay}: ${formatDuration(data.totals.registeredSeconds)} registered, ${formatDuration(data.totals.pendingSeconds)} pending, ${formatDuration(data.totals.excludedSeconds)} excluded, ${formatDuration(data.totals.nonJiraSeconds)} outside Jira, ${formatDuration(data.totals.estimateSeconds)} estimated.`,
  )
  if (data.entries) {
    writeOut('')
    writeOut(
      renderTable(
        [{ header: 'ENTRY', align: 'right' }, { header: 'DAY' }, { header: 'TIME', align: 'right' }, { header: 'STATE' }],
        data.entries.map((entry) => [
          String(entry.entryId),
          entry.localDay,
          formatDuration(entry.seconds),
          !entry.jira ? 'outside Jira' : entry.registered ? (entry.issueKey ?? 'registered') : (entry.excludedReason ?? 'pending'),
        ]),
      ),
    )
  }
  for (const warning of meta.warnings) writeErr(`Warning: ${warning}`)
  return 0
}
