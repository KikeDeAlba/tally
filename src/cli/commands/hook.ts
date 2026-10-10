import { readFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { UsageError } from '../../errors.ts'
import { inTransaction, openDatabase } from '../../db/open.ts'
import { absorbedBy, orphanRegistrations, recordMerge, registrationsFor } from '../../db/registrations.ts'
import { parseCommandArgs, readBoolean, readString } from '../args.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'

export const SUBSCRIBED_EVENTS = ['delete', 'merge']

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
    outcome.orphaned = inTransaction(db, () => orphanRegistrations(db, doomed, at))
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
    const issues = [...new Set([...registrations.values()].map((item) => item.issueKey ?? ''))].filter((key) => key.length > 0)
    const pending = blocks.filter((id) => !registrations.has(id))
    if (registrations.size > 0 && (issues.length > 1 || pending.length > 0)) {
      outcome.conflict = { survivorId: entryId, issues, pendingEntryIds: pending }
    }
    return outcome
  }

  outcome.ignored = true
  return outcome
}

export function runBitaHook(argv: readonly string[]): number {
  const args = parseCommandArgs(argv, { file: { type: 'string' } })
  const file = readString(args, 'file')
  const raw = file !== undefined ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8')
  let document: Record<string, unknown>
  try {
    document = record(JSON.parse(raw) as unknown)
  } catch {
    throw new UsageError('bita-hook expects the event document as JSON on stdin.')
  }
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
