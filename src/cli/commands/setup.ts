import { agents } from '@kikedealba/kit'
import { UsageError } from '../../errors.ts'
import { installAgents, register, stableBinCommand, uninstallAgents, unregister } from '../../setup.ts'
import { configPath, databasePath } from '../../paths.ts'
import { parseCommandArgs, readBoolean, readString } from '../args.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'
import { findTool } from '@kikedealba/kit/registry'

function readAgents(raw: string | undefined): readonly agents.AgentName[] | 'detected' | 'all' {
  if (raw === undefined || raw === 'detected') return 'detected'
  if (raw === 'all') return 'all'
  const names = raw.split(',').map((name) => name.trim()).filter((name) => name.length > 0)
  const unknown = names.filter((name) => !(agents.AGENTS as readonly string[]).includes(name))
  if (unknown.length > 0) throw new UsageError(`Unknown agent: ${unknown.join(', ')}. Use ${agents.AGENTS.join(', ')}, all or detected.`)
  return names as agents.AgentName[]
}

export async function runSetup(argv: readonly string[]): Promise<number> {
  const args = parseCommandArgs(argv, { agents: { type: 'string' }, 'no-agents': { type: 'boolean', default: false } })
  const selection = readAgents(readString(args, 'agents'))
  const bin = await stableBinCommand()
  const manifestPath = await register()
  const steps = readBoolean(args, 'no-agents') ? [] : await installAgents(selection)
  const bita = await findTool('bita', { capability: 'time.entries.read' })
  const inkwell = await findTool('inkwell', { capability: 'docs.entry-notes' })
  const atl = await findTool('atl')
  const siblings = { bita: bita?.manifest.version ?? null, inkwell: inkwell?.manifest.version ?? null, atl: atl?.manifest.version ?? null }
  if (readBoolean(args, 'json')) {
    writeJson(successEnvelope('setup', { manifest: manifestPath, bin, steps, tools: siblings, config: configPath(), database: databasePath() }))
  } else {
    writeOut(`registered in ${manifestPath}`)
    for (const step of steps) writeOut(`${step.state === 'failed' || step.state === 'unavailable' ? '!' : '-'} ${step.agent}: ${step.detail}`)
    writeOut('')
    writeOut(`bita   : ${siblings.bita ?? 'not found (npm install -g @kikedealba/bita && bita setup)'}`)
    writeOut(`atl    : ${siblings.atl ?? 'not found (npm install -g @kikedealba/atl && atl setup)'}`)
    writeOut(`inkwell: ${siblings.inkwell ?? 'not found; summaries carry titles only'}`)
    writeOut('Coming from bita? Run: tally migrate --from-bita')
  }
  return steps.some((step) => step.state === 'failed') ? 1 : 0
}

export async function runUninstall(argv: readonly string[]): Promise<number> {
  const args = parseCommandArgs(argv, {})
  const steps = await uninstallAgents()
  const removed = await unregister()
  if (readBoolean(args, 'json')) {
    writeJson(successEnvelope('uninstall', { unregistered: removed, steps }))
  } else {
    writeOut(`registry: ${removed ? 'removed' : 'not registered'}`)
    for (const step of steps.filter((item) => item.state === 'removed')) writeOut(`- ${step.agent}: ${step.detail}`)
    writeOut(`Registrations and mappings are kept in ${databasePath()} and ${configPath()}.`)
  }
  return 0
}
