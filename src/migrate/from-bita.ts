import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { NotFoundError } from '../errors.ts'
import { inTransaction } from '../db/open.ts'
import { findRegistration, registerIfAbsent, writeSetting } from '../db/registrations.ts'
import { normalizeProjectMapping, readConfig, writeConfig, type JiraConfig, type ProjectMapping, type StoryRef, type TallyConfig } from '../state/config.ts'
import type { StoryTheme } from '../constants.ts'

export const MIGRATED_AT_KEY = 'migration.bita.at'
export const MIGRATED_FROM_KEY = 'migration.bita.database'

export interface MigrationSources {
  bitaDatabase: string
  bitaConfig: string
  tallyConfig: string
}

export interface MigrationReport {
  dryRun: boolean
  bitaDatabase: string | null
  bitaConfig: string | null
  tallyConfig: string
  counts: {
    links: { found: number; copied: number; skipped: number }
    mappings: { found: number; copied: number; merged: number; skipped: number }
    stories: { found: number; copied: number }
    themes: { found: number; copied: number }
    jiraSettings: { copied: string[] }
    defaults: { copied: string[] }
  }
  warnings: string[]
  migratedAt: string | null
}

interface BitaLink {
  entryId: number
  issueKey: string | null
  worklogId: string | null
  linkedAt: string
}

interface BitaData {
  links: BitaLink[]
  sites: Map<string, string>
}

function hasTable(db: DatabaseSync, name: string): boolean {
  return db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !== undefined
}

function readBitaData(file: string): BitaData {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const sites = new Map<string, string>()
    if (hasTable(db, 'projects')) {
      const columns = new Set((db.prepare(`PRAGMA table_info("projects")`).all() as { name: string }[]).map((column) => column.name))
      if (columns.has('atlassian_site')) {
        const rows = db.prepare('SELECT id, atlassian_site FROM projects WHERE atlassian_site IS NOT NULL').all() as { id: number; atlassian_site: string }[]
        for (const row of rows) sites.set(String(row.id), row.atlassian_site)
      }
    }
    if (!hasTable(db, 'jira_links')) return { links: [], sites }
    const rows = db.prepare('SELECT entry_id, issue_key, worklog_id, linked_at FROM jira_links ORDER BY entry_id').all() as {
      entry_id: number
      issue_key: string | null
      worklog_id: string | null
      linked_at: string
    }[]
    return { links: rows.map((row) => ({ entryId: Number(row.entry_id), issueKey: row.issue_key, worklogId: row.worklog_id, linkedAt: row.linked_at })), sites }
  } finally {
    db.close()
  }
}

