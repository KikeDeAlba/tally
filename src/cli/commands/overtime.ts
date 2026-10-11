import { userInfo } from 'node:os'
import { NotFoundError, TallyError, UsageError } from '../../errors.ts'
import { formatDuration } from '../../domain/duration.ts'
import {
  DEFAULT_CURRENCY,
  DEFAULT_MONTHLY_HOURS,
  DEFAULT_MULTIPLIER,
  MAX_MONTHS,
  hourlyRate,
  isValidMonth,
  monthBounds,
  monthOvertime,
  monthsBetween,
  nextMonth,
  parseAmount,
  roundMoney,
  sumOvertime,
  type MonthOvertime,
  type PayRate,
} from '../../domain/overtime.ts'
import { localDay } from '../../domain/timezone.ts'
import { requireBita, type BitaEntry } from '../../integrations/bita.ts'
import { issueUrl, JiraReader, record, requireAtl, text, type JiraField, type JiraUser } from '../../integrations/atl.ts'
import { configPath } from '../../paths.ts'
import { cachedStartField, cacheStartField, excludedJiraProjects, readConfig, updateExcludedJiraProjects, type TallyConfig } from '../../state/config.ts'
import { parseCommandArgs, readBoolean, readString, readStringList, type ParsedArgs } from '../args.ts'
import { successEnvelope, writeErr, writeJson, writeOut } from '../output.ts'
import { renderTable } from '../table.ts'
import { buildStatus, resolveProjectRef } from './status.ts'

const OVERTIME_OPTIONS = {
  month: { type: 'string' as const },
  from: { type: 'string' as const },
  to: { type: 'string' as const },
  user: { type: 'string' as const },
  'account-id': { type: 'string' as const },
  site: { type: 'string' as const },
  'start-field': { type: 'string' as const },
  salary: { type: 'string' as const },
  'salary-stdin': { type: 'boolean' as const, default: false },
  'monthly-hours': { type: 'string' as const },
  multiplier: { type: 'string' as const },
  currency: { type: 'string' as const },
  exclude: { type: 'string' as const, multiple: true },
  'include-running': { type: 'boolean' as const, default: false },
}

const EXCLUDE_USAGE = 'Usage: tally overtime exclude add|rm <JIRAKEY>... | tally overtime exclude ls'

export const START_FIELD_NAMES = ['fecha de inicio', 'start date']

export interface OvertimeIssue {
  key: string
  summary: string
  project: string | null
  status: string | null
  startDate: string | null
  estimateSeconds: number | null
  url: string | null
}

export interface OvertimeMonth extends MonthOvertime {
  month: string
  issues: OvertimeIssue[]
  withoutEstimate: OvertimeIssue[]
}

export interface OvertimePerson {
  name: string
  accountId: string | null
  source: 'timers' | 'jira'
}

export interface OvertimeReport {
  person: OvertimePerson
  rate: { hourlyRate: number | null; monthlyHours: number; multiplier: number; currency: string }
  months: OvertimeMonth[]
  totals: MonthOvertime
}

export interface StartField {
  id: string
  name: string | null
  source: 'override' | 'cache' | 'jira'
}

function positiveNumber(args: ParsedArgs, name: string, fallback: number): number {
  const raw = readString(args, name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new UsageError(`Invalid value for --${name}: "${raw}". Expected a positive number.`)
  return value
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new UsageError('--salary-stdin reads the salary from standard input; pipe or redirect it, e.g. <<< 40000.')
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer))
  return Buffer.concat(chunks).toString('utf8')
}

export async function readSalary(args: ParsedArgs, stdin: () => Promise<string> = readStdin): Promise<number | null> {
  const inline = readString(args, 'salary')
  const fromStdin = readBoolean(args, 'salary-stdin')
  if (inline !== undefined && fromStdin) throw new UsageError('Pass the salary with --salary or --salary-stdin, not both.')
  if (inline === undefined && !fromStdin) return null
  const value = parseAmount(inline ?? (await stdin()))
  if (value === null) throw new UsageError('Invalid salary. Expected a positive amount such as 40000 or 40,000.')
  return value
}

