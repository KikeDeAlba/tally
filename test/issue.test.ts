import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { defineManifest, registerTool } from '@kikedealba/kit/registry'
import { platformContext } from '@kikedealba/kit/platform'
import { openMemoryDatabase } from '../src/db/open.ts'
import { findRegistration, listPendingOpens, register } from '../src/db/registrations.ts'
import { handleTimerEvent } from '../src/cli/commands/hook.ts'
import { autoDescription, fillIssue, openIssue, pickInProgress, pickStory, projectOptions, type IssueContext } from '../src/cli/commands/issue.ts'
import type { JiraWriter, NewJiraIssue } from '../src/integrations/atl.ts'
import type { BitaClient, BitaEntryDetail } from '../src/integrations/bita.ts'
import { emptyConfig, type ProjectMapping, type TallyConfig } from '../src/state/config.ts'
import { bitaEntry } from './helpers/bita-entries.ts'
import { TEST_TZ } from './helpers/entries.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BIN = path.join(HERE, '..', 'src', 'bin', 'tally.ts')
const FAKE_BITA = path.join(HERE, 'helpers', 'fake-bita.ts')
const FAKE_ATL = path.join(HERE, 'helpers', 'fake-atl.ts')
const NOW = new Date('2026-10-06T18:00:00Z')

interface Run {
  code: number
  stdout: string
  stderr: string
  json: { ok: boolean; data?: any; meta?: any; error?: { code: string; message: string } }
}

async function tally(args: string[], env: NodeJS.ProcessEnv): Promise<Run> {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env }, (error, stdout, stderr) => {
      let json: Run['json'] = { ok: false }
      try {
        json = JSON.parse(stdout.trim().split('\n').at(-1) ?? '')
      } catch {
        json = { ok: false }
      }
      resolve({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, stdout, stderr, json })
    }).stdin?.end('')
  })
}

async function sandbox(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tally-issue-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const env: NodeJS.ProcessEnv = {
    PATH: path.dirname(process.execPath),
    HOME: dir,
    USERPROFILE: dir,
    XDG_CONFIG_HOME: path.join(dir, '.config'),
    XDG_DATA_HOME: path.join(dir, '.local', 'share'),
    XDG_STATE_HOME: path.join(dir, '.local', 'state'),
    KIT_REGISTRY_DIR: path.join(dir, 'registry'),
    KIT_CREDENTIALS: 'file',
    TALLY_DB_PATH: path.join(dir, 'tally.db'),
    TALLY_CONFIG_PATH: path.join(dir, 'tally.json'),
    TALLY_NO_NOTIFY: '1',
    BITA_DB_PATH: path.join(dir, 'bita.db'),
    BITA_CONFIG_PATH: path.join(dir, 'bita.json'),
    FAKE_BITA_STATE: path.join(dir, 'bita-state.json'),
    FAKE_BITA_LOG: path.join(dir, 'bita-calls.log'),
    FAKE_ATL_STATE: path.join(dir, 'atl-state.json'),
    FAKE_ATL_LOG: path.join(dir, 'atl-calls.log'),
  }
  const ctx = platformContext({ env })
  await registerTool(defineManifest({ name: 'bita', version: '1.3.0', bin: [process.execPath, FAKE_BITA], capabilities: ['time.entries.read', 'time.entries.write', 'time.events'] }), ctx)
  await registerTool(defineManifest({ name: 'atl', version: '0.3.0', bin: [process.execPath, FAKE_ATL], capabilities: ['atlassian.sites', 'atlassian.api.call', 'jira.issue.read', 'jira.issue.write'] }), ctx)
  const entries = [
    bitaEntry({ id: 1, start: '2026-10-06T16:00:00Z', durationSeconds: 3600 }),
    bitaEntry({ id: 2, description: '', start: '2026-10-07T16:00:00Z', durationSeconds: 2700 }),
    bitaEntry({ id: 3, description: 'sitio de Can Doo', projectId: 900, projectName: 'Can Doo with Pet', start: '2026-10-07T18:00:00Z', durationSeconds: 1800 }),
  ].map(({ jira: _jira, registered: _registered, issueKey: _issueKey, bitaRegistered: _bitaRegistered, ...current }) => current)
  await writeFile(
    env['FAKE_BITA_STATE'] as string,
    JSON.stringify({
      entries,
      range: { fromDay: '2026-10-01', toDay: '2026-10-10', timezone: TEST_TZ },
      projects: [
        { id: 789, key: 'PLA', name: 'Plataforma', active: true },
        { id: 900, key: 'CDP', name: 'Can Doo with Pet', active: true },
      ],
    }),
  )
  await writeFile(
    env['FAKE_ATL_STATE'] as string,
    JSON.stringify({
      users: [],
      fields: [],
      issues: [],
      boards: [{ id: 42, name: 'PP board', type: 'simple' }],
      sprints: [{ id: 7, name: 'Sprint 7', state: 'active' }],
      transitions: [
        { id: '11', name: 'Por hacer', to: 'Por hacer', category: 'new' },
        { id: '21', name: 'En curso', to: 'En curso', category: 'indeterminate' },
        { id: '31', name: 'Listo', to: 'Finalizada', category: 'done' },
      ],
    }),
  )
  return { dir, env }
}

