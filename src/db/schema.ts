import type { DatabaseSync } from 'node:sqlite'

export interface Migration {
  version: number
  statements: string[]
  run?: (db: DatabaseSync) => void
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE registrations (
         entry_id INTEGER PRIMARY KEY,
         issue_key TEXT,
         worklog_id TEXT,
         linked_at TEXT NOT NULL,
         source TEXT NOT NULL DEFAULT 'tally'
       )`,
      `CREATE INDEX registrations_issue ON registrations (issue_key)`,
      `CREATE TABLE settings (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL
       )`,
    ],
  },
]

export const LATEST_VERSION = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0)
