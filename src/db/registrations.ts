import type { DatabaseSync } from 'node:sqlite'

export interface Registration {
  entryId: number
  issueKey: string | null
  worklogId: string | null
  linkedAt: string
  source: string
  orphanedAt: string | null
}

interface RawRegistration {
  entry_id: number
  issue_key: string | null
  worklog_id: string | null
  linked_at: string
  source: string
  orphaned_at: string | null
}

function toRegistration(raw: RawRegistration): Registration {
  return {
    entryId: raw.entry_id,
    issueKey: raw.issue_key,
    worklogId: raw.worklog_id,
    linkedAt: raw.linked_at,
    source: raw.source,
    orphanedAt: raw.orphaned_at ?? null,
  }
}

export interface NewRegistration {
  entryId: number
  issueKey: string | null
  worklogId?: string | null
  linkedAt: string
  source?: string
}

export function register(db: DatabaseSync, link: NewRegistration): void {
  db.prepare(
    `INSERT INTO registrations (entry_id, issue_key, worklog_id, linked_at, source)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (entry_id) DO UPDATE SET
       issue_key = excluded.issue_key,
       worklog_id = excluded.worklog_id,
       linked_at = excluded.linked_at,
       source = excluded.source,
       orphaned_at = NULL`,
  ).run(link.entryId, link.issueKey, link.worklogId ?? null, link.linkedAt, link.source ?? 'tally')
}

export function registerIfAbsent(db: DatabaseSync, link: NewRegistration): boolean {
  const result = db
    .prepare(
      `INSERT INTO registrations (entry_id, issue_key, worklog_id, linked_at, source)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (entry_id) DO NOTHING`,
    )
    .run(link.entryId, link.issueKey, link.worklogId ?? null, link.linkedAt, link.source ?? 'tally')
  return Number(result.changes) > 0
}

export function unregister(db: DatabaseSync, entryId: number): boolean {
  return Number(db.prepare('DELETE FROM registrations WHERE entry_id = ?').run(entryId).changes) > 0
}

export function findRegistration(db: DatabaseSync, entryId: number, options: { includeOrphaned?: boolean } = {}): Registration | undefined {
  const raw = db.prepare(`SELECT * FROM registrations WHERE entry_id = ?${options.includeOrphaned ? '' : ' AND orphaned_at IS NULL'}`).get(entryId) as RawRegistration | undefined
  return raw ? toRegistration(raw) : undefined
}

export function orphanRegistrations(db: DatabaseSync, entryIds: readonly number[], at: string): number[] {
  const statement = db.prepare('UPDATE registrations SET orphaned_at = ? WHERE entry_id = ? AND orphaned_at IS NULL')
  return [...new Set(entryIds)].filter((id) => Number(statement.run(at, id).changes) > 0)
}

export function absorbedBy(db: DatabaseSync, survivorIds: readonly number[]): number[] {
  const rows = db.prepare('SELECT absorbed_id FROM merges WHERE survivor_id IN (SELECT value FROM json_each(?)) ORDER BY absorbed_id').all(JSON.stringify(survivorIds)) as { absorbed_id: number }[]
  return rows.map((row) => Number(row.absorbed_id))
}

export function recordMergeIfAbsent(db: DatabaseSync, absorbedId: number, survivorId: number, at: string): boolean {
  return Number(db.prepare('INSERT INTO merges (absorbed_id, survivor_id, merged_at) VALUES (?, ?, ?) ON CONFLICT (absorbed_id) DO NOTHING').run(absorbedId, survivorId, at).changes) > 0
}

export function recordMerge(db: DatabaseSync, survivorId: number, absorbedIds: readonly number[], at: string): number {
  const statement = db.prepare(
    `INSERT INTO merges (absorbed_id, survivor_id, merged_at) VALUES (?, ?, ?)
     ON CONFLICT (absorbed_id) DO UPDATE SET survivor_id = excluded.survivor_id, merged_at = excluded.merged_at`,
  )
  db.prepare('UPDATE merges SET survivor_id = ?, merged_at = ? WHERE survivor_id IN (SELECT value FROM json_each(?))').run(survivorId, at, JSON.stringify(absorbedIds))
  let count = 0
  for (const id of new Set(absorbedIds)) {
    if (id === survivorId) continue
    statement.run(id, survivorId, at)
    count += 1
  }
  return count
}

export function registrationsFor(db: DatabaseSync, entryIds: readonly number[]): Map<number, Registration> {
  const found = new Map<number, Registration>()
  const statement = db.prepare('SELECT * FROM registrations WHERE entry_id = ? AND orphaned_at IS NULL')
  for (const id of new Set(entryIds)) {
    const raw = statement.get(id) as RawRegistration | undefined
    if (raw) found.set(id, toRegistration(raw))
  }
  return found
}

export function listRegistrations(db: DatabaseSync, issueKey?: string): Registration[] {
  const rows = (issueKey === undefined
    ? db.prepare('SELECT * FROM registrations ORDER BY entry_id').all()
    : db.prepare('SELECT * FROM registrations WHERE issue_key = ? ORDER BY entry_id').all(issueKey)) as unknown as RawRegistration[]
  return rows.map(toRegistration)
}

export function countRegistrations(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM registrations WHERE orphaned_at IS NULL').get() as { n: number }
  return Number(row.n)
}

export function readSetting(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

export function writeSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value)
}
