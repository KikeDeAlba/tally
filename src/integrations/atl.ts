import { invokeTool, requireTool, ToolMissingError, type FoundTool } from '@kikedealba/kit/registry'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ConflictError, NotFoundError, TallyError } from '../errors.ts'

export const ATL_INSTALL_HINT = 'npm install -g @kikedealba/atl && atl setup'
export const ATL_CAPABILITY = 'atlassian.api.call'

export const READ_OPERATIONS = ['jira.findUsers', 'jira.getFields', 'jira.searchAndReconsileIssuesUsingJql'] as const
export type ReadOperation = (typeof READ_OPERATIONS)[number]

export interface JiraUser {
  accountId: string
  displayName: string
  email: string | null
  active: boolean
  accountType: string | null
}

export interface JiraField {
  id: string
  name: string
  custom: boolean
  type: string | null
}

export interface JiraSearchPage {
  issues: { key: string; fields: Record<string, unknown> }[]
  nextPageToken: string | null
}

export interface AtlSite {
  name: string
  url: string
  default: boolean
}

export interface AtlClient {
  call(operation: ReadOperation, args: Record<string, unknown>, site?: string): Promise<unknown>
  sites?(): Promise<AtlSite[]>
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function toJiraUser(raw: unknown): JiraUser | null {
  const data = record(raw)
  const accountId = text(data['accountId'])
  if (!accountId) return null
  return {
    accountId,
    displayName: text(data['displayName']) ?? accountId,
    email: text(data['emailAddress']) || null,
    active: data['active'] !== false,
    accountType: text(data['accountType']),
  }
}

export function toJiraField(raw: unknown): JiraField | null {
  const data = record(raw)
  const id = text(data['id'])
  const name = text(data['name'])
  if (!id || !name) return null
  return { id, name, custom: data['custom'] === true, type: text(record(data['schema'])['type']) }
}

export function toAtlSite(raw: unknown): AtlSite | null {
  const data = record(raw)
  const name = text(data['name'])
  const url = text(data['url'])
  if (!name || !url) return null
  return { name, url, default: data['default'] === true }
}

export function siteOrigin(value: string | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname.includes('.')) return null
    return url.origin
  } catch {
    return null
  }
}

export function siteBaseUrl(sites: readonly AtlSite[], site: string | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  const wanted = site?.trim()
  if (wanted) {
    const name = wanted.toLowerCase()
    const origin = siteOrigin(wanted)
    const found = sites.find((item) => item.name.toLowerCase() === name) ?? (origin === null ? undefined : sites.find((item) => siteOrigin(item.url) === origin))
    return found ? siteOrigin(found.url) : origin
  }
  const fallback = sites.find((item) => item.default) ?? sites[0]
  return fallback ? siteOrigin(fallback.url) : siteOrigin(env['ATL_SITE_URL'])
}

export function issueUrl(baseUrl: string | null, key: string): string | null {
  return baseUrl === null ? null : `${baseUrl}/browse/${encodeURIComponent(key)}`
}

function atlFailure(operation: string, error: { code?: string; message?: string; hint?: string } | undefined): TallyError {
  const code = error?.code ? `ATL_${error.code.replace(/^ATL_/, '')}` : 'ATL_FAILED'
  return new ConflictError(`atl api call ${operation}: ${error?.message ?? 'failed'}`, code, error?.hint)
}

export class CliAtl implements AtlClient {
  readonly tool: FoundTool

  constructor(tool: FoundTool) {
    this.tool = tool
  }

  async call(operation: ReadOperation, args: Record<string, unknown>, site?: string): Promise<unknown> {
    if (!READ_OPERATIONS.includes(operation)) throw new TallyError(`tally only reads from Jira; "${operation}" is not allowed.`, 'ATL_OPERATION_NOT_ALLOWED')
    const argv = ['api', 'call', operation, '--args', JSON.stringify(args), ...(site ? ['--site', site] : [])]
    const { envelope } = await invokeTool(this.tool, argv, { timeoutMs: 120_000 })
    if (!envelope.ok) throw atlFailure(operation, envelope.error)
    return envelope.data
  }