export function resolveMonths(args: ParsedArgs, now: Date, timezone: string): string[] {
  const month = readString(args, 'month')
  const from = readString(args, 'from')
  const to = readString(args, 'to')
  for (const [name, value] of [['month', month], ['from', from], ['to', to]] as const) {
    if (value !== undefined && !isValidMonth(value)) throw new UsageError(`Invalid month for --${name}: "${value}". Expected format YYYY-MM.`)
  }
  if (month !== undefined && (from !== undefined || to !== undefined)) throw new UsageError('Use either --month or --from/--to, not both.')
  const current = localDay(now, timezone).slice(0, 7)
  if (month !== undefined) return [month]
  if (from === undefined && to !== undefined) throw new UsageError('--to needs --from.')
  if (from === undefined) return [current]
  const last = to ?? current
  if (from > last) throw new UsageError(`Empty range: --from ${from} is after --to ${last}.`)
  const months = monthsBetween(from, last)
  if (months.length > MAX_MONTHS) throw new UsageError(`At most ${MAX_MONTHS} months per query; got ${months.length}.`)
  return months
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function pickUser(users: readonly JiraUser[], query: string): { user: JiraUser } | { candidates: JiraUser[] } {
  const people = users.filter((user) => user.accountType === null || user.accountType === 'atlassian')
  const wanted = normalize(query)
  const exactAll = people.filter((user) => normalize(user.displayName) === wanted || (user.email !== null && normalize(user.email) === wanted))
  const exactActive = exactAll.filter((user) => user.active)
  if (exactActive.length === 1) return { user: exactActive[0]! }
  if (exactActive.length === 0 && exactAll.length === 1) return { user: exactAll[0]! }
  if (exactAll.length > 1) return { candidates: exactActive.length > 1 ? exactActive : exactAll }
  const active = people.filter((user) => user.active)
  const pool = active.length > 0 ? active : people
  if (pool.length === 1) return { user: pool[0]! }
  const queryWords = words(query)
  const covering = queryWords.length === 0 ? [] : pool.filter((user) => {
    const own = [...words(user.displayName), ...(user.email ? words(user.email) : [])]
    return queryWords.every((word) => own.some((candidate) => candidate.startsWith(word)))
  })
  if (covering.length === 1) return { user: covering[0]! }
  return { candidates: covering.length > 1 ? covering : pool }
}

function words(value: string): string[] {
  return normalize(value).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0)
}

function candidate(user: JiraUser) {
  return { displayName: user.displayName, email: user.email, accountId: user.accountId }
}

export async function resolvePerson(jira: JiraReader, args: { user?: string; accountId?: string }): Promise<JiraUser> {
  if (args.accountId !== undefined) {
    const found = (await jira.findUsers({ accountId: args.accountId })).find((user) => user.accountId === args.accountId)
    if (!found) throw new NotFoundError(`No Jira user has accountId "${args.accountId}".`, 'USER_NOT_FOUND')
    return found
  }
  const query = args.user ?? ''
  const result = pickUser(await jira.findUsers({ query }), query)
  if ('user' in result) return result.user
  if (result.candidates.length === 0) throw new NotFoundError(`No Jira user matches "${query}".`, 'USER_NOT_FOUND', 'Check the spelling or try the email.')
  const list = result.candidates.map((user) => `${user.displayName}${user.email ? ` <${user.email}>` : ''} (${user.accountId})`).join(', ')
  throw new TallyError(`Several Jira users match "${query}": ${list}.`, 'USER_AMBIGUOUS', {
    hint: 'Pick one and pass --account-id <accountId>.',
    exitCode: 4,
    data: { query, candidates: result.candidates.map(candidate) },
  })
}

export function findStartField(fields: readonly JiraField[]): JiraField | null {
  const named = fields.filter((field) => START_FIELD_NAMES.includes(normalize(field.name)))
  return named.find((field) => field.type === 'date') ?? named.find((field) => field.custom) ?? named[0] ?? null
}

export function checkStartFieldOverride(override: string | undefined): void {
  if (override !== undefined && !/^customfield_\d+$/.test(override)) throw new UsageError(`Invalid --start-field "${override}". Expected an id like customfield_10015.`)
}

export async function resolveStartField(jira: JiraReader, config: TallyConfig, siteKey: string | undefined, override: string | undefined, now: Date): Promise<StartField> {
  if (override !== undefined) {
    checkStartFieldOverride(override)
    return { id: override, name: null, source: 'override' }
  }
  const cached = siteKey === undefined ? null : cachedStartField(config, siteKey)
  if (cached) return { id: cached.id, name: cached.name, source: 'cache' }
  const field = findStartField(await jira.fields())
  if (!field) {
    throw new NotFoundError('Jira has no "Fecha de inicio" or "Start date" field on this site.', 'START_FIELD_NOT_FOUND', 'Pass --start-field customfield_<id> with the start date field.')
  }
  if (siteKey !== undefined) await cacheStartField(siteKey, { id: field.id, name: field.name, resolvedAt: now.toISOString() })
  return { id: field.id, name: field.name, source: 'jira' }
}

