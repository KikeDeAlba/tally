import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStatus, resolveProjectRef, type StatusOptions } from '../src/cli/commands/status.ts'
import { buildSummary } from '../src/cli/commands/summary.ts'
import { emptyConfig, type TallyConfig } from '../src/state/config.ts'
import type { Registration } from '../src/db/registrations.ts'
import type { BitaEntry } from '../src/integrations/bita.ts'
import { bitaEntry } from './helpers/bita-entries.ts'
import { TEST_TZ } from './helpers/entries.ts'

const RANGE = { fromDay: '2026-09-14', toDay: '2026-09-20', timezone: TEST_TZ }

function registration(entryId: number, issueKey: string): Registration {
  return { entryId, issueKey, worklogId: null, linkedAt: '2026-09-19T00:00:00Z', source: 'tally', orphanedAt: null, filledBy: null }
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
  assert.deepEqual(result.data.totals, { registeredSeconds: 3600, pendingSeconds: 1800, excludedSeconds: 600 + 20 + 900, nonJiraSeconds: 2400, estimateSeconds: 5400 })
  assert.deepEqual(result.data.projects, [
    { projectId: 789, name: 'Plataforma', jira: true, registeredSeconds: 3600, pendingSeconds: 1800, excludedSeconds: 1520, nonJiraSeconds: 0, estimateSeconds: 5400 },
    { projectId: 900, name: 'Can Doo with Pet', jira: false, registeredSeconds: 0, pendingSeconds: 0, excludedSeconds: 0, nonJiraSeconds: 2400, estimateSeconds: 0 },
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
  assert.deepEqual(excluded.data.totals, { registeredSeconds: 0, pendingSeconds: 0, excludedSeconds: 1200, nonJiraSeconds: 0, estimateSeconds: 0 })
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
      { entryId: 6, registered: true, issueKey: 'CDP-1', jira: false, excludedReason: null },
    ],
  )
  assert.equal(result.data.totals.nonJiraSeconds, 0)
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
  assert.deepEqual(result.data.totals, { registeredSeconds: 3600, pendingSeconds: 1800, excludedSeconds: 0, nonJiraSeconds: 0, estimateSeconds: 5400 })
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

test('time already registered stays registered after its project is switched off Jira', () => {
  const entries = [
    bitaEntry({ id: 1, projectId: 900, projectName: 'Can Doo with Pet', durationSeconds: 3600 }),
    bitaEntry({ id: 2, projectId: 900, projectName: 'Can Doo with Pet', start: '2026-09-17T16:00:00Z', durationSeconds: 1800 }),
  ]
  const config = { ...emptyConfig(), projectJira: { '900': false } }
  const result = status(entries, { registrations: [registration(1, 'CDP-1')], config, options: { withEntries: true } })
  assert.deepEqual(result.data.totals, { registeredSeconds: 3600, pendingSeconds: 0, excludedSeconds: 0, nonJiraSeconds: 1800, estimateSeconds: 0 })
  assert.deepEqual(result.data.projects, [{ projectId: 900, name: 'Can Doo with Pet', jira: false, registeredSeconds: 3600, pendingSeconds: 0, excludedSeconds: 0, nonJiraSeconds: 1800, estimateSeconds: 0 }])
  assert.deepEqual(result.data.entries?.map((entry) => [entry.entryId, entry.registered, entry.issueKey, entry.jira]), [
    [1, true, 'CDP-1', false],
    [2, false, null, false],
  ])
})

test('status --project keeps a single project', () => {
  const result = status(ENTRIES(), { projectId: 900 })
  assert.deepEqual(result.data.projects.map((project) => project.projectId), [900])
  assert.deepEqual(result.data.totals, { registeredSeconds: 0, pendingSeconds: 2400, excludedSeconds: 0, nonJiraSeconds: 0, estimateSeconds: 3600 })
  assert.equal(result.meta.projectId, 900)
})

const ESTIMATE_ENTRIES = () => [
  bitaEntry({ id: 1, description: 'pipeline de despliegue', start: '2026-09-15T16:00:00Z', durationSeconds: 3000 }),
  bitaEntry({ id: 2, description: 'pipeline de despliegue.', start: '2026-09-16T16:00:00Z', durationSeconds: 1000 }),
  bitaEntry({ id: 3, description: 'revisión de PR', start: '2026-09-16T18:00:00Z', durationSeconds: 700 }),
  bitaEntry({ id: 4, description: 'revisión de PR', start: '2026-09-17T18:00:00Z', durationSeconds: 400, kind: 'remote-meeting' }),
  bitaEntry({ id: 5, description: 'ok', start: '2026-09-17T20:00:00Z', durationSeconds: 3600 }),
  bitaEntry({ id: 6, description: 'sitio de Can Doo', projectId: 900, projectName: 'Can Doo with Pet', start: '2026-09-18T18:00:00Z', durationSeconds: 2400 }),
  bitaEntry({ id: 7, description: 'soporte', projectId: 901, projectName: 'Soporte', start: '2026-09-18T20:00:00Z', durationSeconds: 60 }),
]

const ESTIMATE_CONFIG = () => ({ ...emptyConfig(), projectJira: { '900': false } })

test('status estimates each group like summary and leaves projects outside Jira at zero', () => {
  const result = status(ESTIMATE_ENTRIES(), { registrations: [registration(1, 'PP-1')], config: ESTIMATE_CONFIG() })
  const byId = new Map(result.data.projects.map((project) => [project.projectId, project.estimateSeconds]))
  assert.equal(byId.get(789), 5400 + 1800 + 1800)
  assert.equal(byId.get(900), 0)
  assert.equal(byId.get(901), 1800)
  assert.equal(result.data.totals.estimateSeconds, 5400 + 1800 + 1800 + 1800)
  assert.equal(result.meta.estimateStepMinutes, 30)
})

test('a registered entry that summary would exclude adds nothing to the estimate', () => {
  const result = status(ESTIMATE_ENTRIES(), { registrations: [registration(5, 'PP-5')], config: ESTIMATE_CONFIG() })
  assert.equal(result.data.totals.registeredSeconds, 3600)
  assert.equal(result.data.totals.estimateSeconds, 5400 + 1800 + 1800 + 1800)
})

test('status rounds every group to the estimate step it is given', () => {
  const result = status(ESTIMATE_ENTRIES(), { config: ESTIMATE_CONFIG(), options: { estimateStepSeconds: 15 * 60 } })
  const byId = new Map(result.data.projects.map((project) => [project.projectId, project.estimateSeconds]))
  assert.equal(byId.get(789), 4500 + 900 + 900)
  assert.equal(byId.get(901), 900)
  assert.equal(result.data.totals.estimateSeconds, 4500 + 900 + 900 + 900)
  assert.equal(result.meta.estimateStepMinutes, 15)
})

test('status --project estimates only that project with the same groups', () => {
  const result = status(ESTIMATE_ENTRIES(), { config: ESTIMATE_CONFIG(), projectId: 789 })
  assert.deepEqual(result.data.projects.map((project) => [project.projectId, project.estimateSeconds]), [[789, 9000]])
  assert.equal(result.data.totals.estimateSeconds, 9000)
  assert.equal(status(ESTIMATE_ENTRIES(), { config: ESTIMATE_CONFIG(), projectId: 900 }).data.totals.estimateSeconds, 0)
})

test('status estimates add up to the summary group estimates over registered and pending entries', async () => {
  const registrations = [registration(1, 'PP-1'), registration(3, 'PP-3'), registration(5, 'PP-5')]
  for (const estimateStepSeconds of [undefined, 15 * 60, 60 * 60]) {
    const step = estimateStepSeconds === undefined ? {} : { estimateStepSeconds }
    const result = status(ESTIMATE_ENTRIES(), { registrations, config: ESTIMATE_CONFIG(), options: step })
    const summary = await buildSummary(
      { bita: { entries: ESTIMATE_ENTRIES(), range: RANGE, warnings: [] }, registrations: new Map(registrations.map((item) => [item.entryId, item])), hasRegistrations: true, config: ESTIMATE_CONFIG() },
      { filter: 'any', includeRunning: false, maxTaskSeconds: 8 * 3600, caseInsensitive: false, now: new Date('2026-09-20T12:00:00Z'), ...step },
    )
    const summed = new Map<number | null, number>()
    for (const group of summary.data.groups) summed.set(group.projectId, (summed.get(group.projectId) ?? 0) + group.estimateSeconds)
    assert.deepEqual(new Map(result.data.projects.map((project) => [project.projectId, project.estimateSeconds])), summed)
    assert.equal(result.data.totals.estimateSeconds, [...summed.values()].reduce((sum, value) => sum + value, 0))
  }
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
