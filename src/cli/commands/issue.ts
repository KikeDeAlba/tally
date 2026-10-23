import { execFile } from 'node:child_process'
import { notify as kitNotify } from '@kikedealba/kit/platform'
import { existsSync, readFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_FLAT_ISSUE_TYPE, DEFAULT_START_DATE_FIELD, DEFAULT_WORK_ISSUE_TYPE } from '../../constants.ts'
import { ConflictError, NotFoundError, TallyError, UsageError } from '../../errors.ts'
import { inTransaction, openDatabase } from '../../db/open.ts'
import {
  claimEntry,
  findRegistration,
  listPendingOpens,
  markFilled,
  recentJiraProjects,
  register,
  releaseClaim,
  removePendingOpen,
  TIMER_SOURCE,
  type FilledBy,
  type PendingOpen,
  type Registration,
} from '../../db/registrations.ts'
import { meetingMode } from '../../domain/group.ts'
import { formatDuration } from '../../domain/duration.ts'
import { localDay, toLocalIso } from '../../domain/timezone.ts'
import { requireJiraWriter, type JiraTransition, type JiraWriter } from '../../integrations/atl.ts'
import { requireBita, type BitaClient, type BitaEntryDetail } from '../../integrations/bita.ts'
import { findNotesProvider, type NotesProvider } from '../../integrations/inkwell.ts'
import { NO_EPIC, projectGoesToJira, readConfig, setBoard, type ProjectMapping, type TallyConfig } from '../../state/config.ts'
import { parseCommandArgs, readBoolean, readString } from '../args.ts'
import { renderTable } from '../table.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'

const JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9]+$/
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]+-\d+$/
const CLAIM_POLL_MS = 500
const MAX_COMMITS = 30
const MAX_FILES = 20
const MAX_NOTE_CHARS = 8000

export interface IssueContext {
  db: DatabaseSync
  config: TallyConfig
  bita: BitaClient
  writer: (site?: string) => Promise<JiraWriter>
  now: Date
  timezone: string
  claimWaitMs?: number
}

export interface ProjectOption {
  jiraProjectKey: string
  projectNames: string[]
  site: string | null
  lastUsedAt: string | null
}

export interface StoryOption {
  themeId: string
  key: string
  summary: string
  epicKey: string | null
}

export interface OpenResult {
  entryId: number
  issueKey: string
  url: string | null
  created: boolean
  jiraProjectKey: string | null
  issueType: string | null
  parentKey: string | null
  sprint: { id: number; name: string } | null
  status: string | null
  warnings: string[]
}