async function atlCalls(env: NodeJS.ProcessEnv): Promise<string[][]> {
  return (await readFile(env['FAKE_ATL_LOG'] as string, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as string[])
}

test('issue open creates the subtask under the cached story, in the sprint and in progress, once', async (t) => {
  const { env } = await sandbox(t)
  assert.equal((await tally(['map', 'set', '789', 'PP', '--no-epic'], env)).code, 0)
  assert.equal((await tally(['map', 'story', '789', 'soporte', 'PP-10', '--no-epic'], env)).code, 0)

  const opened = await tally(['issue', 'open', '1', '--json'], env)
  assert.equal(opened.code, 0, opened.stdout + opened.stderr)
  assert.equal(opened.json.data.issueKey, 'PP-100')
  assert.equal(opened.json.data.created, true)
  assert.equal(opened.json.data.parentKey, 'PP-10')
  assert.deepEqual(opened.json.data.sprint, { id: 7, name: 'Sprint 7' })
  assert.equal(opened.json.data.status, 'En curso')

  const calls = await atlCalls(env)
  const create = calls.find((call) => call[2] === 'create') ?? []
  assert.equal(create[create.indexOf('--type') + 1], 'Subtarea')
  assert.equal(create[create.indexOf('--parent') + 1], 'PP-10')
  assert.equal(create[create.indexOf('--assignee') + 1], 'acc-me')
  assert.equal(create[create.indexOf('--summary') + 1], '@ajustar pipeline')
  assert.deepEqual(JSON.parse(create[create.indexOf('--fields') + 1] ?? '{}'), { customfield_10015: '2026-10-06' })
  assert.deepEqual(calls.find((call) => call[1] === 'sprint' && call[2] === 'add'), ['jira', 'sprint', 'add', '7', '--issues', 'PP-10'])
  assert.deepEqual(calls.find((call) => call[2] === 'transition'), ['jira', 'issue', 'transition', 'PP-100', '21'])
  const config = JSON.parse(await readFile(env['TALLY_CONFIG_PATH'] as string, 'utf8')) as TallyConfig
  assert.equal(config.projectMapping['789']?.boardId, 42)

  const shown = await tally(['issue', 'show', '1', '--json'], env)
  assert.deepEqual(shown.json.data, { entryId: 1, issueKey: 'PP-100', source: 'timer', worklogId: null, filledBy: null })
  assert.equal((await tally(['issue', 'show', '2', '--json'], env)).json.data, null)

  const again = await tally(['issue', 'open', '1', '--json'], env)
  assert.equal(again.json.data.issueKey, 'PP-100')
  assert.equal(again.json.data.created, false)
  assert.equal((await atlCalls(env)).filter((call) => call[2] === 'create').length, 1)

  const pending = await tally(['summary', '--pending', '--no-notes', '--json'], env)
  const group = pending.json.data.groups.find((item: { entryIds: number[] }) => item.entryIds.includes(1))
  assert.equal(group?.issueKey, 'PP-100')
  const brief = await tally(['summary', '--pending', '--no-notes', '--brief', '--json'], env)
  assert.equal(brief.json.data.groups.find((item: { entryIds: number[] }) => item.entryIds.includes(1))?.issueKey, 'PP-100')

  assert.equal((await tally(['link', '1', '--issue', 'PP-100', '--worklog', '555', '--json'], env)).code, 0)
  const after = await tally(['summary', '--pending', '--no-notes', '--json'], env)
  assert.ok(!after.json.data.groups.some((item: { entryIds: number[] }) => item.entryIds.includes(1)))
})

test('issue open without a mapped project asks for one, listing the mapped Jira projects', async (t) => {
  const { env } = await sandbox(t)
  assert.equal((await tally(['map', 'set', '789', 'PP', '--hierarchy', 'flat-task'], env)).code, 0)
  const asked = await tally(['issue', 'open', '3', '--json'], env)
  assert.equal(asked.code, 4)
  assert.equal(asked.json.error?.code, 'NEEDS_PROJECT')
  assert.deepEqual(asked.json.data.options, [{ jiraProjectKey: 'PP', projectNames: ['Plataforma'], site: null, lastUsedAt: null }])

  const opened = await tally(['issue', 'open', '3', '--jira-project', 'pp', '--json'], env)
  assert.equal(opened.code, 0, opened.stdout + opened.stderr)
  assert.equal(opened.json.data.issueType, 'Tarea')
  assert.equal(opened.json.data.parentKey, null)
  const calls = await atlCalls(env)
  assert.deepEqual(calls.find((call) => call[1] === 'sprint' && call[2] === 'add'), ['jira', 'sprint', 'add', '7', '--issues', 'PP-100'])
  const config = JSON.parse(await readFile(env['TALLY_CONFIG_PATH'] as string, 'utf8')) as TallyConfig
  assert.equal(config.projectMapping['789']?.boardId, undefined)
})

test('issue open on a story hierarchy without stories asks for one', async (t) => {
  const { env } = await sandbox(t)
  assert.equal((await tally(['map', 'set', '789', 'PP', '--no-epic'], env)).code, 0)
  const asked = await tally(['issue', 'open', '1', '--json'], env)
  assert.equal(asked.json.error?.code, 'NEEDS_STORY')
  assert.deepEqual(asked.json.data.options, [])
  const opened = await tally(['issue', 'open', '1', '--story', 'PP-3', '--json'], env)
  assert.equal(opened.json.data.parentKey, 'PP-3')
})

test('issue fill writes the agent text and the automatic fill never overwrites it', async (t) => {
  const { dir, env } = await sandbox(t)
  assert.equal((await tally(['map', 'set', '789', 'PP', '--hierarchy', 'flat-task'], env)).code, 0)
  assert.equal((await tally(['issue', 'open', '2', '--json'], env)).json.data.issueKey, 'PP-100')
  const create = (await atlCalls(env)).find((call) => call[2] === 'create') ?? []
  assert.equal(create[create.indexOf('--summary') + 1], '@[WIP] 2026-10-07')

  const missing = await tally(['issue', 'fill', '1', '--json'], env)
  assert.equal(missing.json.error?.code, 'NO_ISSUE')

  const file = path.join(dir, 'desc.md')
  await writeFile(file, '## Objetivo\nAjustar el pipeline\n')
  const filled = await tally(['issue', 'fill', '2', '--summary', 'Ajustar pipeline', '--description', `@${file}`, '--json'], env)
  assert.equal(filled.code, 0, filled.stdout + filled.stderr)
  assert.equal(filled.json.data.filledBy, 'agent')
  const edit = (await atlCalls(env)).find((call) => call[2] === 'edit') ?? []
  assert.deepEqual(edit, ['jira', 'issue', 'edit', 'PP-100', '--summary', '@Ajustar pipeline', '--description', '@## Objetivo\nAjustar el pipeline\n'])

  const auto = await tally(['issue', 'fill', '2', '--json'], env)
  assert.equal(auto.json.data.skipped, true)
  assert.equal((await atlCalls(env)).filter((call) => call[2] === 'edit').length, 1)

  const db = new DatabaseSync(env['TALLY_DB_PATH'] as string, { readOnly: true })
  const row = db.prepare('SELECT source, worklog_id, filled_by FROM registrations WHERE entry_id = 2').get()
  db.close()
  assert.deepEqual({ ...row }, { source: 'timer', worklog_id: null, filled_by: 'agent' })
})

class FakeWriter implements JiraWriter {
  calls: [string, unknown][] = []
  next = 500
  delayMs = 0

  async myself() {
    return 'acc-me'
  }
  async createIssue(issue: NewJiraIssue) {
    this.calls.push(['create', issue])
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs))
    return { key: `${issue.project}-${this.next++}`, url: null }
  }
  async editIssue(key: string, changes: { summary?: string; description?: string }) {
    this.calls.push(['edit', { key, ...changes }])
  }
  async transitions() {
    return []
  }
  async transition() {}
  async boards() {
    return []
  }
  async activeSprints() {
    return []
  }
  async addToSprint() {}
}