export function fieldClause(fieldId: string): string {
  const custom = /^customfield_(\d+)$/.exec(fieldId)
  return custom ? `cf[${custom[1]}]` : `"${fieldId}"`
}

export function buildJql(accountId: string, fieldId: string, month: string, excluded: readonly string[]): string {
  const { fromDay } = monthBounds(month)
  const field = fieldClause(fieldId)
  const clauses = [`assignee = "${accountId.replace(/"/g, '')}"`, 'statusCategory = Done', `${field} >= "${fromDay}"`, `${field} < "${nextMonth(month)}-01"`]
  if (excluded.length > 0) clauses.push(`project NOT IN (${excluded.map((key) => `"${key}"`).join(', ')})`)
  return `${clauses.join(' AND ')} ORDER BY ${field} ASC, key ASC`
}

export function toOvertimeIssue(key: string, fields: Record<string, unknown>, startFieldId: string, baseUrl: string | null = null): OvertimeIssue {
  const estimate = fields['timeoriginalestimate']
  const start = text(fields[startFieldId])
  return {
    key,
    summary: text(fields['summary']) ?? '',
    project: text(record(fields['project'])['key']),
    status: text(record(fields['status'])['name']),
    startDate: start ? start.slice(0, 10) : null,
    estimateSeconds: typeof estimate === 'number' && estimate > 0 ? estimate : null,
    url: issueUrl(baseUrl, key),
  }
}

const MAX_PAGES = 200

export async function searchAll(jira: JiraReader, jql: string, startFieldId: string, baseUrl: string | null = null): Promise<OvertimeIssue[]> {
  const fields = ['summary', 'project', 'status', 'timeoriginalestimate', startFieldId, 'resolutiondate']
  const issues: OvertimeIssue[] = []
  let token: string | null = null
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await jira.searchPage(jql, fields, token)
    for (const issue of result.issues) issues.push(toOvertimeIssue(issue.key, issue.fields, startFieldId, baseUrl))
    if (!result.nextPageToken || result.issues.length === 0) return issues
    token = result.nextPageToken
  }
  throw new TallyError(`Jira kept paging past ${MAX_PAGES} pages for one month.`, 'TOO_MANY_PAGES')
}

export function buildMonth(month: string, estimateSeconds: number, rate: PayRate, issues: OvertimeIssue[] = []): OvertimeMonth {
  return {
    month,
    ...monthOvertime(estimateSeconds, rate),
    issues: issues.filter((issue) => issue.estimateSeconds !== null),
    withoutEstimate: issues.filter((issue) => issue.estimateSeconds === null),
  }
}

export function buildReport(person: OvertimePerson, rate: PayRate, months: OvertimeMonth[]): OvertimeReport {
  const perHour = hourlyRate(rate)
  return {
    person,
    rate: { hourlyRate: perHour === null ? null : roundMoney(perHour), monthlyHours: rate.monthlyHours, multiplier: rate.multiplier, currency: rate.currency },
    months,
    totals: sumOvertime(months, rate),
  }
}

function jiraMonth(month: string, issues: OvertimeIssue[], rate: PayRate): OvertimeMonth {
  const estimate = issues.reduce((sum, issue) => sum + (issue.estimateSeconds ?? 0), 0)
  return buildMonth(month, estimate, rate, issues)
}

