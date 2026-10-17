import { test } from 'node:test'
import assert from 'node:assert/strict'
import { briefSummary, buildSummary, type SummaryOptions } from '../src/cli/commands/summary.ts'
import { applyRegistrations, expandSegments } from '../src/domain/expand.ts'
import { collectEntries } from '../src/domain/collect.ts'
import { filledSections, loadSummaryDocs } from '../src/domain/notes.ts'
import { emptyConfig, type TallyConfig } from '../src/state/config.ts'
import type { Registration } from '../src/db/registrations.ts'
import type { BitaEntry } from '../src/integrations/bita.ts'
import type { NotesProvider } from '../src/integrations/inkwell.ts'
import { bitaEntry } from './helpers/bita-entries.ts'
import { TEST_TZ } from './helpers/entries.ts'

const NOW = new Date('2026-09-20T12:00:00Z')
const RANGE = { fromDay: '2026-09-14', toDay: '2026-09-20', timezone: TEST_TZ }

function options(overrides: Partial<SummaryOptions> = {}): SummaryOptions {
  return { filter: 'pending', includeRunning: false, maxTaskSeconds: 8 * 3600, caseInsensitive: false, now: NOW, ...overrides }
}

function registration(entryId: number, issueKey: string): Registration {
  return { entryId, issueKey, worklogId: null, linkedAt: '2026-09-19T00:00:00Z', source: 'tally', orphanedAt: null, filledBy: null }
}

async function summarize(entries: BitaEntry[], extra: { registrations?: Registration[]; config?: TallyConfig; options?: Partial<SummaryOptions>; notes?: NotesProvider } = {}) {
  const registrations = new Map((extra.registrations ?? []).map((item) => [item.entryId, item]))
  const notes = extra.notes
  return buildSummary(
    {
      bita: { entries, range: RANGE, warnings: [] },
      registrations,
      hasRegistrations: registrations.size > 0,
      config: extra.config ?? emptyConfig(),
      ...(notes ? { docs: (ids: number[]) => loadSummaryDocs(notes, ids) } : {}),
    },
    options(extra.options),
  )
}

test('a merged entry becomes one worklog per original block, each with its own id', () => {
  const merged = bitaEntry({
    id: 10,
    start: '2026-09-16T16:00:00Z',
    durationSeconds: 3600,
    segments: [{ id: 11, start: '2026-09-16T20:00:00Z', durationSeconds: 1800 }],
  })
  const expanded = expandSegments([merged], TEST_TZ)
  assert.deepEqual(expanded.map((entry) => [entry.id, entry.durationSeconds, entry.mergedInto]), [
    [10, 3600, null],
    [11, 1800, 10],
  ])
  assert.equal(expanded[1]?.startedJira, '2026-09-16T13:00:00.000-0700')
  assert.equal(expanded[1]?.stop, '2026-09-16T20:30:00.000Z')
})

test('each block of a merged entry is registered on its own, so a split part never hides another', () => {
  const merged = bitaEntry({ id: 10, segments: [{ id: 11, start: '2026-09-16T20:00:00Z', durationSeconds: 1800 }] })
  const expanded = applyRegistrations(expandSegments([merged], TEST_TZ), new Map([[10, registration(10, 'PP-1')]]))
  assert.deepEqual(expanded.map((entry) => [entry.id, entry.registered, entry.issueKey]), [
    [10, true, 'PP-1'],
    [11, false, null],
  ])
})

test('registration comes from tally, never from what bita reports', async () => {
  const summary = await summarize([bitaEntry({ id: 1, bitaRegistered: true }), bitaEntry({ id: 2, start: '2026-09-17T16:00:00Z' })], {
    registrations: [registration(2, 'PP-2')],
  })
  assert.deepEqual(summary.data.groups.flatMap((group) => group.entryIds), [1])
  assert.deepEqual(summary.meta.alreadyRegistered, { count: 1, totalSeconds: 3600 })
})

test('warns to migrate when tally is empty and bita still has registered entries', async () => {
  const summary = await summarize([bitaEntry({ id: 1, bitaRegistered: true })])
  assert.ok(summary.meta.warnings.some((warning) => warning.includes('tally migrate --from-bita')))
})

test('pending entries of a project outside Jira are set apart, never grouped', async () => {
  const summary = await summarize([
    bitaEntry({ id: 1, description: 'cupones de recompra', projectId: 1, projectName: 'Dportenis' }),
    bitaEntry({ id: 2, description: 'sitio de Can Doo', projectId: 2, projectName: 'Can Doo with Pet', jira: false, start: '2026-09-16T18:00:00Z', durationSeconds: 5400 }),
  ])
  assert.deepEqual(summary.data.groups.map((group) => group.summary), ['cupones de recompra'])
  assert.equal(summary.meta.nonJira.totalSeconds, 5400)
  assert.equal(summary.data.nonJiraHuman, '1h 30m')
  assert.deepEqual(summary.meta.unmappedProjects, [{ projectId: 1, projectName: 'Dportenis' }])
})