function detail(overrides: Partial<BitaEntryDetail> = {}): BitaEntryDetail {
  return { id: 7, description: 'ajustar pipeline', kind: null, projectId: 789, projectName: 'Plataforma', startedAt: '2026-10-06T16:00:00Z', stoppedAt: '2026-10-06T17:30:00Z', touched: [], ...overrides }
}

function context(config: TallyConfig, entry: BitaEntryDetail, writer = new FakeWriter()): IssueContext & { writerInstance: FakeWriter } {
  const bita: BitaClient = {
    entries: async () => ({ entries: [], range: { fromDay: '', toDay: '', timezone: TEST_TZ }, warnings: [] }),
    entry: async (id) => (id === entry.id ? entry : null),
    projects: async () => [],
    repos: async () => [],
  }
  return { db: openMemoryDatabase(), config, bita, writer: async () => writer, now: NOW, timezone: TEST_TZ, claimWaitMs: 2000, writerInstance: writer }
}

function flatConfig(extra: Partial<ProjectMapping> = {}): TallyConfig {
  return { ...emptyConfig(), jira: { accountId: 'acc-me' }, projectMapping: { '789': { projectName: 'Plataforma', jiraProjectKey: 'PP', hierarchy: 'flat-task', boardId: 1, ...extra } } }
}

