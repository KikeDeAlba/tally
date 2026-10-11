import { existsSync } from 'node:fs'
import path from 'node:path'
import { agents } from '@kikedealba/kit'
import { platformContext, type PlatformContext } from '@kikedealba/kit/platform'
import { defineManifest, registerTool, stableBin, unregisterTool, type ToolManifest } from '@kikedealba/kit/registry'
import { PACKAGE_ROOT, VERSION } from './version.ts'
import { SUBSCRIBED_EVENTS } from './cli/commands/hook.ts'

export const CAPABILITIES = ['timesheet.summary', 'timesheet.status', 'timesheet.map', 'timesheet.link']

export const INSTALL_HINT = 'npm install -g @kikedealba/tally && tally setup'

export const USER_SKILLS = ['tally-pending', 'tally-push']

export const CLAUDE_PLUGIN: agents.ClaudePluginSpec = { marketplace: 'KikeDeAlba/tally', marketplaceName: 'tally', plugin: 'tally' }

export const CLAUDE_PERMISSIONS = [
  'Bash(tally summary:*)',
  'Bash(tally groups:*)',
  'Bash(tally status:*)',
  'Bash(tally map list:*)',
  'Bash(tally map set:*)',
  'Bash(tally map story:*)',
  'Bash(tally project jira:*)',
  'Bash(tally link:*)',
  'Bash(tally config get:*)',
  'Bash(tally capabilities:*)',
  'Bash(tally --version)',
]

export function binEntry(): string {
  const built = path.join(PACKAGE_ROOT, 'dist', 'bin', 'tally.js')
  return existsSync(built) ? built : path.join(PACKAGE_ROOT, 'src', 'bin', 'tally.ts')
}

export function binCommand(): string[] {
  return [process.execPath, binEntry()]
}

export async function stableBinCommand(ctx?: PlatformContext): Promise<string[]> {
  return stableBin('tally', VERSION, binCommand(), ctx)
}

export function manifest(bin: readonly string[] = binCommand()): ToolManifest {
  return defineManifest({
    name: 'tally',
    version: VERSION,
    description: 'Groups bita time entries into Jira-ready work and tracks what was logged',
    bin: [...bin],
    capabilities: CAPABILITIES,
    subscribes: [{ tool: 'bita', events: [...SUBSCRIBED_EVENTS], command: [...bin, 'bita-hook'] }],
    homepage: 'https://github.com/KikeDeAlba/tally',
    install: INSTALL_HINT,
  })
}

export function integration(): agents.AgentIntegration {
  return {
    tool: 'tally',
    version: VERSION,
    description: 'Time from bita grouped into Jira work through tally',
    skills: [{ name: 'tally', dir: path.join(PACKAGE_ROOT, 'skills', 'tally') }],
    userSkills: USER_SKILLS.map((name) => ({ name, dir: path.join(PACKAGE_ROOT, 'skills', name) })),
  }
}

export function legacyClaudeIntegration(): agents.AgentIntegration {
  return {
    tool: 'tally',
    version: VERSION,
    skills: [{ name: 'tally', dir: path.join(PACKAGE_ROOT, 'skill') }],
    commands: USER_SKILLS.map((name) => ({ name, file: path.join(PACKAGE_ROOT, 'legacy', 'commands', `${name}.md`) })),
  }
}

export function claudePermissionsIntegration(): agents.AgentIntegration {
  return { tool: 'tally', version: VERSION, claude: { permissions: { allow: [...CLAUDE_PERMISSIONS] } } }
}

export type AgentSelection = readonly agents.AgentName[] | 'detected' | 'all'

async function resolveSelection(selection: AgentSelection, options: agents.InstallOptions): Promise<agents.AgentName[]> {
  if (selection === 'all') return [...agents.AGENTS]
  if (selection === 'detected') {
    const ctx = options.ctx ?? platformContext()
    return agents.detectAgents(ctx, agents.agentHomes(ctx, options.homes), options.locate)
  }
  return [...selection]
}

export async function installAgents(selection: AgentSelection, options: agents.InstallOptions = {}): Promise<agents.Step[]> {
  const targets = await resolveSelection(selection, options)
  const steps: agents.Step[] = []
  if (targets.includes('claude')) {
    const plugin = await agents.installClaudePlugin(CLAUDE_PLUGIN, options)
    steps.push(...plugin)
    if (!plugin.some((step) => step.state === 'failed' || step.state === 'unavailable')) {
      steps.push(...(await agents.removeLegacyClaude(legacyClaudeIntegration(), options)))
    }
    steps.push(...(await agents.installIntegration(claudePermissionsIntegration(), { ...options, agents: ['claude'] })))
  }
  const others = targets.filter((agent) => agent !== 'claude')
  if (others.length > 0) steps.push(...(await agents.installIntegration(integration(), { ...options, agents: others })))
  return steps
}

export async function uninstallAgents(options: agents.InstallOptions = {}): Promise<agents.Step[]> {
  const steps: agents.Step[] = []
  steps.push(...(await agents.uninstallClaudePlugin(CLAUDE_PLUGIN, options)))
  steps.push(...(await agents.removeLegacyClaude(legacyClaudeIntegration(), options)))
  steps.push(...(await agents.uninstallIntegration(claudePermissionsIntegration(), { ...options, agents: ['claude'] })))
  steps.push(...(await agents.uninstallIntegration(integration(), { ...options, agents: agents.AGENTS.filter((agent) => agent !== 'claude') })))
  return steps
}

export async function register(ctx?: PlatformContext): Promise<string> {
  return registerTool(manifest(await stableBinCommand(ctx)), ctx)
}

export async function unregister(ctx?: PlatformContext): Promise<boolean> {
  return unregisterTool('tally', ctx)
}
