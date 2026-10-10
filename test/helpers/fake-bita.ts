import { appendFileSync, readFileSync } from 'node:fs'

interface State {
  entries: { id: number; projectId: number | null; projectName: string | null; description: string; kind: string | null; start: string; stop: string | null; segments?: { entryId: number }[] }[]
  range: { fromDay: string; toDay: string; timezone: string }
  projects: { id: number; name: string; jira: boolean }[]
}

const args = process.argv.slice(2).filter((arg) => arg !== '--json')
const state = JSON.parse(readFileSync(process.env['FAKE_BITA_STATE'] ?? '', 'utf8')) as State
const log = process.env['FAKE_BITA_LOG']
if (log) appendFileSync(log, `${JSON.stringify(args)}\n`)

function reply(command: string, data: unknown, meta?: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: true, command, generatedAt: new Date().toISOString(), ...(meta ? { meta } : {}), data })}\n`)
}

function fail(command: string, code: string, message: string, exit: number): void {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: false, command, generatedAt: new Date().toISOString(), error: { code, message } })}\n`)
  process.exitCode = exit
}

const [head, sub, third] = args
if (head === 'capabilities') {
  reply('capabilities', { name: 'bita', version: '0.18.1', envelope: 1, capabilities: ['time.entries.read', 'time.entries.write', 'time.events'], emits: [] })
} else if (head === 'entries' && sub === 'get') {
  const id = Number(third)
  const entry = state.entries.find((item) => item.id === id) ?? state.entries.find((item) => (item.segments ?? []).some((segment) => segment.entryId === id))
  if (!entry) fail('entries get', 'ENTRY_NOT_FOUND', `No entry #${id}.`, 3)
  else reply('entries get', { id, description: entry.description, kind: entry.kind, projectId: entry.projectId, projectName: entry.projectName, startedAt: entry.start, stoppedAt: entry.stop, note: null })
} else if (head === 'entries') {
  reply('entries', state.entries, { range: state.range, warnings: [] })
} else if (head === 'projects') {
  reply('projects', state.projects)
} else {
  fail(head ?? '', 'UNKNOWN_COMMAND', `Unknown command "${head}".`, 2)
}