async function coworkerReport(args: ParsedArgs, config: TallyConfig, months: string[], rate: PayRate, now: Date) {
  const site = readString(args, 'site') ?? config.jira?.site
  const jira = new JiraReader(await requireAtl(), site)
  const pendingSiteUrl = jira.siteUrl().catch(() => null)
  const user = readString(args, 'user')
  const accountId = readString(args, 'account-id')
  const person = await resolvePerson(jira, { ...(user === undefined ? {} : { user }), ...(accountId === undefined ? {} : { accountId }) })
  const startField = await resolveStartField(jira, config, site, readString(args, 'start-field'), now)
  const siteUrl = await pendingSiteUrl
  const warnings: string[] = siteUrl === null ? [`atl did not report the URL of ${site === undefined ? 'its default site' : `site "${site}"`}; issue links are omitted.`] : []
  const excluded = excludedJiraProjects(config)
  const queries: { month: string; jql: string }[] = []
  const result: OvertimeMonth[] = []
  for (const month of months) {
    const jql = buildJql(person.accountId, startField.id, month, excluded)
    queries.push({ month, jql })
    result.push(jiraMonth(month, await searchAll(jira, jql, startField.id, siteUrl), rate))
  }
  return {
    report: buildReport({ name: person.displayName, accountId: person.accountId, source: 'jira' }, rate, result),
    meta: { site: site ?? null, siteUrl, startField, excludedProjects: excluded, queries, warnings },
  }
}

async function selfReport(args: ParsedArgs, config: TallyConfig, months: string[], rate: PayRate, now: Date) {
  const bita = await requireBita()
  const timezone = readString(args, 'timezone') ?? (typeof config.timezone === 'string' ? config.timezone : undefined)
  const includeRunning = readBoolean(args, 'include-running')
  const fetched = []
  for (const month of months) {
    const { fromDay, toDay } = monthBounds(month)
    fetched.push({ month, bita: await bita.entries(['--from', fromDay, '--to', toDay, ...(timezone ? ['--timezone', timezone] : [])]) })
  }
  const refs = readStringList(args, 'exclude')
  let excluded = new Set<number>()
  if (refs.length > 0) {
    const projects = await bita.projects()
    const entries: BitaEntry[] = fetched.flatMap((item) => item.bita.entries)
    excluded = new Set(refs.map((ref) => resolveProjectRef(ref, entries, projects)).filter((id): id is number => id !== null))
  }
  const warnings: string[] = []
  const result = fetched.map(({ month, bita: monthEntries }) => {
    const status = buildStatus({ bita: monthEntries, registrations: new Map(), hasRegistrations: true, config }, { includeRunning, withEntries: false, now })
    for (const warning of status.meta.warnings) if (warning.includes('--include-running')) warnings.push(`${month}: ${warning}`)
    const estimate = status.data.projects.filter((project) => project.jira && !(project.projectId !== null && excluded.has(project.projectId))).reduce((sum, project) => sum + project.estimateSeconds, 0)
    return buildMonth(month, estimate, rate)
  })
  const name = config.jira?.email ?? userInfo().username
  return {
    report: buildReport({ name, accountId: config.jira?.accountId ?? null, source: 'timers' }, rate, result),
    meta: { excludedBitaProjects: [...excluded], includeRunning, warnings },
  }
}

