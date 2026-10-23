import { readFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { TallyError, UsageError } from '../../errors.ts'
import { inTransaction, openDatabase } from '../../db/open.ts'
import { absorbedBy, addPendingOpen, countsAsRegistered, findRegistration, orphanRegistrations, recordMerge, registrationsFor, removePendingOpen, TIMER_SOURCE } from '../../db/registrations.ts'
import { findNotesProvider, type NotesProvider } from '../../integrations/inkwell.ts'
import { projectGoesToJira } from '../../state/config.ts'
import { parseCommandArgs, readBoolean, readString } from '../args.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'
import { fillIssue, issueContext, notify, openIssue, timerEventEntry, type IssueContext } from './issue.ts'

export const SUBSCRIBED_EVENTS = ['delete', 'merge', 'start', 'stop']

export const TIMER_EVENTS = ['start', 'stop']

export interface TimerOutcome {
  event: string
  entryId: number | null
  action: 'opened' | 'linked' | 'pending' | 'filled' | 'skipped' | 'ignored' | 'failed'
  issueKey: string | null
  detail: string | null
}

export interface HookOutcome {
  event: string
  entryId: number | null
  orphaned: number[]
  merged: number[]
  conflict: { survivorId: number; issues: string[]; pendingEntryIds: number[] } | null
  ignored: boolean
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function ids(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === 'number' && Number.isInteger(item)) return [item]
    const nested = record(item)['entryId'] ?? record(item)['id']
    return typeof nested === 'number' && Number.isInteger(nested) ? [nested] : []
  })
}

export function handleBitaEvent(db: DatabaseSync, document: Record<string, unknown>, now: Date = new Date()): HookOutcome {
  const event = typeof document['event'] === 'string' ? document['event'] : ''
  const entry = record(document['entry'])
  const entryId = typeof entry['id'] === 'number' && Number.isInteger(entry['id']) ? entry['id'] : null
  const outcome: HookOutcome = { event, entryId, orphaned: [], merged: [], conflict: null, ignored: false }
  const at = now.toISOString()

  if (event === 'delete' && entryId !== null) {
    const named = [entryId, ...ids(entry['segments']), ...ids(document['deletedIds']), ...ids(document['segmentIds'])]
    const doomed = [...named, ...absorbedBy(db, named)]
    outcome.orphaned = inTransaction(db, () => {
      for (const id of named) removePendingOpen(db, id)
      return orphanRegistrations(db, doomed, at)
    })
    return outcome
  }

  if (event === 'merge' && entryId !== null) {
    const absorbed = ids(document['mergedIds']).filter((id) => id !== entryId)
    const blocks = [...new Set([entryId, ...ids(entry['segments']), ...absorbed])]
    inTransaction(db, () => {
      recordMerge(db, entryId, absorbed, at)
    })
    outcome.merged = absorbed
    const registrations = registrationsFor(db, blocks)
    const registered = [...registrations.values()].filter((item) => countsAsRegistered(item))
    const issues = [...new Set(registered.map((item) => item.issueKey ?? ''))].filter((key) => key.length > 0)
    const pending = blocks.filter((id) => !countsAsRegistered(registrations.get(id)))
    if (registered.length > 0 && (issues.length > 1 || pending.length > 0)) {
      outcome.conflict = { survivorId: entryId, issues, pendingEntryIds: pending }
    }
    return outcome
  }

  outcome.ignored = true
  return outcome
}

export async function handleTimerEvent(ctx: IssueContext, document: Record<string, unknown>, notes: () => Promise<NotesProvider | null> = findNotesProvider): Promise<TimerOutcome> {
  const event = typeof document['event'] === 'string' ? document['event'] : ''
  const entry = timerEventEntry(document)
  const outcome = (action: TimerOutcome['action'], issueKey: string | null = null, detail: string | null = null): TimerOutcome => ({ event, entryId: entry.id, action, issueKey, detail })
  if (entry.id === null) return outcome('ignored')

  if (event === 'start') {
    if (entry.jiraIssue === false) return outcome('ignored', null, 'started with --no-jira')
    const mapping = entry.projectId === null ? undefined : ctx.config.projectMapping[String(entry.projectId)]
    if (entry.jiraIssue !== true && mapping?.autoIssue !== true) return outcome('ignored')
    if (entry.projectId !== null && !projectGoesToJira(ctx.config, entry.projectId)) return outcome('ignored', null, 'project never goes to Jira')
    try {
      const result = await openIssue(ctx, entry.id)
      return outcome(result.created ? 'opened' : 'linked', result.issueKey, result.warnings.join(' ') || null)
    } catch (error) {
      if (error instanceof TallyError && (error.code === 'NEEDS_PROJECT' || error.code === 'NEEDS_STORY')) {
        addPendingOpen(ctx.db, { entryId: entry.id, projectId: entry.projectId, description: entry.description, reason: error.code === 'NEEDS_PROJECT' ? 'project' : 'story', requestedAt: ctx.now.toISOString() })
        await notify('tally', `#${entry.id} ${entry.description || 'sin título'}: elige el proyecto de Jira (tally issue pending)`)
        return outcome('pending', null, error.code)
      }
      throw error
    }
  }

  if (event === 'stop') {
    const registration = findRegistration(ctx.db, entry.id)
    if (!registration?.issueKey || registration.source !== TIMER_SOURCE) return outcome('ignored')
    const result = await fillIssue(ctx, entry.id, {}, await notes())
    return outcome(result.skipped ? 'skipped' : 'filled', result.issueKey, result.reason)
  }

  return outcome('ignored')
}

async function runTimerHook(document: Record<string, unknown>, json: boolean): Promise<number> {
  const event = typeof document['event'] === 'string' ? document['event'] : ''
  const entryId = timerEventEntry(document).id
  let outcome: TimerOutcome
  const db = openDatabase()
  try {
    outcome = await handleTimerEvent(await issueContext(db), document)
  } catch (error) {
    outcome = { event, entryId, action: 'failed', issueKey: null, detail: error instanceof Error ? error.message : String(error) }
  } finally {
    db.close()
  }
  if (json) writeJson(successEnvelope('bita-hook', outcome))
  else writeOut(`tally ${outcome.event} #${outcome.entryId ?? '?'}: ${outcome.action}${outcome.issueKey ? ` ${outcome.issueKey}` : ''}${outcome.detail ? ` (${outcome.detail})` : ''}`)
  return 0
}

export async function runBitaHook(argv: readonly string[]): Promise<number> {
  const args = parseCommandArgs(argv, { file: { type: 'string' } })
  const file = readString(args, 'file')
  const raw = file !== undefined ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8')
  let document: Record<string, unknown>
  try {
    document = record(JSON.parse(raw) as unknown)
  } catch {
    throw new UsageError('bita-hook expects the event document as JSON on stdin.')
  }
  if (TIMER_EVENTS.includes(String(document['event']))) return runTimerHook(document, readBoolean(args, 'json'))
  const db = openDatabase()
  let outcome: HookOutcome
  try {
    outcome = handleBitaEvent(db, document)
  } finally {
    db.close()
  }
  if (readBoolean(args, 'json')) writeJson(successEnvelope('bita-hook', outcome))
  else writeOut(`${outcome.event} #${outcome.entryId ?? '?'}: orphaned ${outcome.orphaned.length}, merged ${outcome.merged.length}${outcome.conflict ? `, conflict between ${outcome.conflict.issues.join(', ') || 'registered'} and ${outcome.conflict.pendingEntryIds.length} pending blocks` : ''}`)
  return 0
}
