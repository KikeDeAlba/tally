import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { assertConformance } from '@kikedealba/kit/conformance'
import { defineManifest, readManifest, registerTool } from '@kikedealba/kit/registry'
import { platformContext } from '@kikedealba/kit/platform'
import { manifest } from '../src/setup.ts'
import { bitaEntry } from './helpers/bita-entries.ts'
import { TEST_TZ } from './helpers/entries.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BIN = path.join(HERE, '..', 'src', 'bin', 'tally.ts')
const FAKE_BITA = path.join(HERE, 'helpers', 'fake-bita.ts')
const FAKE_INKWELL = path.join(HERE, 'helpers', 'fake-inkwell.ts')

interface Run {
  code: number
  stdout: string
  stderr: string
  json: { ok: boolean; data?: any; meta?: any; error?: { code: string; message: string } }
}

async function tally(args: string[], env: NodeJS.ProcessEnv): Promise<Run> {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env }, (error, stdout, stderr) => {
      const line = stdout.trim().split('\n').at(-1) ?? ''
      let json: Run['json'] = { ok: false }
      try {
        json = JSON.parse(line)
      } catch {
        json = { ok: false }
      }
      resolve({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, stdout, stderr, json })
    }).stdin?.end('')
  })
}

async function sandbox(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tally-cli-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const env: NodeJS.ProcessEnv = {
    PATH: path.dirname(process.execPath),
    HOME: dir,
    USERPROFILE: dir,
    XDG_CONFIG_HOME: path.join(dir, '.config'),
    XDG_DATA_HOME: path.join(dir, '.local', 'share'),
    XDG_STATE_HOME: path.join(dir, '.local', 'state'),
    APPDATA: path.join(dir, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(dir, 'AppData', 'Local'),
    CLAUDE_CONFIG_DIR: path.join(dir, '.claude'),
    CODEX_HOME: path.join(dir, '.codex'),
    GEMINI_CLI_HOME: dir,
    KIT_REGISTRY_DIR: path.join(dir, 'registry'),
    KIT_CREDENTIALS: 'file',
    TALLY_DB_PATH: path.join(dir, 'tally.db'),
    TALLY_CONFIG_PATH: path.join(dir, 'tally.json'),
    BITA_DB_PATH: path.join(dir, 'bita.db'),
    BITA_CONFIG_PATH: path.join(dir, 'bita.json'),
    FAKE_BITA_STATE: path.join(dir, 'bita-state.json'),
    FAKE_BITA_LOG: path.join(dir, 'bita-calls.log'),
    FAKE_INKWELL_NOTES: path.join(dir, 'notes.json'),
  }
  return { dir, env }
}

async function withFakeBita(env: NodeJS.ProcessEnv, options: { inkwell?: boolean; legacy?: boolean } = {}) {
  const ctx = platformContext({ env })
  await registerTool(defineManifest({ name: 'bita', version: '0.18.1', bin: [process.execPath, FAKE_BITA], capabilities: ['time.entries.read', 'time.entries.write', 'time.events'] }), ctx)
  if (options.inkwell) {
    await registerTool(defineManifest({ name: 'inkwell', version: '0.2.0', bin: [process.execPath, FAKE_INKWELL], capabilities: ['docs.page.read', 'docs.entry-notes'] }), ctx)
  }
  const entries = [
    bitaEntry({ id: 1, start: '2026-10-06T16:00:00Z', durationSeconds: 3600, segments: [{ id: 4, start: '2026-10-06T20:00:00Z', durationSeconds: 1800 }] }),
    bitaEntry({ id: 2, start: '2026-10-07T16:00:00Z', durationSeconds: 2700 }),
    bitaEntry({ id: 3, description: 'sitio de Can Doo', projectId: 900, projectName: 'Can Doo with Pet', jira: false, start: '2026-10-07T18:00:00Z', durationSeconds: 1800 }),
  ].map((entry) => {
    if (options.legacy) return entry
    const { jira: _jira, registered: _registered, issueKey: _issueKey, bitaRegistered: _bitaRegistered, ...current } = entry
    return current
  })
  await writeFile(
    env['FAKE_BITA_STATE'] as string,
    JSON.stringify({
      entries,
      range: { fromDay: '2026-10-01', toDay: '2026-10-10', timezone: TEST_TZ },
      projects: options.legacy
        ? [
            { id: 789, key: 'PLA', name: 'Plataforma', jira: true, active: true },
            { id: 900, key: 'CDP', name: 'Can Doo with Pet', jira: false, active: true },
          ]
        : [
            { id: 789, key: 'PLA', name: 'Plataforma', clientName: null, active: true },
            { id: 900, key: 'CDP', name: 'Can Doo with Pet', clientName: null, active: true },
          ],
    }),
  )
  await writeFile(env['FAKE_INKWELL_NOTES'] as string, JSON.stringify({ '1': '## Contexto\nPipeline de despliegue\n\n## Qué se hizo\n- se ajustó\n' }))
}

test('tally passes the kit conformance checks', async () => {
  await assertConformance([process.execPath, BIN], manifest())
})

test('summary without bita says how to install it', async (t) => {
  const { env } = await sandbox(t)
  const result = await tally(['summary', '--pending', '--json'], env)
  assert.equal(result.code, 3)
  assert.equal(result.json.error?.code, 'BITA_MISSING')
})

test('summary groups the pending entries from bita, with the notes from inkwell', async (t) => {
  const { env } = await sandbox(t)
  await withFakeBita(env, { inkwell: true })
  const off = await tally(['project', 'jira', 'can doo with pet', 'off', '--json'], env)
  assert.deepEqual(off.json.data, { id: 900, name: 'Can Doo with Pet', jira: false })
  const result = await tally(['summary', '--pending', '--json'], env)
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const { data, meta } = result.json
  assert.equal(data.groups.length, 1)
  const group = data.groups[0]
  assert.equal(group.summary, 'ajustar pipeline')
  assert.deepEqual(group.entryIds, [1, 4, 2])
  assert.deepEqual(group.worklogs.map((worklog: { timeSpent: string }) => worklog.timeSpent), ['1h', '30m', '45m'])
  assert.equal(group.totalHuman, '2h 15m')
  assert.equal(group.estimateHuman, '2h 30m')
  assert.deepEqual(group.docs[0].sections, ['Contexto', 'Qué se hizo'])
  assert.deepEqual(group.pages, [{ pageId: 5, title: 'Pipeline', relPath: 'plataforma/pipeline.md', path: null, body: null, issues: ['INN-9'], refs: [] }])
  assert.deepEqual(group.noteCoverage, { withNote: 1, withoutNote: 2 })
  assert.equal(meta.nonJira.totalSeconds, 1800)
  assert.equal(meta.notes.provider, 'inkwell')
  assert.ok(meta.warnings.some((warning: string) => warning.includes('last 90 days')))
  const calls = (await readFile(env['FAKE_BITA_LOG'] as string, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as string[])
  const entriesCall = calls.find((call) => call[0] === 'entries')
  assert.equal(entriesCall?.[1], '--from')

  const week = await tally(['groups', 'week', '--json'], env)
  assert.equal(week.json.ok, true)
  assert.deepEqual((await readFile(env['FAKE_BITA_LOG'] as string, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as string[]).filter((call) => call[0] === 'entries').at(-1), ['entries', 'week'])
})

test('link marks entries registered, refuses projects outside Jira, and unlink brings them back', async (t) => {
  const { env } = await sandbox(t)
  await withFakeBita(env, { legacy: true })

  const linked = await tally(['link', '1', '4', '--issue', 'PP-5', '--worklog', '77', '--json'], env)
  assert.equal(linked.code, 0, linked.stdout + linked.stderr)
  assert.deepEqual(linked.json.data.entryIds, [1, 4])
  assert.deepEqual(linked.json.data.worklogs, [{ entryId: 1, worklogId: '77' }, { entryId: 4, worklogId: '77' }])

  const pending = await tally(['summary', '--pending', '--no-notes', '--json'], env)
  assert.deepEqual(pending.json.data.groups.flatMap((group: { entryIds: number[] }) => group.entryIds), [2])
  assert.equal(pending.json.meta.alreadyRegistered.count, 2)

  const registered = await tally(['summary', '--registered', '--from', '2026-10-01', '--json'], env)
  assert.deepEqual(registered.json.data.groups.flatMap((group: { entryIds: number[] }) => group.entryIds), [1, 4])

  const db = new DatabaseSync(env['TALLY_DB_PATH'] as string, { readOnly: true })
  const row = db.prepare('SELECT issue_key, worklog_id FROM registrations WHERE entry_id = 1').get() as { issue_key: string; worklog_id: string }
  db.close()
  assert.deepEqual({ ...row }, { issue_key: 'PP-5', worklog_id: '77' })

  const outside = await tally(['link', '3', '--issue', 'PP-5', '--json'], env)
  assert.equal(outside.code, 4)
  assert.equal(outside.json.error?.code, 'NOT_A_JIRA_PROJECT')
  const forced = await tally(['link', '3', '--issue', 'PP-5', '--force', '--json'], env)
  assert.equal(forced.code, 0)

  const missing = await tally(['link', '99', '--issue', 'PP-5', '--json'], env)
  assert.equal(missing.code, 2)
  const badKey = await tally(['link', '2', '--issue', 'nope', '--json'], env)
  assert.equal(badKey.code, 2)

  const unlinked = await tally(['link', '1', '4', '--unlink', '--json'], env)
  assert.deepEqual(unlinked.json.data.entryIds, [1, 4])
  const again = await tally(['summary', '--pending', '--no-notes', '--json'], env)
  assert.deepEqual(again.json.data.groups.flatMap((group: { entryIds: number[] }) => group.entryIds), [1, 4, 2])
})

test('map set, story, list and unset keep the Jira targets in the tally config', async (t) => {
  const { env } = await sandbox(t)
  await withFakeBita(env)
  assert.equal((await tally(['project', 'jira', 'CDP', 'off', '--json'], env)).code, 0)

  const set = await tally(['map', 'set', '789', 'inn', '--parent', 'INN-12', '--json'], env)
  assert.equal(set.code, 0, set.stdout + set.stderr)
  assert.deepEqual(set.json.data, { projectId: 789, projectName: 'Plataforma', jiraProjectKey: 'INN', parentKey: 'INN-12' })

  const outside = await tally(['map', 'set', '900', 'CDP', '--json'], env)
  assert.equal(outside.code, 2)
  const foreign = await tally(['map', 'set', '789', 'INN', '--parent', 'DPF-1', '--json'], env)
  assert.equal(foreign.code, 2)

  const story = await tally(['map', 'story', '789', 'devops', 'INN-40', '--json'], env)
  assert.deepEqual(story.json.data, { projectId: 789, themeId: 'devops', issueKey: 'INN-40', epicKey: 'INN-12' })

  const list = await tally(['map', 'list', '--json'], env)
  assert.equal(list.json.data[0].epicMode, 'fixed')
  assert.equal(list.json.data[0].storiesByEpic['INN-12'].devops.key, 'INN-40')
  assert.deepEqual(
    list.json.data.map((row: { projectId: number; jiraProjectKey: string | null; jira: boolean }) => [row.projectId, row.jiraProjectKey, row.jira]),
    [
      [789, 'INN', true],
      [900, null, false],
    ],
  )
  assert.equal(list.json.data[1].projectName, 'Can Doo with Pet')

  const summary = await tally(['summary', '--pending', '--json'], env)
  assert.equal(summary.json.data.groups[0].jiraProjectKey, 'INN')
  assert.equal(summary.json.data.groups[0].jiraStories.devops.key, 'INN-40')
  assert.deepEqual(summary.json.meta.unmappedProjects, [])

  const board = await tally(['map', 'set', '789', 'INN', '--no-epic', '--json'], env)
  assert.equal(board.code, 0)
  const perRun = await tally(['map', 'story', '789', 'backend', 'INN-41', '--json'], env)
  assert.equal(perRun.code, 2)

  const unset = await tally(['map', 'unset', '789', '--json'], env)
  assert.equal(unset.json.data.removed, true)
  const config = JSON.parse(await readFile(env['TALLY_CONFIG_PATH'] as string, 'utf8'))
  assert.deepEqual(config.projectMapping, {})
})

test('config set-jira and get', async (t) => {
  const { env } = await sandbox(t)
  const set = await tally(['config', 'set-jira', '--site', 'https://acme.atlassian.net', '--atl-site', 'acme', '--account-id', 'acc', '--json'], env)
  assert.equal(set.code, 0)
  const get = await tally(['config', 'get', '--json'], env)
  assert.deepEqual(get.json.data.jira, { siteUrl: 'https://acme.atlassian.net', site: 'acme', accountId: 'acc' })
  assert.equal(get.json.meta.path, env['TALLY_CONFIG_PATH'])
  const empty = await tally(['config', 'set-jira', '--json'], env)
  assert.equal(empty.code, 2)
})

test('migrate --from-bita reads the bita files named by the environment', async (t) => {
  const { env } = await sandbox(t)
  const bita = new DatabaseSync(env['BITA_DB_PATH'] as string)
  bita.exec('CREATE TABLE jira_links (entry_id INTEGER PRIMARY KEY, issue_key TEXT, worklog_id TEXT, linked_at TEXT NOT NULL)')
  bita.prepare('INSERT INTO jira_links VALUES (?, ?, ?, ?)').run(2, 'PP-2', null, '2026-10-01T00:00:00.000Z')
  bita.close()
  await writeFile(env['BITA_CONFIG_PATH'] as string, JSON.stringify({ projectMapping: { '789': { projectName: 'Plataforma', jiraProjectKey: 'INN' } } }))

  const dry = await tally(['migrate', '--from-bita', '--dry-run', '--json'], env)
  assert.equal(dry.code, 0, dry.stdout + dry.stderr)
  assert.equal(dry.json.data.counts.links.copied, 1)
  assert.equal(existsSync(env['TALLY_CONFIG_PATH'] as string), false)

  const real = await tally(['migrate', '--from-bita', '--json'], env)
  assert.equal(real.json.data.counts.mappings.copied, 1)
  await withFakeBita(env, { legacy: true })
  const pending = await tally(['summary', '--pending', '--no-notes', '--json'], env)
  assert.deepEqual(pending.json.data.groups.flatMap((group: { entryIds: number[] }) => group.entryIds), [1, 4])
  assert.equal(pending.json.data.groups[0].jiraProjectKey, 'INN')

  const usage = await tally(['migrate', '--json'], env)
  assert.equal(usage.code, 2)
})

test('setup registers tally and installs the skill and commands in the agents', async (t) => {
  const { dir, env } = await sandbox(t)
  const result = await tally(['setup', '--agents', 'codex,gemini', '--json'], env)
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const registered = await readManifest('tally', platformContext({ env, home: dir }))
  assert.deepEqual(registered?.capabilities, ['timesheet.summary', 'timesheet.map', 'timesheet.link'])
  assert.deepEqual(registered?.subscribes.map((item) => [item.tool, item.events, item.command.at(-1)]), [['bita', ['delete', 'merge'], 'bita-hook']])
  assert.ok(existsSync(path.join(dir, '.gemini', 'extensions', 'tally', 'skills', 'tally', 'SKILL.md')))
  assert.ok(existsSync(path.join(dir, '.gemini', 'extensions', 'tally', 'commands', 'tally-push.toml')))

  const removed = await tally(['uninstall', '--json'], env)
  assert.equal(removed.code, 0)
  assert.equal(await readManifest('tally', platformContext({ env, home: dir })), null)
  assert.ok(!existsSync(path.join(dir, '.gemini', 'extensions', 'tally')))
})

test('project jira turns a project on and off in the tally config, over what bita says', async (t) => {
  const { env } = await sandbox(t)
  await withFakeBita(env, { legacy: true })
  const before = await tally(['project', 'jira', '900', '--json'], env)
  assert.equal(before.json.data.jira, false)
  const on = await tally(['project', 'jira', 'CDP', 'on', '--json'], env)
  assert.equal(on.json.data.jira, true)
  const summary = await tally(['summary', '--pending', '--no-notes', '--json'], env)
  assert.equal(summary.json.meta.nonJira.totalSeconds, 0)
  assert.ok(summary.json.data.groups.some((group: { summary: string }) => group.summary === 'sitio de Can Doo'))
  const list = await tally(['map', 'list', '--json'], env)
  assert.deepEqual(list.json.meta.projectJira, { '900': true })
  assert.deepEqual(list.json.data.map((row: { projectId: number; jira: boolean }) => [row.projectId, row.jira]), [[789, true], [900, true]])
  const unknown = await tally(['project', 'jira', 'nope', 'off', '--json'], env)
  assert.equal(unknown.code, 3)
  const bad = await tally(['project', 'jira', '900', 'maybe', '--json'], env)
  assert.equal(bad.code, 2)
})

test('bita-hook keeps deleted registrations as orphans and records merges', async (t) => {
  const { dir, env } = await sandbox(t)
  await withFakeBita(env, { legacy: true })
  assert.equal((await tally(['link', '1', '4', '--issue', 'PP-5', '--json'], env)).code, 0)

  const mergeDoc = path.join(dir, 'merge.json')
  await writeFile(mergeDoc, JSON.stringify({ schemaVersion: 1, event: 'merge', entry: { id: 2, segments: [{ entryId: 2 }, { entryId: 4 }] }, mergedIds: [4] }))
  const merged = await tally(['bita-hook', '--file', mergeDoc, '--json'], env)
  assert.equal(merged.code, 0, merged.stdout + merged.stderr)
  assert.deepEqual(merged.json.data.merged, [4])
  assert.deepEqual(merged.json.data.conflict, { survivorId: 2, issues: ['PP-5'], pendingEntryIds: [2] })

  const deleteDoc = path.join(dir, 'delete.json')
  await writeFile(deleteDoc, JSON.stringify({ schemaVersion: 1, event: 'delete', entry: { id: 1, segments: [{ entryId: 1 }, { entryId: 4 }] } }))
  const deleted = await tally(['bita-hook', '--file', deleteDoc, '--json'], env)
  assert.deepEqual(deleted.json.data.orphaned, [1, 4])

  const db = new DatabaseSync(env['TALLY_DB_PATH'] as string, { readOnly: true })
  const rows = db.prepare('SELECT entry_id, issue_key, orphaned_at IS NOT NULL AS orphaned FROM registrations ORDER BY entry_id').all()
  const merges = db.prepare('SELECT absorbed_id, survivor_id FROM merges').all()
  db.close()
  assert.deepEqual(rows.map((row) => ({ ...row })), [{ entry_id: 1, issue_key: 'PP-5', orphaned: 1 }, { entry_id: 4, issue_key: 'PP-5', orphaned: 1 }])
  assert.deepEqual(merges.map((row) => ({ ...row })), [{ absorbed_id: 4, survivor_id: 2 }])

  const pending = await tally(['summary', '--pending', '--no-notes', '--json'], env)
  assert.deepEqual(pending.json.data.groups.flatMap((group: { entryIds: number[] }) => group.entryIds), [1, 4, 2])

  const ignored = path.join(dir, 'start.json')
  await writeFile(ignored, JSON.stringify({ event: 'start', entry: { id: 9 } }))
  assert.equal((await tally(['bita-hook', '--file', ignored, '--json'], env)).json.data.ignored, true)
})