export interface FillResult {
  entryId: number
  issueKey: string
  filledBy: FilledBy | null
  skipped: boolean
  reason: string | null
  summary: string | null
  description: string | null
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function projectOptions(config: TallyConfig, db: DatabaseSync): ProjectOption[] {
  const used = new Map(recentJiraProjects(db).map((item) => [item.jiraProjectKey, item.lastUsedAt]))
  const byKey = new Map<string, ProjectOption>()
  for (const mapping of Object.values(config.projectMapping)) {
    const option = byKey.get(mapping.jiraProjectKey) ?? { jiraProjectKey: mapping.jiraProjectKey, projectNames: [], site: mapping.site ?? null, lastUsedAt: used.get(mapping.jiraProjectKey) ?? null }
    if (mapping.projectName && !option.projectNames.includes(mapping.projectName)) option.projectNames.push(mapping.projectName)
    byKey.set(mapping.jiraProjectKey, option)
  }
  return [...byKey.values()].sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') || a.jiraProjectKey.localeCompare(b.jiraProjectKey))
}

export function storyOptions(mapping: ProjectMapping): StoryOption[] {
  return Object.entries(mapping.storiesByEpic ?? {}).flatMap(([epicKey, stories]) =>
    Object.entries(stories).map(([themeId, story]) => ({ themeId, key: story.key, summary: story.summary, epicKey: epicKey || null })),
  )
}

export function pickStory(mapping: ProjectMapping, kind: string | null): string | null {
  const stories = mapping.storiesByEpic?.[mapping.parentKey ?? NO_EPIC] ?? {}
  const preferred = meetingMode(kind) !== null ? 'sesiones' : 'soporte'
  return stories[preferred]?.key ?? Object.values(stories)[0]?.key ?? null
}

export function pickInProgress(transitions: readonly JiraTransition[]): JiraTransition | null {
  const candidates = transitions.filter((transition) => transition.category === 'indeterminate')
  return candidates.find((transition) => /progres|curso|doing/i.test(transition.to ?? transition.name)) ?? candidates[0] ?? null
}

function resolveMapping(config: TallyConfig, projectId: number | null, jiraProject: string | undefined): { mapping: ProjectMapping; own: boolean } | null {
  const own = projectId === null ? undefined : config.projectMapping[String(projectId)]
  if (jiraProject === undefined) return own ? { mapping: own, own: true } : null
  if (own && own.jiraProjectKey === jiraProject) return { mapping: own, own: true }
  const borrowed = Object.values(config.projectMapping).find((mapping) => mapping.jiraProjectKey === jiraProject)
  return { mapping: borrowed ?? { projectName: '', jiraProjectKey: jiraProject, hierarchy: 'flat-task' }, own: false }
}

export function wipSummary(entry: BitaEntryDetail, timezone: string): string {
  return entry.description.trim() || `[WIP] ${localDay(entry.startedAt, timezone)}`
}

function placeholderDescription(entry: BitaEntryDetail): string {
  return `_Tarjeta abierta al arrancar el cronómetro de bita (entrada #${entry.id}). La descripción se completa al pararlo._\n`
}

async function waitForRegistration(ctx: IssueContext, entryId: number): Promise<Registration | undefined> {
  const deadline = Date.now() + (ctx.claimWaitMs ?? 30_000)
  while (Date.now() < deadline) {
    const found = findRegistration(ctx.db, entryId)
    if (found?.issueKey) return found
    await new Promise((resolve) => setTimeout(resolve, CLAIM_POLL_MS))
  }
  return findRegistration(ctx.db, entryId)
}

function linkedResult(entryId: number, registration: Registration): OpenResult {
  return { entryId, issueKey: registration.issueKey ?? '', url: null, created: false, jiraProjectKey: registration.issueKey?.slice(0, registration.issueKey.lastIndexOf('-')) ?? null, issueType: null, parentKey: null, sprint: null, status: null, warnings: [] }
}

async function putInActiveSprint(ctx: IssueContext, writer: JiraWriter, mapping: ProjectMapping, projectId: number | null, own: boolean, issueKey: string, warnings: string[]): Promise<{ id: number; name: string } | null> {
  try {
    let boardId = mapping.boardId ?? null
    if (boardId === null) {
      const boards = await writer.boards(mapping.jiraProjectKey)
      if (boards.length !== 1) {
        warnings.push(boards.length === 0 ? `${mapping.jiraProjectKey} has no board; ${issueKey} stays in the backlog.` : `${mapping.jiraProjectKey} has ${boards.length} boards; pick one with "tally map board <projectId> <boardId>". ${issueKey} stays in the backlog.`)
        return null
      }
      boardId = boards[0]?.id ?? null
      if (boardId === null) return null
      if (own && projectId !== null) {
        await setBoard(projectId, boardId)
        mapping.boardId = boardId
      }
    }
    const sprints = await writer.activeSprints(boardId)
    const sprint = sprints[0]
    if (sprints.length !== 1 || !sprint) {
      warnings.push(sprints.length === 0 ? `Board ${boardId} has no active sprint; ${issueKey} stays in the backlog.` : `Board ${boardId} has ${sprints.length} active sprints; ${issueKey} stays in the backlog.`)
      return null
    }
    await writer.addToSprint(sprint.id, [issueKey])
    return { id: sprint.id, name: sprint.name }
  } catch (error) {
    warnings.push(`Could not put ${issueKey} in the active sprint: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

export async function openIssue(ctx: IssueContext, entryId: number, options: { jiraProject?: string; story?: string } = {}): Promise<OpenResult> {
  const existing = findRegistration(ctx.db, entryId)
  if (existing?.issueKey) return linkedResult(entryId, existing)

  const entry = await ctx.bita.entry(entryId)
  if (!entry) throw new NotFoundError(`No entry with id ${entryId} in bita.`, 'ENTRY_NOT_FOUND')

  const jiraProject = options.jiraProject?.toUpperCase()
  if (jiraProject !== undefined && !JIRA_KEY_PATTERN.test(jiraProject)) throw new UsageError(`Invalid Jira project key: "${options.jiraProject}". Expected something like DPF.`)
  if (entry.projectId !== null && jiraProject === undefined && !projectGoesToJira(ctx.config, entry.projectId)) {
    throw new ConflictError(`${entry.projectName ?? `Project ${entry.projectId}`} never goes to Jira.`, 'NOT_A_JIRA_PROJECT', 'tally project jira <project> on, or pass --jira-project KEY')
  }
  const resolved = resolveMapping(ctx.config, entry.projectId, jiraProject)
  if (!resolved) {
    throw new TallyError(`${entry.projectName ?? 'This entry'} has no Jira project mapped; say which one.`, 'NEEDS_PROJECT', {
      hint: `tally issue open ${entryId} --jira-project <KEY>`,
      exitCode: 4,
      data: { entryId, projectId: entry.projectId, projectName: entry.projectName, options: projectOptions(ctx.config, ctx.db) },
    })
  }
  const { mapping, own } = resolved
  const flat = (mapping.hierarchy ?? (mapping.parentKey ? 'epic-story-subtask' : 'story-subtask')) === 'flat-task'
  const story = flat ? null : (options.story?.toUpperCase() ?? pickStory(mapping, entry.kind))
  if (story !== null && !ISSUE_KEY_PATTERN.test(story)) throw new UsageError(`Invalid story key: "${options.story}".`)
  if (!flat && story === null) {
    throw new TallyError(`${mapping.jiraProjectKey} has no story to hang the card from; say which one.`, 'NEEDS_STORY', {
      hint: `tally issue open ${entryId} --story <KEY>, or save one with "tally map story <projectId> <theme> <KEY>"`,
      exitCode: 4,
      data: { entryId, jiraProjectKey: mapping.jiraProjectKey, options: storyOptions(mapping) },
    })
  }

  if (!claimEntry(ctx.db, entryId, ctx.now)) {
    const other = await waitForRegistration(ctx, entryId)
    if (other?.issueKey) return linkedResult(entryId, other)
    throw new ConflictError(`Another tally is opening the card of #${entryId}.`, 'OPEN_IN_PROGRESS', `tally issue open ${entryId} --json in a minute`)
  }

  try {
    const site = mapping.site ?? ctx.config.jira?.site
    const writer = await ctx.writer(site)
    const warnings: string[] = []
    const accountId = ctx.config.jira?.accountId ?? (await writer.myself().catch(() => null))
    if (!accountId) warnings.push('No Jira account id: the card was left unassigned. Save it with "tally config set-jira --account-id <id>".')
    const issueType = flat ? (mapping.issueTypeName ?? ctx.config.defaults?.issueTypeName ?? DEFAULT_FLAT_ISSUE_TYPE) : (mapping.workIssueTypeName ?? DEFAULT_WORK_ISSUE_TYPE)
    const created = await writer.createIssue({
      project: mapping.jiraProjectKey,
      type: issueType,
      summary: wipSummary(entry, ctx.timezone),
      description: placeholderDescription(entry),
      ...(story ? { parent: story } : {}),
      ...(accountId ? { assignee: accountId } : {}),
      fields: { [ctx.config.jira?.startDateField ?? DEFAULT_START_DATE_FIELD]: localDay(entry.startedAt, ctx.timezone) },
    })
    inTransaction(ctx.db, () => {
      register(ctx.db, { entryId, issueKey: created.key, worklogId: null, linkedAt: ctx.now.toISOString(), source: TIMER_SOURCE })
      removePendingOpen(ctx.db, entryId)
    })

    const sprint = await putInActiveSprint(ctx, writer, mapping, entry.projectId, own, story ?? created.key, warnings)

    let status: string | null = null
    try {
      const target = pickInProgress(await writer.transitions(created.key))
      if (target) {
        await writer.transition(created.key, target.id)
        status = target.to ?? target.name
      }
    } catch (error) {
      warnings.push(`Could not move ${created.key} to in progress: ${error instanceof Error ? error.message : String(error)}`)
    }

    return { entryId, issueKey: created.key, url: created.url, created: true, jiraProjectKey: mapping.jiraProjectKey, issueType, parentKey: story, sprint, status, warnings }
  } finally {
    releaseClaim(ctx.db, entryId)
  }
}

function runGit(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 10_000 }, (error, stdout) => resolve(error ? '' : stdout))
  })
}

