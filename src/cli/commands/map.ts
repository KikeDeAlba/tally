import { UsageError } from '../../errors.ts'
import { parseCommandArgs, readBoolean, readString } from '../args.ts'
import { requireBita, type BitaProject } from '../../integrations/bita.ts'
import {
  epicMode,
  projectGoesToJira,
  NO_EPIC,
  readConfig,
  setProjectMapping,
  setStory,
  unsetProjectMapping,
  type ProjectMapping,
} from '../../state/config.ts'
import { renderTable } from '../table.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'

const JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9]+$/
const PARENT_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/

function readIssueKeyOnBoard(raw: string, jiraProjectKey: string, label: string): string {
  const issueKey = raw.toUpperCase()
  if (!PARENT_KEY_PATTERN.test(issueKey)) {
    throw new UsageError(`Invalid ${label} key: "${raw}". Expected something like ${jiraProjectKey}-1213.`)
  }
  const issueProject = issueKey.slice(0, issueKey.lastIndexOf('-'))
  if (issueProject !== jiraProjectKey) {
    throw new UsageError(
      `${label[0]?.toUpperCase()}${label.slice(1)} ${issueKey} belongs to project ${issueProject}, not ${jiraProjectKey}. An issue cannot sit under a parent from another project.`,
    )
  }
  return issueKey
}

type ListRow =
  | (ProjectMapping & { projectId: number; epicMode: ReturnType<typeof epicMode>; jira: boolean })
  | { projectId: number; projectName: string; jiraProjectKey: null; parentKey: null; epicMode: null; jira: boolean }

function parentColumn(row: ListRow): string {
  if (row.jiraProjectKey === null) return ''
  if (row.parentKey) return row.parentKey
  return row.epicMode === 'per-run' ? '(board)' : ''
}

