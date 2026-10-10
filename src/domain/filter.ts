import type { EnrichedTimeEntry } from './types.ts'

export type RegistrationFilter = 'any' | 'pending' | 'registered'

export function matchesRegistration(
  entry: { registered: boolean },
  filter: RegistrationFilter,
): boolean {
  if (filter === 'any') return true
  return filter === 'registered' ? entry.registered : !entry.registered
}

export function withinLocalRange(
  entry: EnrichedTimeEntry,
  fromDay: string,
  toDay: string,
): boolean {
  return entry.localDay >= fromDay && entry.localDay <= toDay
}
