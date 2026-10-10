import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/db/open.ts'
import { findRegistration, listRegistrations } from '../src/db/registrations.ts'
import { migrateFromBita } from '../src/migrate/from-bita.ts'
import { readConfig, setProjectMapping } from '../src/state/config.ts'

function openIn(t: { after: (fn: () => Promise<void>) => void }, dir: string) {
  const db = openDatabase(path.join(dir, 'tally.db'))
  t.after(async () => {
    db.close()
    await rm(dir, { recursive: true, force: true })
  })
  return db
}

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'tally-migrate-'))
  const bitaDatabase = path.join(dir, 'bita.db')
  const bitaConfig = path.join(dir, 'bita-config.json')
  const tallyConfig = path.join(dir, 'tally', 'config.json')

  const bita = new DatabaseSync(bitaDatabase)
  bita.exec(`CREATE TABLE entries (id INTEGER PRIMARY KEY, description TEXT)`)
  bita.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, atlassian_site TEXT)`)
  bita.prepare('INSERT INTO projects VALUES (?, ?, ?)').run(7, 'Apartados', 'https://acme.atlassian.net')
  bita.prepare('INSERT INTO projects VALUES (?, ?, ?)').run(8, 'Global', null)
  bita.exec(`CREATE TABLE jira_links (entry_id INTEGER PRIMARY KEY REFERENCES entries (id), issue_key TEXT, worklog_id TEXT, linked_at TEXT NOT NULL)`)
  for (const id of [1, 2, 3]) bita.prepare('INSERT INTO entries (id, description) VALUES (?, ?)').run(id, `entry ${id}`)
  bita.prepare('INSERT INTO jira_links VALUES (?, ?, ?, ?)').run(1, 'PP-1', null, '2026-09-01T00:00:00.000Z')
  bita.prepare('INSERT INTO jira_links VALUES (?, ?, ?, ?)').run(2, 'PP-1', '9001', '2026-09-01T00:00:00.000Z')
  bita.close()

  await writeFile(
    bitaConfig,
    JSON.stringify({
      version: 1,
      timezone: 'America/Mazatlan',
      jira: { siteUrl: 'https://acme.atlassian.net', accountId: 'acc-1', email: 'me@acme.com' },
      atlassian: { sites: [{ site: 'https://acme.atlassian.net', email: 'me@acme.com' }] },
      defaults: { issueTypeName: 'Tarea', storyThemes: [{ id: 'devops', name: 'DevOps' }, { id: 'qa', name: 'Calidad' }] },
      projectMapping: {
        '7': { projectName: 'Apartados', jiraProjectKey: 'VBAA', parentKey: 'VBAA-639', stories: { infra: { key: 'VBAA-680', summary: 'Infraestructura', verifiedAt: 'x' } } },
        '8': { projectName: 'Global', jiraProjectKey: 'VBGLOBAL', epicResolved: true, storiesByEpic: { '': { soporte: { key: 'VBGLOBAL-9', summary: 'Soporte', verifiedAt: 'x' } } } },
      },
      scopeMapping: { 'gitlab.com/x': { projectId: 7, projectName: 'Apartados', slugSource: 'remote' } },
    }),
  )
  return { dir, bitaDatabase, bitaConfig, tallyConfig }
}

async function digest(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

test('a dry run counts what would move and writes nothing', async (t) => {
  const paths = await fixture()
  const db = openIn(t, paths.dir)
  const report = await migrateFromBita(db, paths, { dryRun: true })
  assert.deepEqual(report.counts.links, { found: 2, copied: 2, skipped: 0 })
  assert.deepEqual(report.counts.mappings, { found: 2, copied: 2, merged: 0, skipped: 0 })
  assert.deepEqual(report.counts.stories, { found: 2, copied: 2 })
  assert.deepEqual(report.counts.themes, { found: 2, copied: 2 })
  assert.equal(listRegistrations(db).length, 0)
  assert.equal(existsSync(paths.tallyConfig), false)
  assert.equal(report.migratedAt, null)
})

test('the migration copies links, mappings, stories, themes and jira settings, and leaves bita alone', async (t) => {
  const paths = await fixture()
  const before = [await digest(paths.bitaDatabase), await digest(paths.bitaConfig)]
  const db = openIn(t, paths.dir)

  const report = await migrateFromBita(db, paths, { dryRun: false })
  assert.deepEqual(report.counts.links, { found: 2, copied: 2, skipped: 0 })
  assert.equal(findRegistration(db, 1)?.issueKey, 'PP-1')
  assert.equal(findRegistration(db, 2)?.worklogId, '9001')
  assert.equal(findRegistration(db, 2)?.source, 'bita')
  assert.equal(findRegistration(db, 3), undefined)

  const config = await readConfig(paths.tallyConfig)
  assert.equal(config.projectMapping['7']?.storiesByEpic?.['VBAA-639']?.['infra']?.key, 'VBAA-680')
  assert.equal(config.projectMapping['8']?.epicResolved, true)
  assert.equal(config.projectMapping['7']?.site, 'https://acme.atlassian.net')
  assert.equal(config.projectMapping['8']?.site, undefined)
  assert.deepEqual(config.defaults?.storyThemes?.map((theme) => theme.id), ['devops', 'qa'])
  assert.equal(config.defaults?.issueTypeName, 'Tarea')
  assert.equal(config.jira?.accountId, 'acc-1')
  assert.equal(config.timezone, 'America/Mazatlan')
  assert.equal('scopeMapping' in config, false)
  assert.equal('atlassian' in config, false)

  assert.deepEqual([await digest(paths.bitaDatabase), await digest(paths.bitaConfig)], before)
})

test('running it again changes nothing, and what tally already had wins', async (t) => {
  const paths = await fixture()
  const db = openIn(t, paths.dir)
  await setProjectMapping(7, { projectName: 'Apartados', jiraProjectKey: 'VBAA', parentKey: 'VBAA-700' }, paths.tallyConfig)

  const first = await migrateFromBita(db, paths, { dryRun: false })
  assert.deepEqual(first.counts.mappings, { found: 2, copied: 1, merged: 1, skipped: 0 })
  const config = await readConfig(paths.tallyConfig)
  assert.equal(config.projectMapping['7']?.parentKey, 'VBAA-700')
  assert.equal(config.projectMapping['7']?.storiesByEpic?.['VBAA-639']?.['infra']?.key, 'VBAA-680')

  const second = await migrateFromBita(db, paths, { dryRun: false })
  assert.deepEqual(second.counts.links, { found: 2, copied: 0, skipped: 2 })
  assert.deepEqual(second.counts.mappings, { found: 2, copied: 0, merged: 0, skipped: 2 })
  assert.deepEqual(second.counts.stories, { found: 2, copied: 0 })
  assert.equal(second.counts.themes.copied, 0)
  assert.deepEqual(second.counts.jiraSettings.copied, [])
})

test('without any bita data the migration says where it looked', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tally-migrate-'))
  const db = openIn(t, dir)
  await assert.rejects(
    migrateFromBita(db, { bitaDatabase: path.join(dir, 'none.db'), bitaConfig: path.join(dir, 'none.json'), tallyConfig: path.join(dir, 'c.json') }, { dryRun: false }),
    (error: Error & { code?: string }) => error.code === 'BITA_DATA_MISSING',
  )
})