function money(value: number | null, currency: string): string {
  return value === null ? '-' : `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

export function hyperlinksSupported(stream: { isTTY?: boolean } = process.stdout, env: NodeJS.ProcessEnv = process.env): boolean {
  if (stream.isTTY !== true) return false
  if (env['NO_COLOR'] !== undefined && env['NO_COLOR'] !== '') return false
  return env['TERM'] !== 'dumb'
}

export function issueLabel(issue: Pick<OvertimeIssue, 'key' | 'url'>, links: boolean): string {
  return links && issue.url !== null ? `\u001b]8;;${issue.url}\u001b\\${issue.key}\u001b]8;;\u001b\\` : issue.key
}

function printReport(report: OvertimeReport): void {
  const hours = (seconds: number) => (seconds === 0 ? '-' : formatDuration(seconds))
  const paid = report.rate.hourlyRate !== null
  const columns = [
    { header: 'MONTH' },
    { header: 'ESTIMATE', align: 'right' as const },
    { header: 'EXPECTED', align: 'right' as const },
    { header: 'OVERTIME', align: 'right' as const },
    ...(paid ? [{ header: 'PAY x1', align: 'right' as const }, { header: `PAY x${report.rate.multiplier}`, align: 'right' as const }] : []),
  ]
  const row = (label: string, item: MonthOvertime) => [
    label,
    hours(item.estimateSeconds),
    hours(item.expectedSeconds),
    hours(item.overtimeSeconds),
    ...(paid ? [money(item.payX1, report.rate.currency), money(item.payMultiplied, report.rate.currency)] : []),
  ]
  const rows = report.months.map((month) => row(month.month, month))
  if (report.months.length > 1) rows.push(row('TOTAL', report.totals))
  const who = report.person.source === 'jira' ? `${report.person.name} (Jira)` : `${report.person.name} (timers)`
  writeOut(`${who}${paid ? `, ${money(report.rate.hourlyRate, report.rate.currency)} per hour` : ''}`)
  writeOut(renderTable(columns, rows))
  const links = hyperlinksSupported()
  for (const month of report.months) {
    if (month.withoutEstimate.length > 0) writeOut(`${month.month}: ${month.withoutEstimate.length} issues without estimate (${month.withoutEstimate.map((issue) => issueLabel(issue, links)).join(', ')}).`)
  }
  if (!paid) writeOut('Hours only; pass --salary-stdin (or --salary N) for the pay.')
}

async function runExclude(argv: readonly string[]): Promise<number> {
  const args = parseCommandArgs(argv, {})
  const [action, ...keys] = args.positionals
  const normalized = keys.map((key) => key.trim().toUpperCase())
  if (action === 'ls' && normalized.length === 0) {
    return printExcluded(args, excludedJiraProjects(await readConfig()), 'overtime exclude ls')
  }
  if ((action !== 'add' && action !== 'rm') || normalized.length === 0) throw new UsageError(EXCLUDE_USAGE)
  const invalid = normalized.find((key) => !/^[A-Z][A-Z0-9_]*$/.test(key))
  if (invalid !== undefined) throw new UsageError(`"${invalid}" is not a Jira project key.`, EXCLUDE_USAGE)
  const next = await updateExcludedJiraProjects((current) => (action === 'add' ? [...current, ...normalized] : current.filter((key) => !normalized.includes(key))))
  return printExcluded(args, next, `overtime exclude ${action}`)
}

function printExcluded(args: ParsedArgs, keys: string[], command: string): number {
  if (readBoolean(args, 'json')) writeJson(successEnvelope(command, { excludedProjects: keys }, { path: configPath() }))
  else writeOut(keys.length === 0 ? 'No Jira projects are excluded from overtime.' : `Excluded from overtime: ${keys.join(', ')}`)
  return 0
}

export async function runOvertime(argv: readonly string[], now: Date = new Date()): Promise<number> {
  const head = argv.findIndex((arg) => !arg.startsWith('-'))
  if (head !== -1 && argv[head] === 'exclude') return runExclude([...argv.slice(0, head), ...argv.slice(head + 1)])
  const args = parseCommandArgs(argv, OVERTIME_OPTIONS)
  if (args.positionals.length > 0) throw new UsageError(`Unexpected argument "${args.positionals[0]}".`, 'Run "tally help".')
  const user = readString(args, 'user')
  const accountId = readString(args, 'account-id')
  if (user !== undefined && accountId !== undefined) throw new UsageError('Pass --user or --account-id, not both.')
  if (user !== undefined && user.trim().length < 2) throw new UsageError('--user needs at least two characters.')
  const coworker = user !== undefined || accountId !== undefined
  if (coworker && readStringList(args, 'exclude').length > 0) throw new UsageError('--exclude takes bita projects and only applies to your own timers; for coworkers use "tally overtime exclude add <KEY>".')
  if (!coworker) {
    for (const name of ['site', 'start-field']) if (readString(args, name) !== undefined) throw new UsageError(`--${name} only applies with --user or --account-id.`)
  }
  checkStartFieldOverride(readString(args, 'start-field'))

  const config = await readConfig()
  const timezone = readString(args, 'timezone') ?? (typeof config.timezone === 'string' ? config.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone)
  const months = resolveMonths(args, now, timezone)
  const rate: PayRate = {
    salary: await readSalary(args),
    monthlyHours: positiveNumber(args, 'monthly-hours', DEFAULT_MONTHLY_HOURS),
    multiplier: positiveNumber(args, 'multiplier', DEFAULT_MULTIPLIER),
    currency: readString(args, 'currency') ?? DEFAULT_CURRENCY,
  }

  const { report, meta } = coworker ? await coworkerReport(args, config, months, rate, now) : await selfReport(args, config, months, rate, now)
  if (readBoolean(args, 'json')) {
    writeJson(successEnvelope('overtime', report, meta))
    for (const warning of meta.warnings) writeErr(`Warning: ${warning}`)
    return 0
  }
  printReport(report)
  for (const warning of meta.warnings) writeErr(`Warning: ${warning}`)
  return 0
}
