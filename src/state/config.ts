import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_STORY_THEMES, type StoryTheme } from '../constants.ts'
import { configPath as defaultConfigPath } from '../paths.ts'

export type HierarchyStrategy = 'epic-story-subtask' | 'story-subtask' | 'flat-task'

export type EpicMode = 'fixed' | 'per-run' | 'flat'

export const NO_EPIC = ''

export interface StoryRef {
  key: string
  summary: string
  verifiedAt: string
}

export interface ProjectMapping {
  projectName: string
  jiraProjectKey: string
  hierarchy?: HierarchyStrategy
  epicResolved?: boolean
  storiesByEpic?: Record<string, Record<string, StoryRef>>
  storyIssueTypeName?: string
  workIssueTypeName?: string
  parentKey?: string
  issueTypeName?: string
  issueTypeId?: string
  doneTransition?: { id: string; name: string }
  timetrackingAvailable?: boolean
  site?: string
  verifiedAt?: string
}

export interface JiraConfig {
  cloudId?: string
  siteUrl?: string
  accountId?: string
  email?: string
  site?: string
}

export interface ConfigDefaults {
  issueTypeName?: string
  storyThemes?: StoryTheme[]
}

export interface TallyConfig {
  version: number
  timezone?: string
  jira?: JiraConfig
  defaults?: ConfigDefaults
  projectMapping: Record<string, ProjectMapping>
  projectJira?: Record<string, boolean>
  [key: string]: unknown
}

export function projectGoesToJira(config: TallyConfig, projectId: number | null, fallback: boolean | null = null): boolean {
  if (projectId === null) return fallback ?? true
  const own = config.projectJira?.[String(projectId)]
  if (typeof own === 'boolean') return own
  return fallback ?? true
}

export async function setProjectJira(projectId: number, jira: boolean, file: string = defaultConfigPath()): Promise<TallyConfig> {
  const config = await readConfig(file)
  config.projectJira = { ...config.projectJira, [String(projectId)]: jira }
  await writeConfig(config, file)
  return config
}

export function emptyConfig(): TallyConfig {
  return { version: 1, projectMapping: {} }
}

interface LegacyProjectMapping extends ProjectMapping {
  togglProjectName?: string
  stories?: Record<string, StoryRef>
}

export function normalizeProjectMapping(raw: unknown): Record<string, ProjectMapping> {
  const projectMapping: Record<string, ProjectMapping> = {}
  if (raw === null || typeof raw !== 'object') return projectMapping
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object') continue
    const legacy = value as LegacyProjectMapping
    if (typeof legacy.jiraProjectKey !== 'string') continue
    const { togglProjectName, stories, ...rest } = legacy
    const migrated: ProjectMapping = { ...rest, projectName: rest.projectName ?? togglProjectName ?? '' }
    if (stories && Object.keys(stories).length > 0) {
      const epicKey = rest.parentKey ?? NO_EPIC
      migrated.storiesByEpic = {
        ...rest.storiesByEpic,
        [epicKey]: { ...stories, ...rest.storiesByEpic?.[epicKey] },
      }
    }
    projectMapping[key] = migrated
  }
  return projectMapping
}

export async function readConfig(file: string = defaultConfigPath()): Promise<TallyConfig> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return emptyConfig()
  }
  let parsed: Record<string, unknown>
  try {
    const value: unknown = JSON.parse(raw)
    parsed = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    throw new Error(`${file} is not valid JSON; fix it or move it aside.`)
  }
  return {
    ...parsed,
    version: typeof parsed['version'] === 'number' ? parsed['version'] : 1,
    projectMapping: normalizeProjectMapping(parsed['projectMapping']),
  }
}

export async function writeConfig(config: TallyConfig, file: string = defaultConfigPath()): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, file)
}

export type ProjectMappingUpdate = Omit<ProjectMapping, 'parentKey'> & { parentKey?: string | null }

const BOARD_SCOPED_FIELDS = ['storiesByEpic', 'doneTransition', 'issueTypeId', 'timetrackingAvailable'] as const satisfies readonly (keyof ProjectMapping)[]

export function mergeProjectMapping(existing: ProjectMapping | undefined, update: ProjectMappingUpdate): ProjectMapping {
  const { parentKey, ...fields } = update
  const merged: ProjectMapping = { ...existing, ...fields }

  if (parentKey === null) delete merged.parentKey
  else if (parentKey !== undefined) merged.parentKey = parentKey

  if (existing && existing.jiraProjectKey !== update.jiraProjectKey) {
    for (const field of BOARD_SCOPED_FIELDS) {
      if (!(field in fields)) delete merged[field]
    }
    if (parentKey === undefined) delete merged.parentKey
  }

  return merged
}

