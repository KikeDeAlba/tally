import type { BitaEntry } from '../integrations/bita.ts'
import { countsAsRegistered, type Registration } from '../db/registrations.ts'
import type { EnrichedTimeEntry } from './types.ts'
import { toDecimalHours } from './duration.ts'
import { toJiraStarted } from './timezone.ts'

export function expandSegments(entries: readonly BitaEntry[], timezone: string): EnrichedTimeEntry[] {
  const expanded: EnrichedTimeEntry[] = []
  for (const entry of entries) {
    const { segments, bitaRegistered: _bitaRegistered, ...base } = entry
    if (segments.length === 0) {
      expanded.push(base)
      continue
    }
    for (const segment of segments) {
      const durationSeconds = segment.durationSeconds
      if (segment.entryId === entry.id) {
        expanded.push({ ...base, durationSeconds, durationHuman: segment.durationHuman, durationHours: toDecimalHours(durationSeconds) })
        continue
      }
      const startMs = Date.parse(segment.startLocal)
      if (!Number.isFinite(startMs)) continue
      const started = new Date(startMs)
      expanded.push({
        ...base,
        id: segment.entryId,
        start: started.toISOString(),
        stop: new Date(startMs + durationSeconds * 1000).toISOString(),
        startLocal: segment.startLocal,
        localDay: segment.localDay,
        durationSeconds,
        durationHuman: segment.durationHuman,
        durationHours: toDecimalHours(durationSeconds),
        startedJira: toJiraStarted(started, timezone),
        running: false,
        mergedInto: entry.id,
      })
    }
  }
  return expanded.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id - b.id)
}

export function applyRegistrations(entries: readonly EnrichedTimeEntry[], registrations: ReadonlyMap<number, Registration>): EnrichedTimeEntry[] {
  return entries.map((entry) => {
    const registration = registrations.get(entry.id)
    return { ...entry, registered: countsAsRegistered(registration), issueKey: registration?.issueKey ?? null }
  })
}