export async function sessionCommits(repos: readonly string[], since: string, until: string): Promise<string[]> {
  const lines: string[] = []
  for (const repo of [...new Set(repos)]) {
    if (!existsSync(repo)) continue
    const email = (await runGit(repo, ['config', 'user.email'])).trim()
    const log = await runGit(repo, ['log', '--all', '--no-merges', `--since=${since}`, `--until=${until}`, '--format=%h %s', ...(email ? [`--author=${email}`] : [])])
    const name = repo.split(/[\\/]/).filter(Boolean).at(-1) ?? repo
    for (const line of log.split('\n').map((item) => item.trim()).filter(Boolean)) lines.push(`${name}: ${line}`)
  }
  return lines.slice(0, MAX_COMMITS)
}

export function autoDescription(input: { entry: BitaEntryDetail; note: string | null; touched: readonly string[]; commits: readonly string[]; timezone: string; now: Date }): string {
  const { entry, timezone } = input
  const stop = entry.stoppedAt ?? input.now.toISOString()
  const seconds = Math.max(0, Math.round((Date.parse(stop) - Date.parse(entry.startedAt)) / 1000))
  const sections = [`## Objetivo\n${entry.description.trim() || 'Sesión sin título.'}`]
  if (input.commits.length > 0) sections.push(`## Hecho\n${input.commits.map((line) => `- ${line}`).join('\n')}`)
  if (input.touched.length > 0) {
    const shown = input.touched.slice(0, MAX_FILES).map((file) => `- \`${file}\``)
    if (input.touched.length > MAX_FILES) shown.push(`- … y ${input.touched.length - MAX_FILES} más`)
    sections.push(`## Archivos tocados\n${shown.join('\n')}`)
  }
  const note = input.note?.trim()
  if (note) sections.push(`## Nota\n${note.length > MAX_NOTE_CHARS ? `${note.slice(0, MAX_NOTE_CHARS)}\n…` : note}`)
  sections.push(`_Sesión de bita #${entry.id} · ${toLocalIso(entry.startedAt, timezone).slice(0, 16).replace('T', ' ')}–${toLocalIso(stop, timezone).slice(11, 16)} (${formatDuration(seconds)})_`)
  return `${sections.join('\n\n')}\n`
}