export async function setProjectMapping(projectId: number, update: ProjectMappingUpdate, file: string = defaultConfigPath()): Promise<TallyConfig> {
  const config = await readConfig(file)
  const key = String(projectId)
  config.projectMapping[key] = mergeProjectMapping(config.projectMapping[key], update)
  await writeConfig(config, file)
  return config
}

export async function unsetProjectMapping(projectId: number, file: string = defaultConfigPath()): Promise<boolean> {
  const config = await readConfig(file)
  const key = String(projectId)
  if (!(key in config.projectMapping)) return false
  delete config.projectMapping[key]
  await writeConfig(config, file)
  return true
}

export function epicMode(mapping: ProjectMapping): EpicMode {
  if (mapping.parentKey) return 'fixed'
  if (mapping.hierarchy === 'flat-task') return 'flat'
  return 'per-run'
}

export function storiesForEpic(mapping: ProjectMapping, epicKey: string): Record<string, StoryRef> {
  return mapping.storiesByEpic?.[epicKey] ?? {}
}

export function jiraTarget(mapping: ProjectMapping | undefined, defaultSite: string | null = null) {
  if (!mapping) {
    return {
      jiraSite: defaultSite,
      jiraProjectKey: null,
      epicMode: null,
      hierarchy: 'story-subtask' as HierarchyStrategy,
      jiraEpicKey: null,
      jiraParentKey: null,
      epicResolved: false,
      jiraStories: {},
      jiraStoriesByEpic: {},
    }
  }

  const parentKey = mapping.parentKey ?? null
  return {
    jiraSite: mapping.site ?? defaultSite,
    jiraProjectKey: mapping.jiraProjectKey,
    epicMode: epicMode(mapping),
    hierarchy: mapping.hierarchy ?? (parentKey ? 'epic-story-subtask' : 'story-subtask'),
    jiraEpicKey: parentKey,
    jiraParentKey: parentKey,
    epicResolved: mapping.epicResolved ?? false,
    jiraStories: storiesForEpic(mapping, parentKey ?? NO_EPIC),
    jiraStoriesByEpic: mapping.storiesByEpic ?? {},
  }
}

export function storyThemes(config: TallyConfig): StoryTheme[] {
  const configured = config.defaults?.storyThemes
  return configured && configured.length > 0 ? configured : [...DEFAULT_STORY_THEMES]
}

export async function setStory(projectId: number, themeId: string, story: StoryRef, epicKey: string, file: string = defaultConfigPath()): Promise<TallyConfig> {
  const config = await readConfig(file)
  const key = String(projectId)
  const mapping = config.projectMapping[key]
  if (!mapping) throw new Error(`Project ${projectId} is not mapped to a Jira project.`)
  mapping.storiesByEpic = {
    ...mapping.storiesByEpic,
    [epicKey]: { ...mapping.storiesByEpic?.[epicKey], [themeId]: story },
  }
  await writeConfig(config, file)
  return config
}

export interface StartFieldRef {
  id: string
  name: string
  resolvedAt: string
}

export interface OvertimeConfig {
  excludedProjects?: string[]
  startFields?: Record<string, StartFieldRef>
}

export function overtimeConfig(config: TallyConfig): OvertimeConfig {
  const raw = config['overtime']
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as OvertimeConfig) : {}
}

export function excludedJiraProjects(config: TallyConfig): string[] {
  const list = overtimeConfig(config).excludedProjects
  return Array.isArray(list) ? list.filter((key): key is string => typeof key === 'string') : []
}

export async function updateExcludedJiraProjects(change: (current: string[]) => string[], file: string = defaultConfigPath()): Promise<string[]> {
  const config = await readConfig(file)
  const next = [...new Set(change(excludedJiraProjects(config)))].sort()
  config['overtime'] = { ...overtimeConfig(config), excludedProjects: next }
  await writeConfig(config, file)
  return next
}

export function cachedStartField(config: TallyConfig, siteKey: string): StartFieldRef | null {
  const ref = overtimeConfig(config).startFields?.[siteKey]
  return ref && typeof ref.id === 'string' && typeof ref.name === 'string' ? ref : null
}

export async function cacheStartField(siteKey: string, ref: StartFieldRef, file: string = defaultConfigPath()): Promise<void> {
  const config = await readConfig(file)
  const current = overtimeConfig(config)
  config['overtime'] = { ...current, startFields: { ...current.startFields, [siteKey]: ref } }
  await writeConfig(config, file)
}
