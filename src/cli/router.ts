import { ToolMissingError } from '@kikedealba/kit/registry'
import { EXIT, TallyError } from '../errors.ts'
import { CAPABILITIES } from '../setup.ts'
import { VERSION } from '../version.ts'
import { errorEnvelope, successEnvelope, writeErr, writeJson, writeOut } from './output.ts'
import { runSummary } from './commands/summary.ts'
import { runStatus } from './commands/status.ts'
import { runMap } from './commands/map.ts'
import { runLink } from './commands/link.ts'
import { runConfig } from './commands/config.ts'
import { runMigrate } from './commands/migrate.ts'
import { runSetup, runUninstall } from './commands/setup.ts'
import { runProject } from './commands/project.ts'
import { runBitaHook } from './commands/hook.ts'

export const HELP = `tally ${VERSION} — bita time grouped into Jira-ready work, and what was already logged

Usage:
  tally summary [preset] [--pending|--registered] [--include-running] [--json]
                [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--last-days N] [--timezone TZ]
                [--case-insensitive] [--max-task-hours N] [--estimate-step-minutes N]
                [--no-notes] [--notes-mode inline|path|both] [--notes-budget-kb N] [--brief]
  tally groups ...                 Same as summary
  tally status [preset] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--last-days N] [--timezone TZ]
               [--project <id|key|name>] [--entries] [--include-running] [--estimate-step-minutes N] [--json]
                                   Registered, pending, excluded and outside-Jira time and estimate per project
  tally map list [--json]
  tally map set <projectId> <JIRAKEY> [--parent KEY-123 | --no-epic] [--issue-type NAME] [--hierarchy H]
  tally map unset <projectId>
  tally map story <projectId> <themeId> <ISSUE-KEY> [--epic KEY-123 | --no-epic] [--summary TEXT]
  tally link <entryIds...> --issue KEY [--worklog ID] [--force]
  tally link <entryIds...> --unlink
  tally project jira <id|key|name> [on|off]   Whether a bita project's time goes to Jira
  tally config get [--json]
  tally config set-jira [--site URL] [--atl-site NAME] [--account-id ID] [--cloud-id ID] [--issue-type NAME]
  tally migrate --from-bita [--dry-run]
  tally capabilities [--json]
  tally setup [--agents detected|all|claude,opencode,codex,gemini] [--no-agents]
  tally uninstall
  tally bita-hook < event.json     Handles bita delete and merge events (called by bita through kit)
  tally help | --version

Presets: today, yesterday, week, last-week, month, last-month.
Entries come from bita (bita entries --json); per-entry notes from inkwell when it is installed.
Jira is written by the agent through atl; tally records it with "tally link".
`

function commandName(argv: readonly string[]): string {
  const words = argv.filter((arg) => !arg.startsWith('-'))
  const head = words[0] ?? 'help'
  if (['map', 'config', 'project'].includes(head) && words[1]) return `${head} ${words[1]}`
  return head
}

async function dispatch(argv: readonly string[]): Promise<number> {
  const [head, ...rest] = argv
  switch (head) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      writeOut(HELP)
      return EXIT.ok
    case '--version':
    case '-v':
    case 'version':
      writeOut(VERSION)
      return EXIT.ok
    case 'capabilities': {
      const data = { name: 'tally', version: VERSION, envelope: 1, capabilities: CAPABILITIES, emits: [] as string[] }
      if (rest.includes('--json')) writeJson(successEnvelope('capabilities', data))
      else writeOut(`tally ${VERSION}\nCapabilities: ${CAPABILITIES.join(', ')}`)
      return EXIT.ok
    }
    case 'summary':
      return runSummary(rest, 'summary')
    case 'groups':
      return runSummary(rest, 'groups')
    case 'status':
      return runStatus(rest)
    case 'map':
      return runMap(rest)
    case 'link':
      return runLink(rest)
    case 'config':
      return runConfig(rest)
    case 'project':
      return runProject(rest)
    case 'bita-hook':
      return runBitaHook(rest)
    case 'migrate':
      return runMigrate(rest)
    case 'setup':
      return runSetup(rest)
    case 'uninstall':
      return runUninstall(rest)
    default:
      throw new TallyError(`Unknown command "${head}".`, 'UNKNOWN_COMMAND', { hint: 'Run "tally help".', exitCode: EXIT.usage })
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const json = argv.includes('--json')
  const command = commandName(argv)
  if (argv.includes('--help') || argv.includes('-h')) {
    writeOut(HELP)
    return EXIT.ok
  }
  try {
    return await dispatch(argv)
  } catch (error) {
    const known = error instanceof TallyError || error instanceof ToolMissingError
    const code = known ? error.code : 'UNEXPECTED'
    const message = error instanceof Error ? error.message : String(error)
    const hint = known ? error.hint : undefined
    if (json) writeJson(errorEnvelope(command, { code, message, ...(hint ? { hint } : {}) }))
    else {
      writeErr(`Error: ${message}`)
      if (hint) writeErr(hint)
      if (!known && process.env['TALLY_DEBUG'] && error instanceof Error && error.stack) writeErr(error.stack)
    }
    return error instanceof TallyError ? error.exitCode : EXIT.failure
  }
}
