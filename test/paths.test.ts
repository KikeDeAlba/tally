import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { platformContext } from '@kikedealba/kit/platform'
import { DRAFT_MAX_AGE_MS, prepareDraft } from '../src/drafts.ts'
import { bitaLocation, draftsDir } from '../src/paths.ts'
import { notify } from '../src/cli/commands/issue.ts'

const never = () => false

test('bita paths keep the unix locations tally always read', () => {
  const ctx = platformContext({ platform: 'linux', home: '/home/ana', env: {} })
  assert.deepEqual(bitaLocation(ctx, never), { database: '/home/ana/.local/share/bita/bita.db', config: '/home/ana/.config/bita/config.json' })
  const xdg = platformContext({ platform: 'darwin', home: '/Users/ana', env: { XDG_DATA_HOME: '/data', XDG_CONFIG_HOME: '/conf' } })
  assert.deepEqual(bitaLocation(xdg, never), { database: '/data/bita/bita.db', config: '/Users/ana/.config/bita/config.json' })
  assert.equal(bitaLocation(xdg, (file) => file === '/conf/bita/config.json').config, '/conf/bita/config.json')
  assert.equal(bitaLocation(xdg, (file) => file === '/Users/ana/.local/share/bita/bita.db').database, '/Users/ana/.local/share/bita/bita.db')
})

test('bita paths on windows come from the kit folders, with the old home folders as fallback', () => {
  const env = { APPDATA: 'C:\\Users\\ana\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local' }
  const ctx = platformContext({ platform: 'win32', home: 'C:\\Users\\ana', env })
  assert.deepEqual(bitaLocation(ctx, never), { database: 'C:\\Users\\ana\\AppData\\Local\\bita\\bita.db', config: 'C:\\Users\\ana\\AppData\\Roaming\\bita\\config.json' })
  const legacy = bitaLocation(ctx, (file) => file.startsWith('C:\\Users\\ana\\.'))
  assert.deepEqual(legacy, { database: 'C:\\Users\\ana\\.local\\share\\bita\\bita.db', config: 'C:\\Users\\ana\\.config\\bita\\config.json' })
  assert.deepEqual(bitaLocation(platformContext({ platform: 'win32', home: 'C:\\x', env: { BITA_DB_PATH: 'D:\\b.db', BITA_CONFIG_PATH: 'D:\\c.json' } }), never), { database: 'D:\\b.db', config: 'D:\\c.json' })
})

test('drafts live in a per-user folder of the system temp dir unless TALLY_DRAFTS_DIR says otherwise', () => {
  const linux = draftsDir(platformContext({ platform: 'linux', home: '/home/ana', env: {} }), '/tmp')
  assert.match(linux, typeof process.getuid === 'function' ? /^\/tmp\/tally-\d+\/drafts$/ : /^\/tmp\/tally\/drafts$/)
  assert.equal(draftsDir(platformContext({ platform: 'win32', home: 'C:\\Users\\ana', env: {} }), 'C:\\Temp'), 'C:\\Temp\\tally\\drafts')
  assert.equal(draftsDir(platformContext({ env: { TALLY_DRAFTS_DIR: '/x/drafts' } })), '/x/drafts')
})

test('a draft is a fresh path every time, old drafts are pruned and bad names are refused', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'tally-drafts-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = path.join(root, 'tally', 'drafts')
  const first = await prepareDraft(dir, 'desc')
  const second = await prepareDraft(dir, 'desc.md')
  assert.notEqual(first, second)
  assert.equal(path.dirname(first), dir)
  assert.match(path.basename(first), /^desc-[0-9a-f]{8}\.md$/)
  assert.ok(!existsSync(first))
  if (process.platform !== 'win32') assert.equal((await stat(dir)).mode & 0o777, 0o700)

  await writeFile(first, 'old')
  await writeFile(second, 'new')
  const old = new Date(Date.now() - DRAFT_MAX_AGE_MS - 60_000)
  await utimes(first, old, old)
  await prepareDraft(dir, 'comment')
  assert.ok(!existsSync(first))
  assert.ok(existsSync(second))

  for (const name of ['../escape', 'a/b', '', '-flag', 'x'.repeat(60)]) await assert.rejects(prepareDraft(dir, name), { code: 'USAGE_ERROR' }, name)
})

test('a drafts folder that is a symlink is refused', { skip: process.platform === 'win32' }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'tally-drafts-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'elsewhere'))
  await symlink(path.join(root, 'elsewhere'), path.join(root, 'tally'))
  await assert.rejects(prepareDraft(path.join(root, 'tally', 'drafts'), 'desc'), { code: 'DRAFTS_DIR_UNSAFE' })
})

test('notify stays quiet with TALLY_NO_NOTIFY', async () => {
  assert.equal(process.env['TALLY_NO_NOTIFY'], '1')
  assert.equal(await notify('tally', 'test'), false)
})