export async function fillIssue(ctx: IssueContext, entryId: number, explicit: { summary?: string; description?: string }, notes: NotesProvider | null = null): Promise<FillResult> {
  const registration = findRegistration(ctx.db, entryId)
  if (!registration?.issueKey) throw new NotFoundError(`Entry #${entryId} has no card in Jira.`, 'NO_ISSUE', `tally issue open ${entryId} --json`)
  const issueKey = registration.issueKey
  const site = (() => {
    const key = issueKey.slice(0, issueKey.lastIndexOf('-'))
    return Object.values(ctx.config.projectMapping).find((mapping) => mapping.jiraProjectKey === key)?.site ?? ctx.config.jira?.site
  })()
  const agent = explicit.summary !== undefined || explicit.description !== undefined

  if (agent) {
    const writer = await ctx.writer(site)
    await writer.editIssue(issueKey, explicit)
    markFilled(ctx.db, entryId, 'agent')
    return { entryId, issueKey, filledBy: 'agent', skipped: false, reason: null, summary: explicit.summary ?? null, description: explicit.description ?? null }
  }

  if (registration.filledBy === 'agent') {
    return { entryId, issueKey, filledBy: 'agent', skipped: true, reason: 'filled-by-agent', summary: null, description: null }
  }

  const entry = await ctx.bita.entry(entryId)
  if (!entry) throw new NotFoundError(`No entry with id ${entryId} in bita.`, 'ENTRY_NOT_FOUND')
  const note = notes ? ((await notes.note(entryId).catch(() => null))?.markdown ?? null) : null
  const repos = entry.projectId !== null && ctx.bita.repos ? await ctx.bita.repos(entry.projectId).catch(() => []) : []
  const commits = await sessionCommits(repos, entry.startedAt, entry.stoppedAt ?? ctx.now.toISOString())
  const description = autoDescription({ entry, note, touched: entry.touched, commits, timezone: ctx.timezone, now: ctx.now })
  const summary = entry.description.trim() || undefined

  if (findRegistration(ctx.db, entryId)?.filledBy === 'agent' || !markFilled(ctx.db, entryId, 'auto')) {
    return { entryId, issueKey, filledBy: 'agent', skipped: true, reason: 'filled-by-agent', summary: null, description: null }
  }
  const writer = await ctx.writer(site)
  await writer.editIssue(issueKey, { ...(summary ? { summary } : {}), description })
  return { entryId, issueKey, filledBy: 'auto', skipped: false, reason: null, summary: summary ?? null, description }
}

