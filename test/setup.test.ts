import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { platformContext } from '@kikedealba/kit/platform'
import { CLAUDE_PERMISSIONS, installAgents, legacyClaudeIntegration, uninstallAgents } from '../src/setup.ts'

async function fakeHome(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tally-setup-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const env = { HOME: dir, USERPROFILE: dir, XDG_DATA_HOME: path.join(dir, 'data'), XDG_CONFIG_HOME: path.join(dir, 'config'), LOCALAPPDATA: path.join(dir, 'local'), APPDATA: path.join(dir, 'roaming') }
  const ctx = platformContext({ env, home: dir })
  const homes = { claude: path.join(dir, '.claude'), opencode: path.join(dir, 'opencode'), codex: path.join(dir, '.codex'), agentsSkills: path.join(dir, '.agents', 'skills'), gemini: path.join(dir, '.gemini') }
  const calls: string[][] = []
  const installed = new Set<string>()
  const exec = async (_command: string, args: readonly string[]): Promise<string | void> => {
    calls.push([...args])
    const line = args.join(' ')
    if (line === 'plugin marketplace list --json') return JSON.stringify(installed.has('market') ? [{ name: 'tally' }] : [])
    if (line === 'plugin list --json') return JSON.stringify(installed.has('plugin') ? [{ id: 'tally@tally', scope: 'user' }] : [])
    if (line.startsWith('plugin marketplace add')) installed.add('market')
    if (line.startsWith('plugin install')) installed.add('plugin')
    if (line.startsWith('plugin uninstall')) installed.delete('plugin')
  }
  const locate = async (command: string) => (command === 'claude' ? '/fake/bin/claude' : null)
  return { dir, ctx, homes, calls, options: { ctx, homes, exec, locate, claudeCompat: false as const } }
}

test('setup installs the Claude Code plugin from the tally marketplace and drops the 0.1 files', async (t) => {
  const { homes, calls, options } = await fakeHome(t)
  const legacy = legacyClaudeIntegration()
  await mkdir(path.join(homes.claude, 'skills'), { recursive: true })
  await mkdir(path.join(homes.claude, 'commands'), { recursive: true })
  await symlink(legacy.skills?.[0]?.dir ?? '', path.join(homes.claude, 'skills', 'tally'), 'junction').catch(() => undefined)
  await symlink(legacy.commands?.[0]?.file ?? '', path.join(homes.claude, 'commands', 'tally-pending.md')).catch(() => undefined)
  await writeFile(path.join(homes.claude, 'skills', 'keep.md'), 'mine')

  const steps = await installAgents(['claude'], options)
  assert.ok(!steps.some((step) => step.state === 'failed'), JSON.stringify(steps))
  assert.deepEqual(calls.filter((args) => !args.includes('--json')), [
    ['plugin', 'marketplace', 'add', 'KikeDeAlba/tally'],
    ['plugin', 'marketplace', 'update', 'tally'],
    ['plugin', 'install', 'tally@tally', '--scope', 'user'],
  ])
  assert.ok(!existsSync(path.join(homes.claude, 'skills', 'tally')))
  assert.ok(!existsSync(path.join(homes.claude, 'commands', 'tally-pending.md')))
  assert.ok(existsSync(path.join(homes.claude, 'skills', 'keep.md')))
  const settings = JSON.parse(await readFile(path.join(homes.claude, 'settings.json'), 'utf8'))
  for (const rule of CLAUDE_PERMISSIONS) assert.ok(settings.permissions.allow.includes(rule))
  assert.ok(steps.every((step) => step.agent === 'claude'))

  calls.length = 0
  await installAgents(['claude'], options)
  assert.deepEqual(calls.filter((args) => !args.includes('--json')), [
    ['plugin', 'marketplace', 'update', 'tally'],
    ['plugin', 'update', 'tally@tally', '--scope', 'user'],
  ])

  calls.length = 0
  await uninstallAgents(options)
  assert.deepEqual(calls.filter((args) => !args.includes('--json')), [['plugin', 'uninstall', 'tally@tally', '--scope', 'user']])
  const cleaned = JSON.parse(await readFile(path.join(homes.claude, 'settings.json'), 'utf8'))
  assert.ok(!CLAUDE_PERMISSIONS.some((rule) => (cleaned.permissions?.allow ?? []).includes(rule)))
})

test('the other agents get the skill with its supporting files and the user skills as prompts, never the Claude plugin', async (t) => {
  const { homes, calls, options } = await fakeHome(t)
  const steps = await installAgents(['codex', 'gemini', 'opencode'], options)
  assert.ok(!steps.some((step) => step.state === 'failed'), JSON.stringify(steps))
  assert.deepEqual(calls, [])
  const gemini = path.join(homes.gemini, 'extensions', 'tally')
  for (const file of ['SKILL.md', 'procedure.md', 'meetings.md']) {
    assert.ok(existsSync(path.join(gemini, 'skills', 'tally', file)))
    assert.ok(existsSync(path.join(homes.agentsSkills, 'tally', file)))
    assert.ok(existsSync(path.join(homes.opencode, 'skills', 'tally', file)))
  }
  assert.ok(existsSync(path.join(gemini, 'commands', 'tally-push.toml')))
  assert.ok(existsSync(path.join(homes.codex, 'prompts', 'tally-pending.md')))
  assert.ok(existsSync(path.join(homes.opencode, 'commands', 'tally-push.md')))
  assert.ok(!existsSync(path.join(homes.claude, 'skills', 'tally')))
})

test('the 0.1 files stay when the plugin could not be installed', async (t) => {
  const { homes, options } = await fakeHome(t)
  const legacy = legacyClaudeIntegration()
  await mkdir(path.join(homes.claude, 'commands'), { recursive: true })
  const command = path.join(homes.claude, 'commands', 'tally-push.md')
  await writeFile(command, await readFile(legacy.commands?.[1]?.file ?? '', 'utf8'))
  const steps = await installAgents(['claude'], { ...options, locate: async () => null })
  assert.ok(steps.some((step) => step.state === 'unavailable'))
  assert.ok(existsSync(command))
  await installAgents(['claude'], options)
  assert.ok(!existsSync(command))
})
