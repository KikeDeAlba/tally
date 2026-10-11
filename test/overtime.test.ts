import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineManifest, registerTool } from '@kikedealba/kit/registry'
import { platformContext } from '@kikedealba/kit/platform'
import { monthBounds, monthOvertime, monthsBetween, parseAmount, sumOvertime, type PayRate } from '../src/domain/overtime.ts'
import { buildJql, findStartField, pickUser, resolveMonths } from '../src/cli/commands/overtime.ts'
import { parseCommandArgs } from '../src/cli/args.ts'
import { toJiraField, type JiraUser } from '../src/integrations/atl.ts'
import { bitaEntry } from './helpers/bita-entries.ts'
import { TEST_TZ } from './helpers/entries.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BIN = path.join(HERE, '..', 'src', 'bin', 'tally.ts')
const FAKE_BITA = path.join(HERE, 'helpers', 'fake-bita.ts')
const FAKE_ATL = path.join(HERE, 'helpers', 'fake-atl.ts')
const HOUR = 3600

interface Run {
  code: number
  stdout: string
  stderr: string
  json: { ok: boolean; command?: string; data?: any; meta?: any; error?: { code: string; message: string; hint?: string } }
}

async function tally(args: string[], env: NodeJS.ProcessEnv, input = ''): Promise<Run> {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env }, (error, stdout, stderr) => {
      let json: Run['json'] = { ok: false }
      try {
        json = JSON.parse(stdout.trim().split('\n').at(-1) ?? '')
      } catch {
        json = { ok: false }
      }
      resolve({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, stdout, stderr, json })
    }).stdin?.end(input)
  })
}

async function sandbox(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tally-overtime-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const env: NodeJS.ProcessEnv = {
    PATH: path.dirname(process.execPath),
    HOME: dir,
    USERPROFILE: dir,
    XDG_CONFIG_HOME: path.join(dir, '.config'),
    XDG_DATA_HOME: path.join(dir, '.local', 'share'),
    XDG_STATE_HOME: path.join(dir, '.local', 'state'),
    KIT_REGISTRY_DIR: path.join(dir, 'registry'),
    KIT_CREDENTIALS: 'file',
    TALLY_DB_PATH: path.join(dir, 'tally.db'),
    TALLY_CONFIG_PATH: path.join(dir, 'tally.json'),
    BITA_DB_PATH: path.join(dir, 'bita.db'),
    BITA_CONFIG_PATH: path.join(dir, 'bita.json'),
    FAKE_BITA_STATE: path.join(dir, 'bita-state.json'),
    FAKE_BITA_LOG: path.join(dir, 'bita-calls.log'),
    FAKE_ATL_STATE: path.join(dir, 'atl-state.json'),
    FAKE_ATL_LOG: path.join(dir, 'atl-calls.log'),
  }
  return { dir, env }
}

const USERS = [
  { accountId: 'acc-ana', displayName: 'Ana López', emailAddress: 'ana@example.com', active: true, accountType: 'atlassian' },
  { accountId: 'acc-ana2', displayName: 'Ana Ruiz', active: true, accountType: 'atlassian' },
  { accountId: 'acc-bot', displayName: 'Ana Bot', active: true, accountType: 'app' },
  { accountId: 'acc-mario', displayName: 'Mario Ortega', active: true, accountType: 'atlassian' },
]