export async function notify(title: string, message: string): Promise<boolean> {
  if (process.env['TALLY_NO_NOTIFY']) return false
  return kitNotify(title, message)
}

export function pendingView(db: DatabaseSync, config: TallyConfig): { pending: PendingOpen[]; options: ProjectOption[] } {
  return { pending: listPendingOpens(db), options: projectOptions(config, db) }
}

function configTimezone(config: TallyConfig): string {
  return typeof config.timezone === 'string' ? config.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone
}

export async function issueContext(db: DatabaseSync, now: Date = new Date()): Promise<IssueContext> {
  const config = await readConfig()
  return { db, config, bita: await requireBita(), writer: requireJiraWriter, now, timezone: configTimezone(config) }
}

function readEntryId(raw: string | undefined, usage: string): number {
  const id = Number(raw)
  if (raw === undefined || !Number.isInteger(id) || id <= 0) throw new UsageError(usage)
  return id
}

function readText(value: string | undefined): string | undefined {
  if (value === undefined || !value.startsWith('@')) return value
  const file = value.slice(1)
  try {
    return readFileSync(file === '-' ? 0 : file, 'utf8')
  } catch {
    throw new UsageError(`Cannot read ${file}.`)
  }
}

export async function runIssue(argv: readonly string[]): Promise<number> {
  const subcommand = argv[0]
  const args = parseCommandArgs(argv.slice(1), {
    'jira-project': { type: 'string' },
    story: { type: 'string' },
    summary: { type: 'string' },
    description: { type: 'string' },
  })
  const json = readBoolean(args, 'json')

  if (subcommand === 'open') {
    const entryId = readEntryId(args.positionals[0], 'Usage: tally issue open <entryId> [--jira-project KEY] [--story KEY] [--json]')
    const db = openDatabase()
    try {
      const jiraProject = readString(args, 'jira-project')
      const story = readString(args, 'story')
      const result = await openIssue(await issueContext(db), entryId, { ...(jiraProject ? { jiraProject } : {}), ...(story ? { story } : {}) })
      if (json) writeJson(successEnvelope('issue open', result, { warnings: result.warnings }))
      else {
        writeOut(result.created ? `Opened ${result.issueKey} for #${entryId}${result.parentKey ? ` under ${result.parentKey}` : ''}.` : `#${entryId} already has ${result.issueKey}.`)
        if (result.sprint) writeOut(`Sprint  : ${result.sprint.name}`)
        if (result.status) writeOut(`Status  : ${result.status}`)
        for (const warning of result.warnings) writeOut(`Warning: ${warning}`)
      }
      return 0
    } finally {
      db.close()
    }
  }

  if (subcommand === 'fill') {
    const entryId = readEntryId(args.positionals[0], 'Usage: tally issue fill <entryId> [--summary TEXT] [--description TEXT|@file] [--json]')
    const summary = readText(readString(args, 'summary'))
    const description = readText(readString(args, 'description'))
    const db = openDatabase()
    try {
      const explicit = { ...(summary !== undefined ? { summary } : {}), ...(description !== undefined ? { description } : {}) }
      const agent = summary !== undefined || description !== undefined
      const result = await fillIssue(await issueContext(db), entryId, explicit, agent ? null : await findNotesProvider())
      if (json) writeJson(successEnvelope('issue fill', result))
      else writeOut(result.skipped ? `${result.issueKey} was already filled by the agent; left as is.` : `Filled ${result.issueKey} (${result.filledBy}).`)
      return 0
    } finally {
      db.close()
    }
  }

  if (subcommand === 'show') {
    const entryId = readEntryId(args.positionals[0], 'Usage: tally issue show <entryId> [--json]')
    const db = openDatabase()
    try {
      const registration = findRegistration(db, entryId)
      const found = registration?.issueKey ? { entryId, issueKey: registration.issueKey, source: registration.source, worklogId: registration.worklogId, filledBy: registration.filledBy } : null
      if (json) writeJson(successEnvelope('issue show', found))
      else writeOut(found ? `#${entryId}: ${found.issueKey}${found.worklogId ? '' : ' (worklog pending)'}` : `#${entryId} has no card.`)
      return 0
    } finally {
      db.close()
    }
  }

  if (subcommand === 'pending') {
    const db = openDatabase()
    try {
      const view = pendingView(db, await readConfig())
      if (json) {
        writeJson(successEnvelope('issue pending', view.pending, { options: view.options }))
        return 0
      }
      if (view.pending.length === 0) {
        writeOut('No entry is waiting for a Jira project.')
        return 0
      }
      writeOut(renderTable([{ header: 'ENTRY', align: 'right' }, { header: 'TITLE' }, { header: 'WAITING FOR' }, { header: 'SINCE' }], view.pending.map((item) => [String(item.entryId), item.description || '(no title)', item.reason, item.requestedAt.slice(0, 16)])))
      writeOut('')
      writeOut('Open each with: tally issue open <entryId> --jira-project <KEY>')
      return 0
    } finally {
      db.close()
    }
  }

  throw new UsageError(`Unknown issue subcommand "${subcommand ?? ''}". Use open, fill, show or pending.`)
}

export function timerEventEntry(document: Record<string, unknown>): { id: number | null; projectId: number | null; description: string; jiraIssue: boolean | null } {
  const entry = record(document['entry'])
  const id = typeof entry['id'] === 'number' && Number.isInteger(entry['id']) ? entry['id'] : null
  const projectId = typeof entry['projectId'] === 'number' && Number.isInteger(entry['projectId']) ? entry['projectId'] : null
  const jiraIssue = typeof entry['jiraIssue'] === 'boolean' ? entry['jiraIssue'] : null
  return { id, projectId, description: typeof entry['description'] === 'string' ? entry['description'] : '', jiraIssue }
}