async function readBitaConfig(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function countStories(mapping: ProjectMapping): number {
  return Object.values(mapping.storiesByEpic ?? {}).reduce((sum, stories) => sum + Object.keys(stories).length, 0)
}

function mergeStories(target: ProjectMapping, source: ProjectMapping): number {
  let copied = 0
  for (const [epicKey, stories] of Object.entries(source.storiesByEpic ?? {})) {
    for (const [themeId, story] of Object.entries(stories)) {
      const existing = target.storiesByEpic?.[epicKey]?.[themeId]
      if (existing) continue
      const byEpic: Record<string, Record<string, StoryRef>> = { ...target.storiesByEpic }
      byEpic[epicKey] = { ...byEpic[epicKey], [themeId]: story }
      target.storiesByEpic = byEpic
      copied += 1
    }
  }
  return copied
}

function fillMapping(target: ProjectMapping, source: ProjectMapping): boolean {
  let changed = false
  const writable = target as unknown as Record<string, unknown>
  for (const [field, value] of Object.entries(source)) {
    if (field === 'storiesByEpic' || value === undefined) continue
    if (writable[field] === undefined) {
      writable[field] = value
      changed = true
    }
  }
  return changed
}

function isTheme(value: unknown): value is StoryTheme {
  const theme = value as StoryTheme
  return typeof theme === 'object' && theme !== null && typeof theme.id === 'string' && typeof theme.name === 'string'
}

export async function migrateFromBita(db: DatabaseSync, sources: MigrationSources, options: { dryRun: boolean; now?: Date }): Promise<MigrationReport> {
  const hasDatabase = existsSync(sources.bitaDatabase)
  const hasConfig = existsSync(sources.bitaConfig)
  if (!hasDatabase && !hasConfig) {
    throw new NotFoundError(
      `Found neither ${sources.bitaDatabase} nor ${sources.bitaConfig}.`,
      'BITA_DATA_MISSING',
      'Point BITA_DB_PATH and BITA_CONFIG_PATH at the bita files to import.',
    )
  }

  const warnings: string[] = []
  const report: MigrationReport = {
    dryRun: options.dryRun,
    bitaDatabase: hasDatabase ? sources.bitaDatabase : null,
    bitaConfig: hasConfig ? sources.bitaConfig : null,
    tallyConfig: sources.tallyConfig,
    counts: {
      links: { found: 0, copied: 0, skipped: 0 },
      mappings: { found: 0, copied: 0, merged: 0, skipped: 0 },
      stories: { found: 0, copied: 0 },
      themes: { found: 0, copied: 0 },
      jiraSettings: { copied: [] },
      defaults: { copied: [] },
    },
    warnings,
    migratedAt: null,
  }

  if (!hasDatabase) warnings.push(`No bita database at ${sources.bitaDatabase}; no registrations were copied.`)
  if (!hasConfig) warnings.push(`No bita config at ${sources.bitaConfig}; no mappings were copied.`)

  const bitaData: BitaData = hasDatabase ? readBitaData(sources.bitaDatabase) : { links: [], sites: new Map() }
  const links = bitaData.links
  report.counts.links.found = links.length
  if (options.dryRun) {
    for (const link of links) {
      if (findRegistration(db, link.entryId)) report.counts.links.skipped += 1
      else report.counts.links.copied += 1
    }
  } else {
    inTransaction(db, () => {
      for (const link of links) {
        if (registerIfAbsent(db, { ...link, source: 'bita' })) report.counts.links.copied += 1
        else report.counts.links.skipped += 1
      }
    })
  }

  const raw = hasConfig ? await readBitaConfig(sources.bitaConfig) : null
  if (hasConfig && raw === null) warnings.push(`${sources.bitaConfig} could not be read as JSON; no mappings were copied.`)
  if (raw) {
    const config: TallyConfig = await readConfig(sources.tallyConfig)
    let changed = false

    const mappings = normalizeProjectMapping(raw['projectMapping'])
    report.counts.mappings.found = Object.keys(mappings).length
    for (const [key, found] of Object.entries(mappings)) {
      const site = bitaData.sites.get(key)
      const mapping: ProjectMapping = site !== undefined && found.site === undefined ? { ...found, site } : found
      report.counts.stories.found += countStories(mapping)
      const existing = config.projectMapping[key]
      if (!existing) {
        config.projectMapping[key] = structuredClone(mapping)
        report.counts.mappings.copied += 1
        report.counts.stories.copied += countStories(mapping)
        changed = true
        continue
      }
      const filled = fillMapping(existing, mapping)
      const stories = mergeStories(existing, mapping)
      report.counts.stories.copied += stories
      if (filled || stories > 0) {
        report.counts.mappings.merged += 1
        changed = true
      } else {
        report.counts.mappings.skipped += 1
      }
    }

    const defaults = raw['defaults'] !== null && typeof raw['defaults'] === 'object' ? (raw['defaults'] as Record<string, unknown>) : {}
    const themes = Array.isArray(defaults['storyThemes']) ? defaults['storyThemes'].filter(isTheme) : []
    report.counts.themes.found = themes.length
    if (themes.length > 0 && (config.defaults?.storyThemes?.length ?? 0) === 0) {
      config.defaults = { ...config.defaults, storyThemes: themes }
      report.counts.themes.copied = themes.length
      report.counts.defaults.copied.push('storyThemes')
      changed = true
    }
    if (typeof defaults['issueTypeName'] === 'string' && config.defaults?.issueTypeName === undefined) {
      config.defaults = { ...config.defaults, issueTypeName: defaults['issueTypeName'] }
      report.counts.defaults.copied.push('issueTypeName')
      changed = true
    }

    const jira = raw['jira'] !== null && typeof raw['jira'] === 'object' ? (raw['jira'] as Record<string, unknown>) : {}
    const tallyJira: Record<string, unknown> = { ...config.jira }
    for (const [field, value] of Object.entries(jira)) {
      if (typeof value !== 'string' || tallyJira[field] !== undefined) continue
      tallyJira[field] = value
      report.counts.jiraSettings.copied.push(field)
    }
    if (report.counts.jiraSettings.copied.length > 0) {
      config.jira = tallyJira as JiraConfig
      changed = true
    }

    if (typeof raw['timezone'] === 'string' && config.timezone === undefined) {
      config.timezone = raw['timezone']
      report.counts.defaults.copied.push('timezone')
      changed = true
    }

    if (changed && !options.dryRun) await writeConfig(config, sources.tallyConfig)
  }

  if (!options.dryRun) {
    const at = (options.now ?? new Date()).toISOString()
    writeSetting(db, MIGRATED_AT_KEY, at)
    if (hasDatabase) writeSetting(db, MIGRATED_FROM_KEY, sources.bitaDatabase)
    report.migratedAt = at
  }

  return report
}
