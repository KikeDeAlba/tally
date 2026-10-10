import { existsSync } from 'node:fs'
import path from 'node:path'
import { agents } from '@kikedealba/kit'
import type { PlatformContext } from '@kikedealba/kit/platform'
import { defineManifest, registerTool, stableBin, unregisterTool, type ToolManifest } from '@kikedealba/kit/registry'
import { PACKAGE_ROOT, VERSION } from './version.ts'

export const CAPABILITIES = ['timesheet.summary', 'timesheet.map', 'timesheet.link']

export const INSTALL_HINT = 'npm install -g @kikedealba/tally && tally setup'

export const COMMANDS = ['tally-pending', 'tally-push']

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
    homepage: 'https://github.com/KikeDeAlba/tally',
    install: INSTALL_HINT,
  })
}

export function integration(): agents.AgentIntegration {
  return {
    tool: 'tally',
    version: VERSION,
    description: 'Time from bita grouped into Jira work through tally',
    skills: [{ name: 'tally', dir: path.join(PACKAGE_ROOT, 'skill') }],
    commands: COMMANDS.map((name) => ({ name, file: path.join(PACKAGE_ROOT, 'commands', `${name}.md`) })),
    claude: {
      permissions: {
        allow: [
          'Bash(tally summary:*)',
          'Bash(tally groups:*)',
          'Bash(tally map list:*)',
          'Bash(tally map set:*)',
          'Bash(tally map story:*)',
          'Bash(tally link:*)',
          'Bash(tally config get:*)',
          'Bash(tally capabilities:*)',
          'Bash(tally --version)',
        ],
      },
    },
  }
}

export async function register(ctx?: PlatformContext): Promise<string> {
  return registerTool(manifest(await stableBinCommand(ctx)), ctx)
}

export async function unregister(ctx?: PlatformContext): Promise<boolean> {
  return unregisterTool('tally', ctx)
}
