import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStatus, resolveProjectRef, type StatusOptions } from '../src/cli/commands/status.ts'
import { emptyConfig, type TallyConfig } from '../src/state/config.ts'
import type { Registration } from '../src/db/registrations.ts'
import type { BitaEntry } from '../src/integrations/bita.ts'
import { bitaEntry } from './helpers/bita-entries.ts'
import { TEST_TZ } from './helpers/entries.ts'

const RANGE = { fromDay: '2026-09-14', toDay: '2026-09-20', timezone: TEST_TZ }

function registration(entryId: number, issueKey: string): Registration {
  return { entryId, issueKey, worklogId: null, linkedAt: '2026-09-19T00:00:00Z', source: 'tally', orphanedAt: null }
}

function status(entries: BitaEntry[], extra: { registrations?: Registration[]; config?: TallyConfig; projectId?: number | null; options?: Partial<StatusOptions> } = {}) {
  return buildStatus(
    {
      bita: { entries, range: RANGE, warnings: [] },
      registrations: new Map((extra.registrations ?? []).map((item) => [item.entryId, item])),
      hasRegistrations: (extra.registrations ?? []).length > 0,
      config: extra.config ?? emptyConfig(),
      ...(extra.projectId === undefined ? {} : { projectId: extra.projectId }),
    },
    { includeRunning: false, withEntries: false, now: new Date('2026-09-20T12:00:00Z'), ...extra.options },
  )
}

const ENTRIES = () => [
  bitaEntry({ id: 1, start: '2026-09-15T16:00:00Z', durationSeconds: 3600 }),
  bitaEntry({ id: 2, start: '2026-09-16T16:00:00Z', durationSeconds: 1800 }),
  bitaEntry({ id: 3, description: 'ok', start: '2026-09-16T18:00:00Z', durationSeconds: 600 }),
  bitaEntry({ id: 4, start: '2026-09-16T19:00:00Z', durationSeconds: 20 }),
  bitaEntry({ id: 5, start: '2026-09-17T16:00:00Z', durationSeconds: 900, running: true }),
  bitaEntry({ id: 6, description: 'sitio de Can Doo', projectId: 900, projectName: 'Can Doo with Pet', start: '2026-09-17T18:00:00Z', durationSeconds: 2400 }),
]

test('status splits every second of the range into registered, pending, excluded and outside Jira', () => {
  const config = { ...emptyConfig(), projectJira: { '900': false } }
  const result = status(ENTRIES(), { registrations: [registration(1, 'PP-1')], config })
  assert.deepEqual(result.data.totals, { registeredSeconds: 3600, pendingSeconds: 1800, excludedSeconds: 600 + 20 + 900, nonJiraSeconds: 2400 })
  assert.deepEqual(result.data.projects, [
    { projectId: 789, name: 'Plataforma', jira: true, registeredSeconds: 3600, pendingSeconds: 1800, excludedSeconds: 1520, nonJiraSeconds: 0 },
    { projectId: 900, name: 'Can Doo with Pet', jira: false, registeredSeconds: 0, pendingSeconds: 0, excludedSeconds: 0, nonJiraSeconds: 2400 },
  ])
  assert.equal(result.data.entries, undefined)
  assert.equal(result.meta.entryCount, 6)
  assert.equal(result.meta.runningSeconds, 900)
  assert.ok(result.meta.warnings.some((warning) => warning.includes('--include-running')))
})

test('a running timer outside Jira is excluded like in summary until includeRunning', () => {
  const config = { ...emptyConfig(), projectJira: { '900': false } }
  const entries = [bitaEntry({ id: 1, projectId: 900, projectName: 'Can Doo with Pet', durationSeconds: 1200, running: true })]
  const excluded = status(entries, { config, options: { withEntries: true } })
  assert.deepEqual(excluded.data.totals, { registeredSeconds: 0, pendingSeconds: 0, excludedSeconds: 1200, nonJiraSeconds: 0 })
  assert.equal(excluded.data.entries?.[0]?.excludedReason, 'running')
  assert.equal(status(entries, { config, options: { includeRunning: true } }).data.totals.nonJiraSeconds, 1200)
})

test('status warns to migrate when tally is empty and bita still has registered entries', () => {
  const result = status([bitaEntry({ id: 1, bitaRegistered: true })])
  assert.ok(result.meta.warnings.some((warning) => warning.includes('tally migrate --from-bita')))
})

