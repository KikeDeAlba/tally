import { findTool, invokeTool, type FoundTool } from '@kikedealba/kit/registry'

export const INKWELL_INSTALL_HINT = 'npm install -g @kikedealba/inkwell && inkwell setup'
export const ENTRY_NOTES_CAPABILITY = 'docs.entry-notes'

export interface EntryNote {
  entryId: number
  relPath: string | null
  path: string | null
  title: string
  markdown: string | null
}

export interface EntryPage {
  pageId: number
  title: string
  relPath: string | null
  path: string | null
  body: string | null
  issues: string[]
  refs: { url: string; title: string; kind: string }[]
}

export interface NotesProvider {
  name: string
  note(entryId: number): Promise<EntryNote | null>
  pages?(entryId: number): Promise<EntryPage[]>
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function toEntryNote(entryId: number, raw: unknown): EntryNote | null {
  if (raw === null || raw === undefined) return null
  const data = record(Array.isArray(raw) ? raw[0] : raw)
  if (Object.keys(data).length === 0) return null
  const markdown = text(data['markdown']) ?? text(data['content']) ?? text(data['body'])
  const notePath = text(data['path']) ?? text(data['absPath'])
  const relPath = text(data['relPath'])
  if (markdown === null && notePath === null && relPath === null) return null
  return {
    entryId,
    relPath,
    path: notePath,
    title: text(data['title']) ?? '',
    markdown,
  }
}

function issueKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item]
    const data = record(item)
    const key = text(data['key']) ?? text(data['issueKey'])
    return key ? [key] : []
  })
}

export function toEntryPages(raw: unknown): EntryPage[] {
  const data = record(raw)
  const pages = Array.isArray(data['pages']) ? data['pages'] : Array.isArray(raw) ? raw : []
  return pages.flatMap((item) => {
    const page = record(item)
    const pageId = typeof page['pageId'] === 'number' ? page['pageId'] : typeof page['id'] === 'number' ? page['id'] : null
    if (pageId === null) return []
    return [{ pageId, title: text(page['title']) ?? '', relPath: text(page['relPath']), path: text(page['path']), body: null, issues: issueKeys(page['issues']), refs: [] }]
  })
}

export class CliInkwell implements NotesProvider {
  readonly name = 'inkwell'
  readonly tool: FoundTool

  constructor(tool: FoundTool) {
    this.tool = tool
  }

  async note(entryId: number): Promise<EntryNote | null> {
    try {
      const { envelope } = await invokeTool(this.tool, ['note', 'show', String(entryId)], { timeoutMs: 30_000 })
      if (!envelope.ok) return null
      return toEntryNote(entryId, envelope.data)
    } catch {
      return null
    }
  }

  async pages(entryId: number): Promise<EntryPage[]> {
    if (!this.tool.manifest.capabilities.includes('docs.page.read')) return []
    try {
      const { envelope } = await invokeTool(this.tool, ['page', 'ls', '--entry', String(entryId)], { timeoutMs: 30_000 })
      return envelope.ok ? toEntryPages(envelope.data) : []
    } catch {
      return []
    }
  }
}

let override: NotesProvider | null | undefined

export function setNotesProvider(provider: NotesProvider | null | undefined): void {
  override = provider
}

export async function findNotesProvider(): Promise<NotesProvider | null> {
  if (override !== undefined) return override
  const tool = await findTool('inkwell', { capability: ENTRY_NOTES_CAPABILITY })
  return tool ? new CliInkwell(tool) : null
}