test('the start hook opens the card only for auto projects or timers started with --jira', async () => {
  const off = context(flatConfig(), detail())
  assert.equal((await handleTimerEvent(off, { event: 'start', entry: { id: 7, projectId: 789 } })).action, 'ignored')
  assert.equal(off.writerInstance.calls.length, 0)

  const flagged = context(flatConfig(), detail())
  const opened = await handleTimerEvent(flagged, { event: 'start', entry: { id: 7, projectId: 789, jiraIssue: true } })
  assert.deepEqual([opened.action, opened.issueKey], ['opened', 'PP-500'])

  const auto = context(flatConfig({ autoIssue: true }), detail())
  assert.equal((await handleTimerEvent(auto, { event: 'start', entry: { id: 7, projectId: 789 } })).action, 'opened')
  const refused = context(flatConfig({ autoIssue: true }), detail())
  assert.equal((await handleTimerEvent(refused, { event: 'start', entry: { id: 7, projectId: 789, jiraIssue: false } })).action, 'ignored')
})

test('a timer started with --jira on an unmapped project waits for a project choice', async () => {
  const ctx = context(flatConfig(), detail({ projectId: 900, projectName: 'Can Doo' }))
  const outcome = await handleTimerEvent(ctx, { event: 'start', entry: { id: 7, projectId: 900, description: 'sitio', jiraIssue: true } })
  assert.deepEqual([outcome.action, outcome.detail], ['pending', 'NEEDS_PROJECT'])
  assert.deepEqual(listPendingOpens(ctx.db).map((item) => [item.entryId, item.reason, item.description]), [[7, 'project', 'sitio']])

  await openIssue(ctx, 7, { jiraProject: 'PP' })
  assert.deepEqual(listPendingOpens(ctx.db), [])
})