test('status --entries tells why each entry lands where it does', () => {
  const config = { ...emptyConfig(), projectJira: { '900': false } }
  const result = status(ENTRIES(), { registrations: [registration(1, 'PP-1'), registration(6, 'CDP-1')], config, options: { withEntries: true } })
  assert.deepEqual(
    result.data.entries?.map(({ entryId, registered, issueKey, jira, excludedReason }) => ({ entryId, registered, issueKey, jira, excludedReason })),
    [
      { entryId: 1, registered: true, issueKey: 'PP-1', jira: true, excludedReason: null },
      { entryId: 2, registered: false, issueKey: null, jira: true, excludedReason: null },
      { entryId: 3, registered: false, issueKey: null, jira: true, excludedReason: 'no-description' },
      { entryId: 4, registered: false, issueKey: null, jira: true, excludedReason: 'zero-duration' },
      { entryId: 5, registered: false, issueKey: null, jira: true, excludedReason: 'running' },
      { entryId: 6, registered: false, issueKey: null, jira: false, excludedReason: null },
    ],
  )
  assert.equal(result.data.totals.nonJiraSeconds, 2400)
})

test('status counts a running entry as pending with includeRunning', () => {
  const result = status(ENTRIES(), { options: { includeRunning: true } })
  assert.equal(result.data.totals.pendingSeconds, 3600 + 1800 + 900 + 2400)
  assert.equal(result.data.totals.excludedSeconds, 620)
  assert.equal(result.meta.runningSeconds, 900)
  assert.ok(!result.meta.warnings.some((warning) => warning.includes('--include-running')))
})

test('status splits merged entries by block, each on its own day and with its own registration', () => {
  const merged = bitaEntry({ id: 10, start: '2026-09-15T16:00:00Z', durationSeconds: 3600, segments: [{ id: 11, start: '2026-09-17T16:00:00Z', durationSeconds: 1800 }] })
  const result = status([merged], { registrations: [registration(10, 'PP-10')], options: { withEntries: true } })
  assert.deepEqual(result.data.totals, { registeredSeconds: 3600, pendingSeconds: 1800, excludedSeconds: 0, nonJiraSeconds: 0 })
  assert.ok(result.meta.warnings.some((warning) => warning.includes('Merged entry #10')))
  assert.deepEqual(result.data.entries?.map((entry) => [entry.entryId, entry.localDay, entry.seconds, entry.registered]), [
    [10, '2026-09-15', 3600, true],
    [11, '2026-09-17', 1800, false],
  ])
})

test('status follows the project the bita entry says goes outside Jira unless tally overrides it', () => {
  const entries = [bitaEntry({ id: 1, projectId: 900, projectName: 'Can Doo with Pet', jira: false })]
  assert.equal(status(entries).data.totals.nonJiraSeconds, 3600)
  const config = { ...emptyConfig(), projectJira: { '900': true } }
  assert.equal(status(entries, { config }).data.totals.pendingSeconds, 3600)
})

test('status --project keeps a single project', () => {
  const result = status(ENTRIES(), { projectId: 900 })
  assert.deepEqual(result.data.projects.map((project) => project.projectId), [900])
  assert.deepEqual(result.data.totals, { registeredSeconds: 0, pendingSeconds: 2400, excludedSeconds: 0, nonJiraSeconds: 0 })
  assert.equal(result.meta.projectId, 900)
})

test('resolveProjectRef takes an id, a key or a name', () => {
  const projects = [{ id: 900, name: 'Can Doo with Pet', key: 'CDP', active: true, jira: null }]
  assert.equal(resolveProjectRef('900', [], projects), 900)
  assert.equal(resolveProjectRef('789', ENTRIES(), projects), 789)
  assert.throws(() => resolveProjectRef('7890', ENTRIES(), projects), { code: 'PROJECT_NOT_FOUND' })
  assert.equal(resolveProjectRef('cdp', [], projects), 900)
  assert.equal(resolveProjectRef('can doo with pet', [], projects), 900)
  assert.equal(resolveProjectRef('plataforma', ENTRIES(), projects), 789)
  assert.throws(() => resolveProjectRef('nope', ENTRIES(), projects), { code: 'PROJECT_NOT_FOUND' })
})