test('running, untitled and zero-length entries are excluded with their reason', async () => {
  const summary = await summarize([
    bitaEntry({ id: 1, running: true }),
    bitaEntry({ id: 2, description: '', start: '2026-09-17T16:00:00Z' }),
    bitaEntry({ id: 3, description: 'tiny', start: '2026-09-18T16:00:00Z', durationSeconds: 20 }),
  ])
  assert.deepEqual(summary.meta.excluded.map((entry) => [entry.id, entry.reason]), [
    [1, 'running'],
    [2, 'no-description'],
    [3, 'zero-duration'],
  ])
  assert.equal(summary.data.groups.length, 0)

  const withRunning = await summarize([bitaEntry({ id: 1, running: true })], { options: { includeRunning: true } })
  assert.equal(withRunning.data.groups.length, 1)
})

test('groups carry the mapping target, the issue types and the story themes', async () => {
  const config: TallyConfig = {
    ...emptyConfig(),
    jira: { siteUrl: 'https://x.atlassian.net' },
    projectMapping: {
      '789': {
        projectName: 'Plataforma',
        jiraProjectKey: 'INN',
        parentKey: 'INN-1213',
        storiesByEpic: { 'INN-1213': { devops: { key: 'INN-1300', summary: 'DevOps', verifiedAt: 'x' } } },
      },
    },
  }
  const summary = await summarize([bitaEntry({ id: 1 })], { config })
  const group = summary.data.groups[0]
  assert.equal(group?.jiraProjectKey, 'INN')
  assert.equal(group?.epicMode, 'fixed')
  assert.equal(group?.jiraEpicKey, 'INN-1213')
  assert.equal(group?.jiraStories['devops' as never]?.['key'], 'INN-1300')
  assert.equal(group?.jiraStoryIssueTypeName, 'Historia')
  assert.equal(group?.jiraWorkIssueTypeName, 'Subtarea')
  assert.equal(summary.meta.unmappedProjects.length, 0)
  assert.equal(summary.meta.storyThemes.length, 9)
  assert.deepEqual(summary.meta.jira, { siteUrl: 'https://x.atlassian.net' })
})

test('tasks over the cap are split and the split is announced', async () => {
  const summary = await summarize([bitaEntry({ id: 1, durationSeconds: 10 * 3600 })])
  assert.deepEqual(summary.data.groups.map((group) => group.summary), ['ajustar pipeline (1/2)', 'ajustar pipeline (2/2)'])
  assert.ok(summary.meta.warnings.some((warning) => warning.includes('8h per-task cap')))
})

test('overlapping timers are reported, not excluded', () => {
  const entries = applyRegistrations(
    expandSegments([bitaEntry({ id: 1, durationSeconds: 7200 }), bitaEntry({ id: 2, description: 'otra', durationSeconds: 3600 })], TEST_TZ),
    new Map(),
  )
  const result = collectEntries(entries, { filter: 'pending', includeRunning: false, requireDescription: true, requireProject: false, now: NOW })
  assert.equal(result.selected.length, 2)
  assert.equal(result.overlaps[0]?.overlapSeconds, 3600)
})

test('notes come from the provider and count toward coverage', async () => {
  const provider: NotesProvider = {
    name: 'inkwell',
    note: async (id) => (id === 1 ? { entryId: 1, relPath: 'a.md', path: '/d/a.md', title: 'A', markdown: '## Contexto\nalgo\n\n## Pendiente\n' } : null),
  }
  const summary = await summarize([bitaEntry({ id: 1 }), bitaEntry({ id: 2, start: '2026-09-17T16:00:00Z' })], { notes: provider })
  const group = summary.data.groups[0]
  assert.equal(group?.docs.length, 1)
  assert.deepEqual(group?.docs[0]?.sections, ['Contexto'])
  assert.deepEqual(group?.noteCoverage, { withNote: 1, withoutNote: 1 })
  assert.equal(summary.meta.notes.provider, 'inkwell')
  assert.deepEqual(summary.meta.notes.missing, [2])
})

test('without a notes provider the groups carry titles only', async () => {
  const summary = await summarize([bitaEntry({ id: 1 })])
  assert.deepEqual(summary.data.groups[0]?.docs, [])
  assert.equal(summary.meta.notes.provider, null)
  assert.deepEqual(summary.meta.notes.missing, [])
})

