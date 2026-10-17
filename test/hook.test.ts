import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleBitaEvent } from '../src/cli/commands/hook.ts'
import { mergeConflicts } from '../src/cli/commands/summary.ts'
import { openMemoryDatabase } from '../src/db/open.ts'
import { findRegistration, register, registrationsFor } from '../src/db/registrations.ts'
import { toEntryNote } from '../src/integrations/inkwell.ts'
import { emptyConfig, projectGoesToJira } from '../src/state/config.ts'
import { bitaEntry } from './helpers/bita-entries.ts'

const AT = '2026-10-01T00:00:00.000Z'

test('a deleted entry keeps its registration as an orphan that no longer counts', () => {
  const db = openMemoryDatabase()
  register(db, { entryId: 5, issueKey: 'PP-1', linkedAt: AT })
  register(db, { entryId: 6, issueKey: 'PP-1', linkedAt: AT })
  const outcome = handleBitaEvent(db, { event: 'delete', entry: { id: 5, segments: [{ entryId: 5 }, { entryId: 6 }] } }, new Date(AT))
  assert.deepEqual(outcome.orphaned, [5, 6])
  assert.equal(findRegistration(db, 5), undefined)
  assert.equal(findRegistration(db, 5, { includeOrphaned: true })?.orphanedAt, AT)
  assert.equal(registrationsFor(db, [5, 6]).size, 0)

  register(db, { entryId: 5, issueKey: 'PP-9', linkedAt: AT })
  assert.equal(findRegistration(db, 5)?.issueKey, 'PP-9')
  assert.equal(findRegistration(db, 5)?.orphanedAt, null)
  db.close()
})

test('a merge keeps every block registered on its own and flags a mixed result', () => {
  const db = openMemoryDatabase()
  register(db, { entryId: 2, issueKey: 'PP-1', linkedAt: AT })
  register(db, { entryId: 3, issueKey: 'PP-2', linkedAt: AT })
  const outcome = handleBitaEvent(db, { event: 'merge', entry: { id: 1, segments: [{ entryId: 1 }, { entryId: 2 }, { entryId: 3 }] }, mergedIds: [2, 3] })
  assert.deepEqual(outcome.merged, [2, 3])
  assert.deepEqual(outcome.conflict, { survivorId: 1, issues: ['PP-1', 'PP-2'], pendingEntryIds: [1] })
  assert.equal(findRegistration(db, 2)?.issueKey, 'PP-1')
  assert.equal(findRegistration(db, 1), undefined)

  const later = handleBitaEvent(db, { event: 'merge', entry: { id: 7, segments: [] }, mergedIds: [1] })
  assert.equal(later.conflict, null)
  const survivors = db.prepare('SELECT absorbed_id, survivor_id FROM merges ORDER BY absorbed_id').all().map((row) => ({ ...row }))
  assert.deepEqual(survivors, [
    { absorbed_id: 1, survivor_id: 7 },
    { absorbed_id: 2, survivor_id: 7 },
    { absorbed_id: 3, survivor_id: 7 },
  ])
  db.close()
})

test('deleting a merged entry orphans the blocks it had absorbed', () => {
  const db = openMemoryDatabase()
  register(db, { entryId: 2, issueKey: 'PP-1', linkedAt: AT })
  handleBitaEvent(db, { event: 'merge', entry: { id: 1 }, mergedIds: [2] })
  const outcome = handleBitaEvent(db, { event: 'delete', entry: { id: 1 } }, new Date(AT))
  assert.deepEqual(outcome.orphaned, [2])
  assert.equal(registrationsFor(db, [2]).size, 0)
  db.close()
})

test('a merge of pending entries is not a conflict, and other events are ignored', () => {
  const db = openMemoryDatabase()
  assert.equal(handleBitaEvent(db, { event: 'merge', entry: { id: 1 }, mergedIds: [2] }).conflict, null)
  assert.equal(handleBitaEvent(db, { event: 'amend', entry: { id: 1 } }).ignored, true)
  assert.equal(handleBitaEvent(db, { event: 'delete' }).ignored, true)
  db.close()
})

test('summary lists merged entries whose blocks went to different places', () => {
  const merged = bitaEntry({ id: 10, segments: [{ id: 11, start: '2026-09-16T20:00:00Z', durationSeconds: 1800 }] })
  const registration = (entryId: number, issueKey: string) => ({ entryId, issueKey, worklogId: null, linkedAt: AT, source: 'tally', orphanedAt: null, filledBy: null })
  assert.deepEqual(mergeConflicts([merged], new Map([[11, registration(11, 'PP-1')]])), [
    { entryId: 10, description: 'ajustar pipeline', issues: ['PP-1'], registeredEntryIds: [11], pendingEntryIds: [10] },
  ])
  assert.deepEqual(mergeConflicts([merged], new Map([[10, registration(10, 'PP-1')], [11, registration(11, 'PP-1')]])), [])
  assert.deepEqual(mergeConflicts([merged], new Map()), [])
})

test('tally decides whether a project goes to Jira, falling back to old bita flags', () => {
  const config = { ...emptyConfig(), projectJira: { '3': false, '4': true } }
  assert.equal(projectGoesToJira(config, 3, true), false)
  assert.equal(projectGoesToJira(config, 4, false), true)
  assert.equal(projectGoesToJira(config, 5, false), false)
  assert.equal(projectGoesToJira(config, 5, null), true)
  assert.equal(projectGoesToJira(config, null, null), true)
})

test('the inkwell note show data is read strictly', () => {
  assert.equal(toEntryNote(1, { id: 1, doc: null, appendices: [] }), null)
  assert.equal(toEntryNote(1, null), null)
  assert.equal(toEntryNote(1, { doc: { path: '/x' } }), null)
  assert.deepEqual(toEntryNote(1, { id: 1, description: 'algo', doc: { relPath: 'a/b.md', path: '/d/a/b.md', docTitle: 'Algo', markdown: '## Contexto\nx' } }), {
    entryId: 1,
    relPath: 'a/b.md',
    path: '/d/a/b.md',
    title: 'Algo',
    markdown: '## Contexto\nx',
  })
  assert.equal(toEntryNote(1, { doc: { relPath: 'a.md', path: '/a.md', markdown: null } })?.markdown, null)
})
