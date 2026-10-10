import type { EnrichedTimeEntry, ExcludedEntry } from './types.ts'
import { matchesRegistration, type RegistrationFilter } from './filter.ts'
import { describeOverlap, findOverlaps, type DayOverlap } from './overlap.ts'

export interface CollectOptions {
  filter: RegistrationFilter
  includeRunning: boolean
  requireDescription: boolean
  requireProject: boolean
  now: Date
}

export interface CollectResult {
  filter: RegistrationFilter
  selected: EnrichedTimeEntry[]
  nonJira: EnrichedTimeEntry[]
  excluded: ExcludedEntry[]
  alreadyRegistered: { count: number; totalSeconds: number }
  overlaps: DayOverlap[]
  warnings: string[]
}

function toExcluded(entry: EnrichedTimeEntry, reason: string): ExcludedEntry {
  return {
    id: entry.id,
    description: entry.description,
    projectName: entry.projectName,
    localDay: entry.localDay,
    durationSeconds: entry.durationSeconds,
    durationHuman: entry.durationHuman,
    registered: entry.registered,
    reason,
  }
}

export function collectEntries(inRange: readonly EnrichedTimeEntry[], options: CollectOptions): CollectResult {
  const { filter } = options
  const warnings: string[] = []
  const matched = inRange.filter((entry) => matchesRegistration(entry, filter))

  const selected: EnrichedTimeEntry[] = []
  const nonJira: EnrichedTimeEntry[] = []
  const excluded: ExcludedEntry[] = []

  const registeredEntries = inRange.filter((entry) => entry.registered && entry.jira)
  const alreadyRegistered = {
    count: registeredEntries.length,
    totalSeconds: registeredEntries.reduce((sum, entry) => sum + entry.durationSeconds, 0),
  }

  for (const entry of matched) {
    if (filter === 'pending' && !entry.jira) {
      if (!entry.running || options.includeRunning) nonJira.push(entry)
      continue
    }
    if (entry.running && !options.includeRunning) {
      excluded.push(toExcluded(entry, 'running'))
      continue
    }
    if (options.requireProject && entry.projectId === null) {
      excluded.push(toExcluded(entry, 'no-project'))
      continue
    }
    if (options.requireDescription && entry.description.length < 3) {
      excluded.push(toExcluded(entry, 'no-description'))
      continue
    }
    if (options.requireDescription && Math.round(entry.durationSeconds / 60) === 0) {
      excluded.push(toExcluded(entry, 'zero-duration'))
      continue
    }
    selected.push(entry)
  }

  const runningCount = excluded.filter((entry) => entry.reason === 'running').length
  if (runningCount > 0) {
    warnings.push(`${runningCount} running entries were excluded; pass --include-running to count them.`)
  }

  const overlaps = findOverlaps([...inRange], options.now)
  for (const overlap of overlaps) warnings.push(describeOverlap(overlap))

  return { filter, selected, nonJira, excluded, alreadyRegistered, overlaps, warnings }
}