  async sites(): Promise<AtlSite[]> {
    try {
      const { envelope } = await invokeTool(this.tool, ['site', 'ls'], { timeoutMs: 30_000 })
      if (!envelope.ok || !Array.isArray(envelope.data)) return []
      return envelope.data.map(toAtlSite).filter((site): site is AtlSite => site !== null)
    } catch {
      return []
    }
  }
}

export class JiraReader {
  readonly atl: AtlClient
  readonly site: string | undefined

  constructor(atl: AtlClient, site?: string) {
    this.atl = atl
    this.site = site
  }

  async findUsers(query: { query: string } | { accountId: string }): Promise<JiraUser[]> {
    const data = await this.atl.call('jira.findUsers', { ...query, maxResults: 50 }, this.site)
    return (Array.isArray(data) ? data : []).map(toJiraUser).filter((user): user is JiraUser => user !== null)
  }

  async fields(): Promise<JiraField[]> {
    const data = await this.atl.call('jira.getFields', {}, this.site)
    return (Array.isArray(data) ? data : []).map(toJiraField).filter((field): field is JiraField => field !== null)
  }

  async searchPage(jql: string, fields: readonly string[], nextPageToken: string | null): Promise<JiraSearchPage> {
    const data = record(
      await this.atl.call('jira.searchAndReconsileIssuesUsingJql', { jql, fields: fields.join(','), maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) }, this.site),
    )
    const issues = (Array.isArray(data['issues']) ? data['issues'] : []).flatMap((raw) => {
      const issue = record(raw)
      const key = text(issue['key'])
      return key ? [{ key, fields: record(issue['fields']) }] : []
    })
    const token = text(data['nextPageToken'])
    return { issues, nextPageToken: data['isLast'] === true || !token ? null : token }
  }

  async siteUrl(): Promise<string | null> {
    return siteBaseUrl((await this.atl.sites?.()) ?? [], this.site)
  }
}

let override: AtlClient | undefined

export function setAtlClient(client: AtlClient | undefined): void {
  override = client
}

export async function requireAtl(): Promise<AtlClient> {
  if (override) return override
  try {
    return new CliAtl(await requireTool('atl', ATL_INSTALL_HINT, { capability: ATL_CAPABILITY }))
  } catch (error) {
    if (error instanceof ToolMissingError) {
      throw new NotFoundError('atl is not installed (or it is too old to call Jira REST operations), and coworkers are read from Jira through it.', 'ATL_MISSING', ATL_INSTALL_HINT)
    }
    throw error
  }
}

export const ATL_WRITE_CAPABILITY = 'jira.issue.write'

export interface NewJiraIssue {
  project: string
  type: string
  summary: string
  description?: string
  parent?: string
  assignee?: string
  fields?: Record<string, unknown>
}

export interface JiraTransition {
  id: string
  name: string
  to: string | null
  category: string | null
}

export interface JiraBoard {
  id: number
  name: string
  type: string | null
}

export interface JiraSprint {
  id: number
  name: string
  state: string | null
}

export interface JiraWriter {
  myself(): Promise<string | null>
  createIssue(issue: NewJiraIssue): Promise<{ key: string; url: string | null }>
  editIssue(key: string, changes: { summary?: string; description?: string }): Promise<void>
  transitions(key: string): Promise<JiraTransition[]>
  transition(key: string, transitionId: string): Promise<void>
  boards(project: string): Promise<JiraBoard[]>
  activeSprints(boardId: number): Promise<JiraSprint[]>
  addToSprint(sprintId: number, issues: readonly string[]): Promise<void>
}

function toTransition(raw: unknown): JiraTransition | null {
  const data = record(raw)
  const id = text(data['id'])
  if (!id) return null
  return { id, name: text(data['name']) ?? '', to: text(data['to']), category: text(data['category']) }
}

function numericId(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isInteger(parsed) ? parsed : null
}

export class CliJiraWriter implements JiraWriter {
  readonly tool: FoundTool
  readonly site: string | undefined

  constructor(tool: FoundTool, site?: string) {
    this.tool = tool
    this.site = site
  }

  private async run(argv: readonly string[]): Promise<unknown> {
    const { envelope } = await invokeTool(this.tool, [...argv, ...(this.site ? ['--site', this.site] : [])], { timeoutMs: 120_000 })
    if (!envelope.ok) throw atlFailure(argv.slice(0, 3).join(' '), envelope.error)
    return envelope.data
  }

