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
  {
    version: 2,
    statements: [
      `ALTER TABLE registrations ADD COLUMN orphaned_at TEXT`,
      `CREATE TABLE merges (
         absorbed_id INTEGER PRIMARY KEY,
         survivor_id INTEGER NOT NULL,
         merged_at TEXT NOT NULL
       )`,
      `CREATE INDEX merges_survivor ON merges (survivor_id)`,
    ],
  },
]

export const LATEST_VERSION = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0)