test('the stop hook fills the card automatically, and not after the agent did', async () => {
  const ctx = context(flatConfig(), detail({ touched: ['src/app.ts'] }))
  assert.equal((await handleTimerEvent(ctx, { event: 'stop', entry: { id: 7 } }, async () => null)).action, 'ignored')
  await openIssue(ctx, 7)
  const filled = await handleTimerEvent(ctx, { event: 'stop', entry: { id: 7 } }, async () => null)
  assert.equal(filled.action, 'filled')
  const edit = ctx.writerInstance.calls.find(([kind]) => kind === 'edit')?.[1] as { description: string; summary: string }
  assert.equal(edit.summary, 'ajustar pipeline')
  assert.match(edit.description, /## Archivos tocados\n- `src\/app.ts`/)

  await fillIssue(ctx, 7, { description: 'texto del agente' })
  const skipped = await handleTimerEvent(ctx, { event: 'stop', entry: { id: 7 } }, async () => null)
  assert.deepEqual([skipped.action, skipped.detail], ['skipped', 'filled-by-agent'])
  assert.equal(findRegistration(ctx.db, 7)?.filledBy, 'agent')
})

test('two openers of the same entry create a single card', async () => {
  const writer = new FakeWriter()
  writer.delayMs = 50
  const ctx = context(flatConfig(), detail(), writer)
  const [first, second] = await Promise.all([openIssue(ctx, 7), openIssue(ctx, 7)])
  assert.equal(first.issueKey, second.issueKey)
  assert.equal(writer.calls.filter(([kind]) => kind === 'create').length, 1)
})

test('the automatic description is built from the note, the files and the commits', () => {
  const text = autoDescription({ entry: detail(), note: '## Contexto\nPipeline', touched: ['a.ts'], commits: ['repo: abc123 fix build'], timezone: TEST_TZ, now: NOW })
  assert.equal(
    text,
    '## Objetivo\najustar pipeline\n\n## Hecho\n- repo: abc123 fix build\n\n## Archivos tocados\n- `a.ts`\n\n## Nota\n## Contexto\nPipeline\n\n_Sesión de bita #7 · 2026-10-06 09:00–10:30 (1h 30m)_\n',
  )
})

test('the story, the in-progress transition and the project options are picked deterministically', () => {
  const mapping: ProjectMapping = { projectName: 'Plataforma', jiraProjectKey: 'PP', storiesByEpic: { '': { backend: { key: 'PP-2', summary: 'Backend', verifiedAt: '' }, soporte: { key: 'PP-3', summary: 'Soporte', verifiedAt: '' }, sesiones: { key: 'PP-4', summary: 'Sesiones', verifiedAt: '' } } } }
  assert.equal(pickStory(mapping, null), 'PP-3')
  assert.equal(pickStory(mapping, 'remote-meeting'), 'PP-4')
  assert.equal(pickStory(mapping, 'meeting'), 'PP-4')
  assert.equal(pickStory({ ...mapping, storiesByEpic: { '': { backend: { key: 'PP-2', summary: 'Backend', verifiedAt: '' } } } }, null), 'PP-2')
  assert.equal(pickStory({ ...mapping, parentKey: 'PP-1' }, null), null)

  assert.equal(pickInProgress([{ id: '1', name: 'Revisar', to: 'En revisión', category: 'indeterminate' }, { id: '2', name: 'Empezar', to: 'En progreso', category: 'indeterminate' }])?.id, '2')
  assert.equal(pickInProgress([{ id: '3', name: 'Cerrar', to: 'Cerrada', category: 'done' }]), null)

  const db = openMemoryDatabase()
  register(db, { entryId: 1, issueKey: 'INN-4', linkedAt: '2026-10-01T00:00:00Z' })
  register(db, { entryId: 2, issueKey: 'PP-9', linkedAt: '2026-10-05T00:00:00Z' })
  const config: TallyConfig = { ...emptyConfig(), projectMapping: { '1': { projectName: 'Uno', jiraProjectKey: 'INN' }, '2': { projectName: 'Dos', jiraProjectKey: 'PP' }, '3': { projectName: 'Tres', jiraProjectKey: 'PP' }, '4': { projectName: 'Cuatro', jiraProjectKey: 'ZZ' } } }
  assert.deepEqual(projectOptions(config, db).map((option) => [option.jiraProjectKey, option.projectNames]), [['PP', ['Dos', 'Tres']], ['INN', ['Uno']], ['ZZ', ['Cuatro']]])
  db.close()
})