  private async withTextFiles<T>(texts: Record<string, string | undefined>, use: (paths: Record<string, string>) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(path.join(tmpdir(), 'tally-atl-'))
    try {
      const paths: Record<string, string> = {}
      for (const [name, value] of Object.entries(texts)) {
        if (value === undefined) continue
        const file = path.join(dir, `${name}.md`)
        await writeFile(file, value, 'utf8')
        paths[name] = `@${file}`
      }
      return await use(paths)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  async myself(): Promise<string | null> {
    return text(record(await this.run(['jira', 'myself']))['accountId'])
  }

  async createIssue(issue: NewJiraIssue): Promise<{ key: string; url: string | null }> {
    return this.withTextFiles({ summary: issue.summary, description: issue.description }, async (files) => {
      const data = record(
        await this.run([
          'jira', 'issue', 'create',
          '--project', issue.project,
          '--type', issue.type,
          '--summary', files['summary'] ?? issue.summary,
          ...(files['description'] ? ['--description', files['description']] : []),
          ...(issue.parent ? ['--parent', issue.parent] : []),
          ...(issue.assignee ? ['--assignee', issue.assignee] : []),
          ...(issue.fields ? ['--fields', JSON.stringify(issue.fields)] : []),
        ]),
      )
      const key = text(data['key'])
      if (!key) throw new TallyError('atl jira issue create answered without an issue key.', 'ATL_FAILED')
      return { key, url: text(data['url']) }
    })
  }

  async editIssue(key: string, changes: { summary?: string; description?: string }): Promise<void> {
    await this.withTextFiles({ summary: changes.summary, description: changes.description }, async (files) => {
      await this.run([
        'jira', 'issue', 'edit', key,
        ...(files['summary'] ? ['--summary', files['summary']] : []),
        ...(files['description'] ? ['--description', files['description']] : []),
      ])
    })
  }

  async transitions(key: string): Promise<JiraTransition[]> {
    const data = await this.run(['jira', 'issue', 'transitions', key])
    return (Array.isArray(data) ? data : []).map(toTransition).filter((item): item is JiraTransition => item !== null)
  }

  async transition(key: string, transitionId: string): Promise<void> {
    await this.run(['jira', 'issue', 'transition', key, transitionId])
  }

  async boards(project: string): Promise<JiraBoard[]> {
    const data = await this.run(['jira', 'board', 'ls', project, '--fields', 'id,name,type'])
    return (Array.isArray(data) ? data : []).flatMap((raw) => {
      const board = record(raw)
      const id = numericId(board['id'])
      return id === null ? [] : [{ id, name: text(board['name']) ?? '', type: text(board['type']) }]
    })
  }

  async activeSprints(boardId: number): Promise<JiraSprint[]> {
    const data = await this.run(['jira', 'sprint', 'ls', String(boardId), '--state', 'active'])
    return (Array.isArray(data) ? data : []).flatMap((raw) => {
      const sprint = record(raw)
      const id = numericId(sprint['id'])
      return id === null ? [] : [{ id, name: text(sprint['name']) ?? '', state: text(sprint['state']) }]
    })
  }

  async addToSprint(sprintId: number, issues: readonly string[]): Promise<void> {
    await this.run(['jira', 'sprint', 'add', String(sprintId), '--issues', issues.join(',')])
  }
}

let writerOverride: ((site?: string) => JiraWriter) | undefined

export function setJiraWriterFactory(factory: ((site?: string) => JiraWriter) | undefined): void {
  writerOverride = factory
}

export async function requireJiraWriter(site?: string): Promise<JiraWriter> {
  if (writerOverride) return writerOverride(site)
  try {
    return new CliJiraWriter(await requireTool('atl', ATL_INSTALL_HINT, { capability: ATL_WRITE_CAPABILITY }), site)
  } catch (error) {
    if (error instanceof ToolMissingError) {
      throw new NotFoundError('atl is not installed (or it is too old to write Jira issues), and the card is opened through it.', 'ATL_MISSING', ATL_INSTALL_HINT)
    }
    throw error
  }
}