const FIELDS = [
  { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string' } },
  { id: 'customfield_10020', name: 'Sprint', custom: true, schema: { type: 'array' } },
  { id: 'customfield_10015', name: 'Start date', custom: true, schema: { type: 'date' } },
]

const ISSUES = [
  { key: 'INN-1', accountId: 'acc-ana', done: true, project: 'INN', start: '2026-10-01', estimate: 100 * HOUR },
  { key: 'INN-2', accountId: 'acc-ana', done: true, project: 'INN', start: '2026-10-15', estimate: 70 * HOUR },
  { key: 'INN-3', accountId: 'acc-ana', done: true, project: 'INN', start: '2026-10-20', estimate: null },
  { key: 'PP-1', accountId: 'acc-ana', done: true, project: 'PP', start: '2026-10-31', estimate: 8 * HOUR },
  { key: 'INN-4', accountId: 'acc-ana', done: false, project: 'INN', start: '2026-10-02', estimate: 40 * HOUR },
  { key: 'INN-5', accountId: 'acc-ana', done: true, project: 'INN', start: '2026-09-30', estimate: 20 * HOUR },
  { key: 'INN-6', accountId: 'acc-mario', done: true, project: 'INN', start: '2026-10-03', estimate: 50 * HOUR },
  { key: 'INN-7', accountId: 'acc-ana', done: true, project: 'INN', start: '2026-11-01', estimate: 9 * HOUR },
  { key: 'INN-8', accountId: 'acc-ana', done: true, project: 'INN', start: '2026-09-30T22:00:00.000-0600', estimate: null },
]

async function withFakeAtl(env: NodeJS.ProcessEnv, state: Record<string, unknown> = {}) {
  await registerTool(defineManifest({ name: 'atl', version: '0.3.0', bin: [process.execPath, FAKE_ATL], capabilities: ['atlassian.sites', 'atlassian.api.call', 'jira.issue.read'] }), platformContext({ env }))
  await writeFile(env['FAKE_ATL_STATE'] as string, JSON.stringify({ users: USERS, fields: FIELDS, issues: ISSUES, pageSize: 2, ...state }))
}

async function atlCalls(env: NodeJS.ProcessEnv): Promise<string[][]> {
  return (await readFile(env['FAKE_ATL_LOG'] as string, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as string[])
}

async function withFakeBita(env: NodeJS.ProcessEnv) {
  await registerTool(defineManifest({ name: 'bita', version: '0.18.1', bin: [process.execPath, FAKE_BITA], capabilities: ['time.entries.read', 'time.entries.write', 'time.events'] }), platformContext({ env }))
  const entries = [
    bitaEntry({ id: 1, start: '2026-09-10T16:00:00Z', durationSeconds: HOUR }),
    bitaEntry({ id: 2, start: '2026-10-06T16:00:00Z', durationSeconds: 2 * HOUR }),
    bitaEntry({ id: 3, start: '2026-10-07T16:00:00Z', durationSeconds: HOUR }),
    bitaEntry({ id: 4, description: 'soporte interno', projectId: 901, projectName: 'Interno', start: '2026-10-08T16:00:00Z', durationSeconds: HOUR }),
    bitaEntry({ id: 5, description: 'sitio de Can Doo', projectId: 900, projectName: 'Can Doo with Pet', jira: false, start: '2026-10-08T18:00:00Z', durationSeconds: 2 * HOUR }),
  ]
  await writeFile(
    env['FAKE_BITA_STATE'] as string,
    JSON.stringify({
      entries,
      filterByRange: true,
      range: { fromDay: '2026-10-01', toDay: '2026-10-31', timezone: TEST_TZ },
      projects: [
        { id: 789, key: 'PLA', name: 'Plataforma', active: true },
        { id: 900, key: 'CDP', name: 'Can Doo with Pet', active: true, jira: false },
        { id: 901, key: 'INT', name: 'Interno', active: true },
      ],
    }),
  )
}

const RATE: PayRate = { salary: 32000, monthlyHours: 160, multiplier: 2, currency: 'MXN' }

test('the formula pays overtime above the monthly hours at the hourly rate and its multiple', () => {
  assert.deepEqual(monthOvertime(170 * HOUR, RATE), { estimateSeconds: 170 * HOUR, expectedSeconds: 160 * HOUR, overtimeSeconds: 10 * HOUR, payX1: 2000, payMultiplied: 4000 })
  assert.deepEqual(monthOvertime(150 * HOUR, RATE), { estimateSeconds: 150 * HOUR, expectedSeconds: 160 * HOUR, overtimeSeconds: 0, payX1: 0, payMultiplied: 0 })
  assert.deepEqual(monthOvertime(161.5 * HOUR, { ...RATE, salary: null }), { estimateSeconds: 161.5 * HOUR, expectedSeconds: 160 * HOUR, overtimeSeconds: 1.5 * HOUR, payX1: null, payMultiplied: null })
  assert.equal(monthOvertime(161 * HOUR, { ...RATE, salary: 10000, multiplier: 3 }).payMultiplied, 187.5)
  const total = sumOvertime([monthOvertime(170 * HOUR, RATE), monthOvertime(165 * HOUR, RATE)], RATE)
  assert.deepEqual(total, { estimateSeconds: 335 * HOUR, expectedSeconds: 320 * HOUR, overtimeSeconds: 15 * HOUR, payX1: 3000, payMultiplied: 6000 })
  assert.equal(sumOvertime([], { ...RATE, salary: null }).payX1, null)
})

test('months, bounds and amounts', () => {
  assert.deepEqual(monthBounds('2026-02'), { fromDay: '2026-02-01', toDay: '2026-02-28' })
  assert.deepEqual(monthBounds('2028-02'), { fromDay: '2028-02-01', toDay: '2028-02-29' })
  assert.deepEqual(monthsBetween('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02'])
  assert.equal(parseAmount('40,000'), 40000)
  assert.equal(parseAmount(' 32000.50\n'), 32000.5)
  assert.equal(parseAmount('-5'), null)
  assert.equal(parseAmount('mucho'), null)
  const now = new Date('2026-10-10T12:00:00Z')
  const months = (argv: string[]) => resolveMonths(parseCommandArgs(argv, { month: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } }), now, TEST_TZ)
  assert.deepEqual(months([]), ['2026-10'])
  assert.deepEqual(months(['--month', '2026-08']), ['2026-08'])
  assert.deepEqual(months(['--from', '2026-08']), ['2026-08', '2026-09', '2026-10'])
  assert.throws(() => months(['--month', '2026-13']), /YYYY-MM/)
  assert.throws(() => months(['--from', '2026-10', '--to', '2026-08']), /Empty range/)
  assert.throws(() => months(['--to', '2026-08']), /needs --from/)
})

test('the JQL takes the assignee, Done, the month bounds on the start field and the excluded projects', () => {
  assert.equal(
    buildJql('acc-ana', 'customfield_10015', '2026-02', ['PP', 'OPS']),
    'assignee = "acc-ana" AND statusCategory = Done AND cf[10015] >= "2026-02-01" AND cf[10015] < "2026-03-01" AND project NOT IN ("PP", "OPS") ORDER BY cf[10015] ASC, key ASC',
  )
  assert.doesNotMatch(buildJql('acc-ana', 'customfield_1', '2026-10', []), /NOT IN/)
})

test('the start field is found by its Spanish or English name, preferring a date field', () => {
  assert.equal(findStartField(FIELDS.map(toJiraField).filter((field) => field !== null))?.id, 'customfield_10015')
  assert.equal(findStartField([{ id: 'customfield_1', name: 'Fecha de Inicio', custom: true, type: 'string' }, { id: 'customfield_2', name: 'fecha de inicio', custom: true, type: 'date' }])?.id, 'customfield_2')
  assert.equal(findStartField([{ id: 'customfield_3', name: 'Fecha  de inicio', custom: true, type: null }])?.id, 'customfield_3')
  assert.equal(findStartField([{ id: 'customfield_4', name: 'Due date', custom: false, type: 'date' }]), null)
})

test('a user search picks the only person, an exact name among several, or reports the candidates', () => {
  const user = (accountId: string, displayName: string, extra: Partial<JiraUser> = {}): JiraUser => ({ accountId, displayName, email: null, active: true, accountType: 'atlassian', ...extra })
  assert.deepEqual(pickUser([user('a', 'Ana López'), user('b', 'Ana Bot', { accountType: 'app' })], 'Ana'), { user: user('a', 'Ana López') })
  assert.deepEqual(pickUser([user('a', 'Ana López'), user('b', 'Ana'), user('c', 'Ana Ruiz')], 'ana'), { user: user('b', 'Ana') })
  assert.deepEqual(pickUser([user('a', 'Ana López'), user('c', 'Ana Ruiz', { active: false })], 'Ana'), { user: user('a', 'Ana López') })
  assert.equal('candidates' in pickUser([user('a', 'Ana López'), user('c', 'Ana Ruiz')], 'Ana') ? 2 : 0, 2)
  assert.deepEqual(pickUser([], 'Zoe'), { candidates: [] })
  assert.deepEqual(pickUser([user('a', 'Ana Pérez', { active: false }), user('b', 'Ana Pérez Gómez')], 'ana perez'), { user: user('a', 'Ana Pérez', { active: false }) })
  const team = [
    user('j1', 'Jesús Enrique De Alba Gaytan'),
    user('j2', 'Jesús Pérez'),
    user('j3', 'Enrique Alba Ruiz'),
    user('j4', 'María De la Rosa'),
    user('j5', 'Jesus Enrique Albarrán Dealba', { active: false }),
  ]
  assert.deepEqual(pickUser(team, 'Jesús Enrique De Alba'), { user: team[0] })
  assert.deepEqual(pickUser(team, 'jesus enrique  de alba'), { user: team[0] })
  assert.deepEqual(pickUser(team, 'Enrique Gayt'), { user: team[0] })
  assert.deepEqual(pickUser([user('m1', 'Mario Ortega', { email: 'mortega@example.com' }), user('m2', 'Mario Ruiz')], 'mario mortega'), { user: user('m1', 'Mario Ortega', { email: 'mortega@example.com' }) })
  const twins = [user('k1', 'Jesús Enrique López'), user('k2', 'Jesús Enrique Mora'), user('k3', 'Jesús Pérez')]
  assert.deepEqual(pickUser(twins, 'Jesus Enrique'), { candidates: [twins[0], twins[1]] })
  assert.deepEqual(pickUser([user('e1', 'Enrique Alba'), user('e2', 'Alba Enrique Soto')], 'Enrique Alba'), { user: user('e1', 'Enrique Alba') })
  assert.deepEqual(pickUser([user('e3', 'Enrique Albarrán'), user('e2', 'Alba Enrique Soto')], 'Enrique Alba'), { candidates: [user('e3', 'Enrique Albarrán'), user('e2', 'Alba Enrique Soto')] })
})

test('overtime --user with several matches answers USER_AMBIGUOUS with the candidates', async (t) => {
  const { env } = await sandbox(t)
  await withFakeAtl(env)
  const result = await tally(['overtime', '--user', 'Ana', '--month', '2026-10', '--json'], env)
  assert.equal(result.code, 4)
  assert.equal(result.json.error?.code, 'USER_AMBIGUOUS')
  assert.deepEqual(result.json.data.candidates, [
    { displayName: 'Ana López', email: 'ana@example.com', accountId: 'acc-ana' },
    { displayName: 'Ana Ruiz', email: null, accountId: 'acc-ana2' },
  ])
  const text = await tally(['overtime', '--user', 'Ana', '--month', '2026-10'], env)
  assert.match(text.stderr, /Ana López <ana@example.com> \(acc-ana\)/)
  assert.match(text.stderr, /--account-id/)
})

test('overtime --user with no match answers USER_NOT_FOUND', async (t) => {
  const { env } = await sandbox(t)
  await withFakeAtl(env)
  const result = await tally(['overtime', '--user', 'Zoe', '--json'], env)
  assert.equal(result.code, 3)
  assert.equal(result.json.error?.code, 'USER_NOT_FOUND')
  assert.equal((await tally(['overtime', '--account-id', 'acc-nobody', '--json'], env)).json.error?.code, 'USER_NOT_FOUND')
})

test('overtime for a coworker sums the original estimate of their Done issues by start date, paging through Jira', async (t) => {
  const { env } = await sandbox(t)
  await withFakeAtl(env)
  const result = await tally(['overtime', '--user', 'Ana López', '--month', '2026-10', '--salary-stdin', '--json'], env, '32,000\n')
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const { data, meta } = result.json
  assert.deepEqual(data.person, { name: 'Ana López', accountId: 'acc-ana', source: 'jira' })
  assert.deepEqual(data.rate, { hourlyRate: 200, monthlyHours: 160, multiplier: 2, currency: 'MXN' })
  const [month] = data.months
  assert.equal(month.month, '2026-10')
  assert.equal(month.estimateSeconds, 178 * HOUR)
  assert.equal(month.overtimeSeconds, 18 * HOUR)
  assert.equal(month.payX1, 3600)
  assert.equal(month.payMultiplied, 7200)
  assert.deepEqual(month.issues.map((issue: { key: string }) => issue.key), ['INN-1', 'INN-2', 'PP-1'])
  assert.deepEqual(month.issues[0], { key: 'INN-1', summary: 'Trabajo INN-1', project: 'INN', status: 'Finalizada', startDate: '2026-10-01', estimateSeconds: 100 * HOUR })
  assert.deepEqual(month.withoutEstimate, [{ key: 'INN-3', summary: 'Trabajo INN-3', project: 'INN', status: 'Finalizada', startDate: '2026-10-20', estimateSeconds: null }])
  assert.deepEqual(data.totals, { estimateSeconds: 178 * HOUR, expectedSeconds: 160 * HOUR, overtimeSeconds: 18 * HOUR, payX1: 3600, payMultiplied: 7200 })
  assert.deepEqual(meta.startField, { id: 'customfield_10015', name: 'Start date', source: 'jira' })
  assert.ok(!result.stdout.includes('32000') && !result.stdout.includes('32,000') && !result.stderr.includes('32'))

  const calls = await atlCalls(env)
  assert.ok(calls.every((call) => call[0] === 'api' && call[1] === 'call'))
  const searches = calls.filter((call) => call[2] === 'jira.searchAndReconsileIssuesUsingJql')
  assert.equal(searches.length, 2)
  const first = JSON.parse(searches[0]![4]!) as Record<string, unknown>
  assert.equal(first['jql'], 'assignee = "acc-ana" AND statusCategory = Done AND cf[10015] >= "2026-10-01" AND cf[10015] < "2026-11-01" ORDER BY cf[10015] ASC, key ASC')
  assert.equal(first['fields'], 'summary,project,status,timeoriginalestimate,customfield_10015,resolutiondate')
  assert.equal((JSON.parse(searches[1]![4]!) as Record<string, unknown>)['nextPageToken'], '2')
})

test('the start field is cached per site, and --start-field overrides it', async (t) => {
  const { env } = await sandbox(t)
  await withFakeAtl(env)
  await tally(['overtime', '--account-id', 'acc-ana', '--site', 'gruposti', '--month', '2026-10', '--json'], env)
  const config = JSON.parse(await readFile(env['TALLY_CONFIG_PATH'] as string, 'utf8'))
  assert.equal(config.overtime.startFields.gruposti.id, 'customfield_10015')
  const second = await tally(['overtime', '--account-id', 'acc-ana', '--site', 'gruposti', '--month', '2026-10', '--json'], env)
  assert.equal(second.json.meta.startField.source, 'cache')
  assert.equal((await atlCalls(env)).filter((call) => call[2] === 'jira.getFields').length, 1)
  assert.ok((await atlCalls(env)).every((call) => call.at(-2) === '--site' && call.at(-1) === 'gruposti'))

  const other = await tally(['overtime', '--account-id', 'acc-ana', '--site', 'otro', '--month', '2026-10', '--json'], env)
  assert.equal(other.json.meta.startField.source, 'jira')
  const unnamed = await tally(['overtime', '--account-id', 'acc-ana', '--month', '2026-10', '--json'], env)
  assert.equal(unnamed.json.meta.startField.source, 'jira')
  assert.equal(Object.keys(JSON.parse(await readFile(env['TALLY_CONFIG_PATH'] as string, 'utf8')).overtime.startFields).sort().join(','), 'gruposti,otro')

  const forced = await tally(['overtime', '--account-id', 'acc-ana', '--start-field', 'customfield_99', '--month', '2026-10', '--json'], env)
  assert.equal(forced.code, 0, forced.stdout + forced.stderr)
  assert.deepEqual(forced.json.meta.startField, { id: 'customfield_99', name: null, source: 'override' })
  assert.match(forced.json.meta.queries[0].jql, /cf\[99\] >= "2026-10-01"/)
  const calls = (await atlCalls(env)).length
  assert.equal((await tally(['overtime', '--account-id', 'acc-ana', '--start-field', 'Start date', '--json'], env)).code, 2)
  assert.equal((await atlCalls(env)).length, calls)
})

test('a site without a start date field fails with START_FIELD_NOT_FOUND', async (t) => {
  const { env } = await sandbox(t)
  await withFakeAtl(env, { fields: [FIELDS[0]] })
  const result = await tally(['overtime', '--account-id', 'acc-ana', '--json'], env)
  assert.equal(result.json.error?.code, 'START_FIELD_NOT_FOUND')
})

test('the common exclusion list drops Jira projects for every coworker, without salary only hours', async (t) => {
  const { env } = await sandbox(t)
  await withFakeAtl(env)
  const added = await tally(['overtime', 'exclude', 'add', 'pp', 'OPS', '--json'], env)
  assert.equal(added.json.command, 'overtime exclude add')
  assert.deepEqual(added.json.data.excludedProjects, ['OPS', 'PP'])
  assert.deepEqual((await tally(['overtime', 'exclude', 'rm', 'OPS', '--json'], env)).json.data.excludedProjects, ['PP'])
  assert.deepEqual((await tally(['overtime', 'exclude', 'ls', '--json'], env)).json.data.excludedProjects, ['PP'])
  assert.deepEqual((await tally(['overtime', '--json', 'exclude', 'ls'], env)).json.data.excludedProjects, ['PP'])
  assert.match((await tally(['overtime', 'exclude', 'ls'], env)).stdout, /Excluded from overtime: PP/)
  assert.equal((await tally(['overtime', 'exclude', 'add', 'not a key', '--json'], env)).code, 2)
  assert.equal((await tally(['overtime', 'exclude', 'add', '--json'], env)).code, 2)

  const result = await tally(['overtime', '--account-id', 'acc-ana', '--from', '2026-09', '--to', '2026-11', '--json'], env)
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const { data, meta } = result.json
  assert.deepEqual(meta.excludedProjects, ['PP'])
  assert.ok(meta.queries.every((query: { jql: string }) => query.jql.includes('project NOT IN ("PP")')))
  assert.deepEqual(
    data.months.map((month: { month: string; estimateSeconds: number; overtimeSeconds: number; payX1: null }) => [month.month, month.estimateSeconds / HOUR, month.overtimeSeconds / HOUR, month.payX1]),
    [
      ['2026-09', 20, 0, null],
      ['2026-10', 170, 10, null],
      ['2026-11', 9, 0, null],
    ],
  )
  assert.deepEqual(data.months[0].withoutEstimate.map((issue: { key: string; startDate: string }) => [issue.key, issue.startDate]), [['INN-8', '2026-09-30']])
  assert.equal(data.rate.hourlyRate, null)
  assert.deepEqual(data.totals, { estimateSeconds: 199 * HOUR, expectedSeconds: 480 * HOUR, overtimeSeconds: 10 * HOUR, payX1: null, payMultiplied: null })

  const text = await tally(['overtime', '--account-id', 'acc-ana', '--month', '2026-10', '--salary', '32000'], env)
  assert.match(text.stdout, /Ana López \(Jira\), 200\.00 MXN per hour/)
  assert.match(text.stdout, /2026-10\s+170h\s+160h\s+10h\s+2,000\.00 MXN\s+4,000\.00 MXN/)
  assert.match(text.stdout, /1 issues without estimate \(INN-3\)/)
})

test('overtime checks its options before reading anything', async (t) => {
  const { env } = await sandbox(t)
  const cases = [
    ['overtime', '--salary', '1000', '--salary-stdin'],
    ['overtime', '--salary', 'mucho'],
    ['overtime', '--user', 'Ana', '--account-id', 'acc-ana'],
    ['overtime', '--user', 'Ana', '--exclude', 'Interno'],
    ['overtime', '--site', 'otro'],
    ['overtime', '--monthly-hours', '0'],
    ['overtime', '--month', '2026-10', '--from', '2026-09'],
  ]
  for (const argv of cases) {
    const result = await tally([...argv, '--json'], env)
    assert.equal(result.code, 2, argv.join(' '))
    assert.equal(result.json.error?.code, 'USAGE_ERROR')
    assert.ok(!result.stdout.includes('mucho'))
  }
  assert.equal((await tally(['overtime', '--user', 'Ana', '--json'], env)).json.error?.code, 'ATL_MISSING')
})

test('your own overtime comes from the tally estimate of your timers per month, only Jira projects', async (t) => {
  const { env } = await sandbox(t)
  await withFakeBita(env)
  const result = await tally(['overtime', '--from', '2026-09', '--to', '2026-10', '--monthly-hours', '2', '--exclude', 'Interno', '--salary-stdin', '--json'], env, '3200')
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const { data, meta } = result.json
  assert.equal(data.person.source, 'timers')
  assert.equal(data.person.accountId, null)
  assert.deepEqual(data.rate, { hourlyRate: 1600, monthlyHours: 2, multiplier: 2, currency: 'MXN' })
  assert.deepEqual(
    data.months.map((month: { month: string; estimateSeconds: number; overtimeSeconds: number; payX1: number; payMultiplied: number; issues: unknown[] }) => [month.month, month.estimateSeconds / HOUR, month.overtimeSeconds / HOUR, month.payX1, month.payMultiplied, month.issues.length]),
    [
      ['2026-09', 1, 0, 0, 0, 0],
      ['2026-10', 3, 1, 1600, 3200, 0],
    ],
  )
  assert.deepEqual(meta.excludedBitaProjects, [901])
  const calls = (await readFile(env['FAKE_BITA_LOG'] as string, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as string[])
  assert.deepEqual(calls.filter((call) => call[0] === 'entries'), [
    ['entries', '--from', '2026-09-01', '--to', '2026-09-30'],
    ['entries', '--from', '2026-10-01', '--to', '2026-10-31'],
  ])

  const all = await tally(['overtime', '--month', '2026-10', '--monthly-hours', '2', '--json'], env)
  assert.equal(all.json.data.months[0].estimateSeconds, 4 * HOUR)
  assert.equal(all.json.data.months[0].payX1, null)
  assert.equal((await tally(['overtime', '--month', '2026-10', '--exclude', 'Nada', '--json'], env)).json.error?.code, 'PROJECT_NOT_FOUND')
})