export async function runMap(argv: readonly string[]): Promise<number> {
  const subcommand = argv[0] ?? 'list'
  const args = parseCommandArgs(argv.slice(1), {
    'issue-type': { type: 'string' },
    summary: { type: 'string' },
    epic: { type: 'string' },
    parent: { type: 'string' },
    'no-epic': { type: 'boolean', default: false },
    hierarchy: { type: 'string' },
    site: { type: 'string' },
  })

  if (subcommand === 'list') {
    const config = await readConfig()
    let projects: BitaProject[] = []
    try {
      projects = await (await requireBita()).projects()
    } catch {
      projects = []
    }
    const byId = new Map(projects.map((project) => [project.id, project]))
    const mapped: ListRow[] = Object.entries(config.projectMapping).map(([id, mapping]) => ({
      projectId: Number(id),
      ...mapping,
      epicMode: epicMode(mapping),
      jira: projectGoesToJira(config, Number(id), byId.get(Number(id))?.jira ?? null),
    }))
    const known = new Set(mapped.map((row) => row.projectId))
    const unmappedIds = [...new Set([...projects.map((project) => project.id), ...Object.keys(config.projectJira ?? {}).map(Number)])].filter((id) => Number.isInteger(id) && !known.has(id))
    const unmapped: ListRow[] = unmappedIds.map((id) => ({
      projectId: id,
      projectName: byId.get(id)?.name ?? '',
      jiraProjectKey: null,
      parentKey: null,
      epicMode: null,
      jira: projectGoesToJira(config, id, byId.get(id)?.jira ?? null),
    }))
    const rows = [...mapped, ...unmapped]

    if (readBoolean(args, 'json')) {
      writeJson(successEnvelope('map list', rows, { jira: config.jira ?? null, projectJira: config.projectJira ?? {} }))
      return 0
    }

    if (rows.length === 0) {
      writeOut('No projects in bita, and nothing mapped in tally yet.')
      return 0
    }

    writeOut(
      renderTable(
        [
          { header: 'ID' },
          { header: 'PROJECT' },
          { header: 'JIRA' },
          { header: 'PARENT' },
          { header: 'ISSUE TYPE' },
          { header: 'DONE TRANSITION' },
          { header: 'SITE' },
          { header: 'ON' },
        ],
        rows.map((row) => [
          String(row.projectId),
          row.projectName,
          row.jiraProjectKey ?? '',
          parentColumn(row),
          'issueTypeName' in row ? (row.issueTypeName ?? '') : '',
          'doneTransition' in row ? (row.doneTransition?.name ?? '') : '',
          'site' in row ? (row.site ?? '') : '',
          row.jira ? 'yes' : 'no',
        ]),
      ),
    )
    return 0
  }

  if (subcommand === 'set') {
    const [rawProjectId, rawJiraKey] = args.positionals
    if (!rawProjectId || !rawJiraKey) {
      throw new UsageError('Usage: tally map set <projectId> <JIRAKEY> [--parent KEY-123 | --no-epic] [--issue-type "Tarea"] [--site NAME]')
    }

    const projectId = Number(rawProjectId)
    if (!Number.isInteger(projectId)) {
      throw new UsageError(`Invalid project id: "${rawProjectId}".`)
    }

    const jiraProjectKey = rawJiraKey.toUpperCase()
    if (!JIRA_KEY_PATTERN.test(jiraProjectKey)) {
      throw new UsageError(`Invalid Jira project key: "${rawJiraKey}". Expected something like DPF.`)
    }

    const project = (await (await requireBita()).projects()).find((candidate) => candidate.id === projectId)
    if (!project) {
      throw new UsageError(
        `No project with id ${projectId}. Run "bita projects" to list them.`,
      )
    }
    if (!projectGoesToJira(await readConfig(), projectId, project.jira)) {
      throw new UsageError(
        `"${project.name}" never goes to Jira. Turn it on first with: tally project jira ${projectId} on`,
      )
    }

    const issueTypeName = readString(args, 'issue-type')
    const site = readString(args, 'site')
    const rawParent = readString(args, 'parent') ?? readString(args, 'epic')
    const parentKey =
      rawParent === undefined ? undefined : readIssueKeyOnBoard(rawParent, jiraProjectKey, 'parent')

    const noEpic = readBoolean(args, 'no-epic')
    if (noEpic && parentKey !== undefined) {
      throw new UsageError('Use either --parent or --no-epic, not both.')
    }
    const rawHierarchy = readString(args, 'hierarchy')
    if (
      rawHierarchy !== undefined &&
      rawHierarchy !== 'epic-story-subtask' &&
      rawHierarchy !== 'story-subtask' &&
      rawHierarchy !== 'flat-task'
    ) {
      throw new UsageError(
        `Invalid --hierarchy: "${rawHierarchy}". Use epic-story-subtask, story-subtask or flat-task.`,
      )
    }
    const hierarchy =
      rawHierarchy ?? (parentKey !== undefined ? 'epic-story-subtask' : noEpic ? 'story-subtask' : undefined)

    await setProjectMapping(projectId, {
      projectName: project.name,
      jiraProjectKey,
      ...(parentKey !== undefined ? { parentKey } : noEpic ? { parentKey: null } : {}),
      ...(hierarchy !== undefined ? { hierarchy } : {}),
      ...(parentKey !== undefined || noEpic ? { epicResolved: true } : {}),
      ...(issueTypeName !== undefined ? { issueTypeName } : {}),
      ...(site !== undefined ? { site } : {}),
      verifiedAt: new Date().toISOString(),
    })

    if (readBoolean(args, 'json')) {
      writeJson(
        successEnvelope('map set', {
          projectId,
          projectName: project.name,
          jiraProjectKey,
          parentKey: parentKey ?? null,
          ...(site !== undefined ? { site } : {}),
        }),
      )
    } else {
      const under = parentKey ? ` under ${parentKey}` : noEpic ? ', choosing the epic on every run' : ''
      writeOut(`Mapped "${project.name}" (${projectId}) to Jira project ${jiraProjectKey}${under}.`)
    }
    return 0
  }

  if (subcommand === 'unset') {
    const [rawProjectId] = args.positionals
    if (!rawProjectId) throw new UsageError('Usage: tally map unset <projectId>')

    const projectId = Number(rawProjectId)
    if (!Number.isInteger(projectId)) {
      throw new UsageError(`Invalid project id: "${rawProjectId}".`)
    }

    const removed = await unsetProjectMapping(projectId)
    if (readBoolean(args, 'json')) {
      writeJson(successEnvelope('map unset', { projectId, removed }))
    } else {
      writeOut(removed ? `Removed the mapping for ${projectId}.` : `No mapping existed for ${projectId}.`)
    }
    return 0
  }

  if (subcommand === 'story') {
    const [rawProjectId, themeId, rawIssueKey] = args.positionals
    if (!rawProjectId || !themeId || !rawIssueKey) {
      throw new UsageError(
        'Usage: tally map story <projectId> <themeId> <ISSUE-KEY> [--epic <KEY-123> | --no-epic]',
      )
    }

    const projectId = Number(rawProjectId)
    if (!Number.isInteger(projectId)) {
      throw new UsageError(`Invalid project id: "${rawProjectId}".`)
    }

    const mapping = (await readConfig()).projectMapping[String(projectId)]
    if (!mapping) {
      throw new UsageError(
        `Project ${projectId} is not mapped to a Jira project. Run "tally map set ${projectId} <JIRAKEY>" first.`,
      )
    }

    const issueKey = readIssueKeyOnBoard(rawIssueKey, mapping.jiraProjectKey, 'story')
    const rawEpic = readString(args, 'epic')
    const noEpic = readBoolean(args, 'no-epic')
    if (rawEpic !== undefined && noEpic) {
      throw new UsageError('Use either --epic or --no-epic, not both.')
    }

    let epicKey: string
    if (rawEpic !== undefined) {
      epicKey = readIssueKeyOnBoard(rawEpic, mapping.jiraProjectKey, 'epic')
    } else if (noEpic) {
      epicKey = NO_EPIC
    } else if (epicMode(mapping) === 'per-run') {
      throw new UsageError(
        `Project ${projectId} picks its epic on every run. Say which one the story sits under: tally map story ${projectId} ${themeId} ${issueKey} --epic <${mapping.jiraProjectKey}-123> (or --no-epic for a story without one).`,
      )
    } else {
      epicKey = mapping.parentKey ?? NO_EPIC
    }

    await setStory(
      projectId,
      themeId,
      {
        key: issueKey,
        summary: readString(args, 'summary') ?? themeId,
        verifiedAt: new Date().toISOString(),
      },
      epicKey,
    )

    if (readBoolean(args, 'json')) {
      writeJson(
        successEnvelope('map story', { projectId, themeId, issueKey, epicKey: epicKey || null }),
      )
    } else {
      const under = epicKey ? ` under ${epicKey}` : ' without an epic'
      writeOut(`Theme "${themeId}" of project ${projectId} now points at ${issueKey}${under}.`)
    }
    return 0
  }

  throw new UsageError(`Unknown map subcommand "${subcommand}". Use list, set, unset or story.`)
}
