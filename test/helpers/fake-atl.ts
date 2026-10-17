import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

interface FakeIssue {
  key: string
  accountId: string
  done: boolean
  project: string
  start: string | null
  estimate: number | null
  summary?: string
  status?: string
}

interface State {
  users: Record<string, unknown>[]
  fields: Record<string, unknown>[]
  issues: FakeIssue[]
  pageSize?: number
  sites?: Record<string, unknown>[]
  sitesFail?: boolean
  myself?: Record<string, unknown>
  nextIssue?: number
  boards?: Record<string, unknown>[]
  sprints?: Record<string, unknown>[]
  transitions?: Record<string, unknown>[]
  createFails?: boolean
}

const args = process.argv.slice(2).filter((arg) => arg !== '--json')
const state = JSON.parse(readFileSync(process.env['FAKE_ATL_STATE'] ?? '', 'utf8')) as State
const log = process.env['FAKE_ATL_LOG']
const logged = args.map((arg) => (arg.startsWith('@') && existsSync(arg.slice(1)) ? `@${readFileSync(arg.slice(1), 'utf8')}` : arg))
if (log) appendFileSync(log, `${JSON.stringify(logged)}\n`)

function reply(command: string, data: unknown): void {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: true, command, generatedAt: new Date().toISOString(), data })}\n`)
}

function fail(command: string, code: string, message: string, exit: number): void {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: false, command, generatedAt: new Date().toISOString(), error: { code, message } })}\n`)
  process.exitCode = exit
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function search(input: Record<string, unknown>) {
  const jql = String(input['jql'] ?? '')
  const assignee = /assignee = "([^"]+)"/.exec(jql)?.[1]
  const field = /cf\[(\d+)\] >= "([^"]+)"/.exec(jql)
  const upper = /cf\[\d+\] < "([^"]+)"/.exec(jql)?.[1]
  const excluded = (/project NOT IN \(([^)]*)\)/.exec(jql)?.[1] ?? '').split(',').map((key) => key.trim().replace(/"/g, '')).filter(Boolean)
  const done = jql.includes('statusCategory = Done')
  const fieldId = field ? `customfield_${field[1]}` : ''
  const matches = state.issues.filter(
    (issue) =>
      issue.accountId === assignee &&
      (!done || issue.done) &&
      issue.start !== null &&
      field !== null &&
      issue.start >= (field[2] ?? '') &&
      issue.start < (upper ?? '') &&
      !excluded.includes(issue.project),
  )
  const size = state.pageSize ?? 100
  const offset = Number(input['nextPageToken'] ?? 0)
  const page = matches.slice(offset, offset + size)
  const next = offset + size < matches.length ? String(offset + size) : undefined
  const wanted = String(input['fields'] ?? '').split(',')
  return {
    issues: page.map((issue) => {
      const all: Record<string, unknown> = {
        summary: issue.summary ?? `Trabajo ${issue.key}`,
        project: { key: issue.project },
        status: { name: issue.status ?? 'Finalizada' },
        timeoriginalestimate: issue.estimate,
        resolutiondate: '2026-10-30T12:00:00.000-0600',
        [fieldId]: issue.start,
      }
      return { id: issue.key, key: issue.key, fields: Object.fromEntries(Object.entries(all).filter(([key]) => wanted.includes(key))) }
    }),
    ...(next ? { nextPageToken: next } : { isLast: true }),
  }
}

const [head, sub, operation] = args
if (head === 'capabilities') {
  reply('capabilities', { name: 'atl', version: '0.3.0', envelope: 1, capabilities: ['atlassian.sites', 'atlassian.api.call', 'jira.issue.read'], emits: [] })
} else if (head === 'jira' && sub === 'myself') {
  reply('jira myself', state.myself ?? { accountId: 'acc-me', displayName: 'Yo' })
} else if (head === 'jira' && sub === 'issue' && operation === 'create') {
  if (state.createFails) fail('jira issue create', 'HTTP_400', 'Field customfield_10015 is not on the screen.', 4)
  else {
    const number = state.nextIssue ?? 100
    const project = args[args.indexOf('--project') + 1] ?? 'X'
    writeFileSync(process.env['FAKE_ATL_STATE'] ?? '', JSON.stringify({ ...state, nextIssue: number + 1 }))
    reply('jira issue create', { id: String(number), key: `${project}-${number}`, url: `https://example.atlassian.net/browse/${project}-${number}` })
  }
} else if (head === 'jira' && sub === 'issue' && operation === 'edit') {
  reply('jira issue edit', { key: args[3] })
} else if (head === 'jira' && sub === 'issue' && operation === 'transitions') {
  reply('jira issue transitions', state.transitions ?? [])
} else if (head === 'jira' && sub === 'issue' && operation === 'transition') {
  reply('jira issue transition', { id: args[4], name: 'moved', to: null })
} else if (head === 'jira' && sub === 'board' && operation === 'ls') {
  reply('jira board ls', state.boards ?? [])
} else if (head === 'jira' && sub === 'sprint' && operation === 'ls') {
  reply('jira sprint ls', state.sprints ?? [])
} else if (head === 'jira' && sub === 'sprint' && operation === 'add') {
  reply('jira sprint add', { sprint: Number(args[3]), moved: (args[args.indexOf('--issues') + 1] ?? '').split(',') })
} else if (head === 'site' && sub === 'ls') {
  if (state.sitesFail) fail('site ls', 'CONFIG_ERROR', 'No sites configured.', 1)
  else reply('site ls', state.sites ?? [])
} else if (head === 'api' && sub === 'call') {
  const input = JSON.parse(args[args.indexOf('--args') + 1] ?? '{}') as Record<string, unknown>
  if (operation === 'jira.findUsers') {
    if (typeof input['accountId'] === 'string') reply('api call', state.users.filter((user) => user['accountId'] === input['accountId']))
    else {
      const query = normalize(String(input['query'] ?? ''))
      reply('api call', state.users.filter((user) => normalize(String(user['displayName'] ?? '')).includes(query) || normalize(String(user['emailAddress'] ?? '')).includes(query)))
    }
  } else if (operation === 'jira.getFields') reply('api call', state.fields)
  else if (operation === 'jira.searchAndReconsileIssuesUsingJql') reply('api call', search(input))
  else fail('api call', 'OPERATION_NOT_FOUND', `Unknown operation ${operation}.`, 3)
} else {
  fail(head ?? '', 'UNKNOWN_COMMAND', `Unknown command "${head}".`, 2)
}
