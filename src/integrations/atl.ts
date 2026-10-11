import { invokeTool, requireTool, ToolMissingError, type FoundTool } from '@kikedealba/kit/registry'
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

export interface AtlClient {
  call(operation: ReadOperation, args: Record<string, unknown>, site?: string): Promise<unknown>
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
