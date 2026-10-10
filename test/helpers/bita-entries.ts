import type { BitaEntry } from '../../src/integrations/bita.ts'
import { makeEntry, TEST_TZ, type EntryOverrides } from './entries.ts'
import { formatDuration } from '../../src/domain/duration.ts'
import { localDay, toLocalIso } from '../../src/domain/timezone.ts'

export function bitaEntry(overrides: EntryOverrides & { segments?: { id: number; start: string; durationSeconds: number }[]; bitaRegistered?: boolean } = {}): BitaEntry {
  const { segments, bitaRegistered, ...rest } = overrides
  const base = makeEntry(rest)
  if (!segments || segments.length === 0) return { ...base, segments: [], bitaRegistered: bitaRegistered ?? false }
  const all = [{ id: base.id, start: base.start, durationSeconds: base.durationSeconds }, ...segments].sort((a, b) => a.start.localeCompare(b.start))
  const total = all.reduce((sum, segment) => sum + segment.durationSeconds, 0)
  return {
    ...base,
    durationSeconds: total,
    durationHuman: formatDuration(total),
    bitaRegistered: bitaRegistered ?? false,
    segments: all.map((segment) => ({
      entryId: segment.id,
      localDay: localDay(segment.start, TEST_TZ),
      startLocal: toLocalIso(segment.start, TEST_TZ),
      durationSeconds: segment.durationSeconds,
      durationHuman: formatDuration(segment.durationSeconds),
    })),
  }
}
