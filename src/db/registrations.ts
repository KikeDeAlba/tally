import type { DatabaseSync } from 'node:sqlite'

export interface Registration {
  entryId: number
  issueKey: string | null
  worklogId: string | null
  linkedAt: string
  source: string
}

interface RawRegistration {
  entry_id: number
  issue_key: string | null
  worklog_id: string | null
  linked_at: string
  source: string
}

function toRegistration(raw: RawRegistration): Registration {
  return {
    entryId: raw.entry_id,
    issueKey: raw.issue_key,
    worklogId: raw.worklog_id,
    linkedAt: raw.linked_at,
    source: raw.source,
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
       source = excluded.source`,
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

export function findRegistration(db: DatabaseSync, entryId: number): Registration | undefined {
  const raw = db.prepare('SELECT * FROM registrations WHERE entry_id = ?').get(entryId) as RawRegistration | undefined
  return raw ? toRegistration(raw) : undefined
}

export function registrationsFor(db: DatabaseSync, entryIds: readonly number[]): Map<number, Registration> {
  const found = new Map<number, Registration>()
  const statement = db.prepare('SELECT * FROM registrations WHERE entry_id = ?')
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
  const row = db.prepare('SELECT COUNT(*) AS n FROM registrations').get() as { n: number }
  return Number(row.n)
}

export function readSetting(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

export function writeSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value)
}