test('notes past the budget keep their path but drop the body', async () => {
  const provider: NotesProvider = { name: 'inkwell', note: async (id) => ({ entryId: id, relPath: null, path: `/n/${id}`, title: '', markdown: '## Qué se hizo\nx'.padEnd(800, 'x') }) }
  const loaded = await loadSummaryDocs(provider, [1, 2], { budgetBytes: 1000 })
  assert.equal(loaded.byEntry.get(1)?.[0]?.markdown?.length, 800)
  assert.equal(loaded.byEntry.get(2)?.[0]?.markdown, null)
  assert.deepEqual(loaded.truncatedEntryIds, [2])
})

test('filled sections skip empty headings and front matter', () => {
  assert.deepEqual(filledSections('---\ntitle: x\n---\n## Contexto\n\n## Qué se hizo\n- algo\n### detalle\n## Pendiente\n<!-- vacío -->\n'), ['Qué se hizo'])
})

test('the brief shape keeps what the push needs and moves the mapping to one entry per project', async () => {
  const config: TallyConfig = {
    ...emptyConfig(),
    jira: { siteUrl: 'https://x.atlassian.net', accountId: 'acc' },
    projectMapping: {
      '789': { projectName: 'Plataforma', jiraProjectKey: 'INN', parentKey: 'INN-1213', storiesByEpic: { 'INN-1213': { devops: { key: 'INN-1300', summary: 'DevOps', verifiedAt: 'x' } } } },
    },
  }
  const full = await summarize(
    [bitaEntry({ id: 1, durationSeconds: 10 * 3600 }), bitaEntry({ id: 2, description: 'daily', kind: 'remote-meeting', start: '2026-09-17T16:00:00Z', durationSeconds: 1800 })],
    { config },
  )
  const brief = briefSummary(full)
  assert.deepEqual(Object.keys(brief.data).sort(), ['groups', 'jiraHuman', 'nonJiraHuman', 'projects', 'totalHuman'])
  assert.equal(brief.data.groups.length, full.data.groups.length)
  const [first, second] = brief.data.groups
  assert.deepEqual(Object.keys(first ?? {}).sort(), ['days', 'docs', 'entryIds', 'estimateHuman', 'jira', 'kind', 'pages', 'part', 'projectId', 'summary', 'totalHuman', 'worklogs'])
  assert.deepEqual(first?.part, { index: 1, count: 2 })
  assert.deepEqual(Object.keys(first?.worklogs[0] ?? {}).sort(), ['entryId', 'startLocal', 'startedJira', 'timeSpent'])
  assert.equal(first?.worklogs[0]?.timeSpent, full.data.groups[0]?.worklogs[0]?.timeSpent)
  assert.ok(!('jiraProjectKey' in (second ?? {})))
  const meeting = brief.data.groups.find((group) => group.kind === 'remote-meeting')
  assert.equal(meeting?.meetings?.[0]?.entryId, 2)
  assert.ok(!('meeting' in (meeting ?? {})))
  assert.deepEqual(Object.keys(brief.data.projects), ['789'])
  assert.equal(brief.data.projects['789']?.jiraProjectKey, 'INN')
  assert.equal(brief.data.projects['789']?.epicMode, 'fixed')
  assert.equal((brief.data.projects['789'] as Record<string, any> | undefined)?.['jiraStories']?.['devops']?.key, 'INN-1300')
  assert.ok(!('jiraStoriesByEpic' in (brief.data.projects['789'] ?? {})))
  for (const dropped of ['jira', 'storyThemes', 'filter', 'maxTaskSeconds']) assert.ok(!(dropped in brief.meta), dropped)
  assert.equal(typeof brief.meta.alreadyRegistered, 'number')
  assert.deepEqual(brief.meta.warnings, full.meta.warnings)
  assert.ok(JSON.stringify(brief).length < JSON.stringify(full).length)
})

test('per-run projects keep the stories of every epic in the brief shape', async () => {
  const config: TallyConfig = {
    ...emptyConfig(),
    projectMapping: { '789': { projectName: 'Plataforma', jiraProjectKey: 'INN', epicResolved: true, storiesByEpic: { 'INN-1': { backend: { key: 'INN-2', summary: 'Backend', verifiedAt: 'x' } } } } },
  }
  const brief = briefSummary(await summarize([bitaEntry({ id: 1 })], { config }))
  assert.equal(brief.data.projects['789']?.epicMode, 'per-run')
  assert.deepEqual(Object.keys((brief.data.projects['789'] as Record<string, any> | undefined)?.['jiraStoriesByEpic'] ?? {}), ['INN-1'])
  assert.ok(!('jiraStories' in (brief.data.projects['789'] ?? {})))
})
