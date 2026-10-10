import { invokeTool, requireTool, ToolMissingError, type FoundTool } from '@kikedealba/kit/registry'
import { ConflictError, NotFoundError, TallyError } from '../errors.ts'
import type { EnrichedTimeEntry } from '../domain/types.ts'

export const BITA_INSTALL_HINT = 'npm install -g @kikedealba/bita && bita setup'

export interface EntrySegment {
  entryId: number
  localDay: string
  startLocal: string
  durationSeconds: number
  durationHuman: string
}

export type BitaEntry = EnrichedTimeEntry & { segments: EntrySegment[]; bitaRegistered: boolean }

export interface BitaRange {
  fromDay: string
  toDay: string
  timezone: string
}

export interface BitaEntries {
  entries: BitaEntry[]
  range: BitaRange
  warnings: string[]
}

export interface BitaEntryDetail {
  id: number
  description: string
  kind: string | null
  projectId: number | null
  projectName: string | null
  startedAt: string
  stoppedAt: string | null
}

export interface BitaProject {
  id: number
  name: string
  key: string | null
  active: boolean
  jira: boolean
}

export interface BitaClient {
  entries(args: readonly string[]): Promise<BitaEntries>
  entry(id: number): Promise<BitaEntryDetail | null>
  projects(): Promise<BitaProject[]>
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function toSegment(raw: unknown): EntrySegment | null {
  const data = record(raw)
  const entryId = integer(data['entryId'])
  const startLocal = text(data['startLocal'])
  if (entryId === null || startLocal === null) return null
  return {
    entryId,
    localDay: text(data['localDay']) ?? startLocal.slice(0, 10),
    startLocal,
    durationSeconds: number(data['durationSeconds']),
    durationHuman: text(data['durationHuman']) ?? '',
  }
}

export function toBitaEntry(raw: unknown): BitaEntry | null {
  const data = record(raw)
  const id = integer(data['id'])
  const start = text(data['start'])
  if (id === null || start === null) return null
  const stop = text(data['stop'])
  const startLocal = text(data['startLocal']) ?? start
  return {
    id,
    externalId: integer(data['externalId']),
    description: text(data['description']) ?? '',
    projectId: integer(data['projectId']),
    projectName: text(data['projectName']),
    clientName: text(data['clientName']),
    billable: data['billable'] === true,
    registered: false,
    issueKey: null,
    start,
    stop,
    startLocal,
    localDay: text(data['localDay']) ?? startLocal.slice(0, 10),
    durationSeconds: number(data['durationSeconds']),
    durationHuman: text(data['durationHuman']) ?? '',
    durationHours: number(data['durationHours']),
    startedJira: text(data['startedJira']) ?? start,
    running: data['running'] === true || stop === null,
    mergedInto: integer(data['mergedInto']),
    kind: text(data['kind']),
    jira: data['jira'] !== false,
    bitaRegistered: data['registered'] === true,
    segments: Array.isArray(data['segments']) ? data['segments'].map(toSegment).filter((segment): segment is EntrySegment => segment !== null) : [],
  }
}

function bitaFailure(command: string, error: { code?: string; message?: string; hint?: string } | undefined): TallyError {
  return new ConflictError(`bita ${command}: ${error?.message ?? 'failed'}`, error?.code ? `BITA_${error.code.replace(/^BITA_/, '')}` : 'BITA_FAILED', error?.hint)
}

export class CliBita implements BitaClient {
  readonly tool: FoundTool

  constructor(tool: FoundTool) {
    this.tool = tool
  }

  async entries(args: readonly string[]): Promise<BitaEntries> {
    const { envelope } = await invokeTool(this.tool, ['entries', ...args], { timeoutMs: 120_000 })
    if (!envelope.ok) throw bitaFailure('entries', envelope.error)
    const meta = record(envelope.meta)
    const range = record(meta['range'])
    const entries = Array.isArray(envelope.data) ? envelope.data.map(toBitaEntry).filter((entry): entry is BitaEntry => entry !== null) : []
    return {
      entries,
      range: {
        fromDay: text(range['fromDay']) ?? '',
        toDay: text(range['toDay']) ?? '',
        timezone: text(range['timezone']) ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      warnings: Array.isArray(meta['warnings']) ? meta['warnings'].filter((item): item is string => typeof item === 'string') : [],
    }
  }

  async entry(id: number): Promise<BitaEntryDetail | null> {
    const { envelope } = await invokeTool(this.tool, ['entries', 'get', String(id)], { timeoutMs: 30_000 })
    if (!envelope.ok) {
      if (/NOT_FOUND/.test(envelope.error?.code ?? '')) return null
      throw bitaFailure('entries get', envelope.error)
    }
    const data = record(envelope.data)
    const entryId = integer(data['id'])
    if (entryId === null) return null
    return {
      id: entryId,
      description: text(data['description']) ?? '',
      kind: text(data['kind']),
      projectId: integer(data['projectId']),
      projectName: text(data['projectName']),
      startedAt: text(data['startedAt']) ?? '',
      stoppedAt: text(data['stoppedAt']),
    }
  }

  async projects(): Promise<BitaProject[]> {
    const { envelope } = await invokeTool(this.tool, ['projects', '--all'], { timeoutMs: 30_000 })
    if (!envelope.ok) throw bitaFailure('projects', envelope.error)
    if (!Array.isArray(envelope.data)) return []
    return envelope.data.flatMap((raw) => {
      const data = record(raw)
      const id = integer(data['id'])
      if (id === null) return []
      return [{ id, name: text(data['name']) ?? '', key: text(data['key']), active: data['active'] !== false, jira: data['jira'] !== false }]
    })
  }
}

let override: BitaClient | undefined

export function setBitaClient(client: BitaClient | undefined): void {
  override = client
}

export async function requireBita(): Promise<BitaClient> {
  if (override) return override
  try {
    return new CliBita(await requireTool('bita', BITA_INSTALL_HINT, { capability: 'time.entries.read' }))
  } catch (error) {
    if (error instanceof ToolMissingError) {
      throw new NotFoundError('bita is not installed (or it is too old to answer "entries --json"), and the time entries live there.', 'BITA_MISSING', BITA_INSTALL_HINT)
    }
    throw error
  }
}
