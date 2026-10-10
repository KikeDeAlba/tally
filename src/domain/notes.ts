import type { EntryNote, EntryPage, NotesProvider } from '../integrations/inkwell.ts'
import { NOTES_CONCURRENCY, SUMMARY_NOTES_BUDGET_BYTES } from '../constants.ts'
import { mapLimited } from './concurrency.ts'

export type NotesMode = 'inline' | 'path' | 'both'

export interface SummaryDoc {
  entryId: number
  relPath: string | null
  path: string | null
  title: string
  bytes: number
  sections: string[]
  markdown: string | null
  truncated: boolean
  missing: boolean
}

export interface LoadedDocs {
  provider: string | null
  byEntry: Map<number, SummaryDoc[]>
  pagesByEntry: Map<number, EntryPage[]>
  inlinedBytes: number
  truncatedEntryIds: number[]
  missingFiles: number[]
}

export function parseNotesMode(raw: string | undefined): NotesMode {
  if (raw === 'inline' || raw === 'path' || raw === 'both') return raw
  return 'both'
}

function stripFrontMatter(markdown: string): string {
  if (!markdown.startsWith('---\n')) return markdown
  const end = markdown.indexOf('\n---', 4)
  return end === -1 ? markdown : markdown.slice(end + 4)
}

export function filledSections(markdown: string): string[] {
  const sections: string[] = []
  let current: string | null = null
  let filled = false
  const flush = () => {
    if (current !== null && filled) sections.push(current)
  }
  for (const line of stripFrontMatter(markdown).split('\n')) {
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading && !line.startsWith('###')) {
      flush()
      current = heading[1] ?? ''
      filled = false
      continue
    }
    if (current !== null && line.trim().length > 0 && !/^<!--.*-->$/.test(line.trim())) filled = true
  }
  flush()
  return sections
}

export function emptyDocs(): LoadedDocs {
  return { provider: null, byEntry: new Map(), pagesByEntry: new Map(), inlinedBytes: 0, truncatedEntryIds: [], missingFiles: [] }
}

export async function loadSummaryDocs(
  provider: NotesProvider,
  entryIds: readonly number[],
  options: { mode?: NotesMode; budgetBytes?: number } = {},
): Promise<LoadedDocs> {
  const mode = options.mode ?? 'both'
  const budget = options.budgetBytes ?? SUMMARY_NOTES_BUDGET_BYTES
  const loaded: LoadedDocs = { ...emptyDocs(), provider: provider.name }
  const ids = [...new Set(entryIds)]
  const fetched = await mapLimited(ids, NOTES_CONCURRENCY, async (id) => ({ note: await provider.note(id), pages: provider.pages ? await provider.pages(id) : [] }))
  const notes = fetched.map((item) => item.note)
  ids.forEach((entryId, index) => {
    const pages = fetched[index]?.pages ?? []
    if (pages.length > 0) loaded.pagesByEntry.set(entryId, pages)
  })

  ids.forEach((entryId, index) => {
    const note: EntryNote | null = notes[index] ?? null
    if (!note) return
    const raw = note.markdown
    const base: SummaryDoc = {
      entryId,
      relPath: note.relPath,
      path: note.path,
      title: note.title,
      bytes: raw === null ? 0 : Buffer.byteLength(raw),
      sections: [],
      markdown: null,
      truncated: false,
      missing: false,
    }
    if (mode === 'path') {
      loaded.byEntry.set(entryId, [base])
      return
    }
    if (raw === null) {
      loaded.missingFiles.push(entryId)
      loaded.byEntry.set(entryId, [{ ...base, missing: true }])
      return
    }
    const sections = filledSections(raw)
    const size = Buffer.byteLength(raw)
    if (loaded.inlinedBytes + size > budget) {
      loaded.truncatedEntryIds.push(entryId)
      loaded.byEntry.set(entryId, [{ ...base, sections, truncated: true }])
      return
    }
    loaded.inlinedBytes += size
    loaded.byEntry.set(entryId, [{ ...base, sections, markdown: raw }])
  })

  return loaded
}
