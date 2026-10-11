import { UsageError } from '../../errors.ts'
import { findProject, projectNotFound, requireBita } from '../../integrations/bita.ts'
import { configPath } from '../../paths.ts'
import { projectGoesToJira, readConfig, setProjectJira } from '../../state/config.ts'
import { parseCommandArgs, readBoolean } from '../args.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'

const USAGE = 'Usage: tally project jira <id|key|name> [on|off]'

export async function runProject(argv: readonly string[]): Promise<number> {
  const subcommand = argv[0]
  if (subcommand !== 'jira') throw new UsageError(USAGE)
  const args = parseCommandArgs(argv.slice(1), {})
  const [ref, value] = args.positionals
  if (!ref || (value !== undefined && value !== 'on' && value !== 'off')) throw new UsageError(USAGE)

  const projects = await (await requireBita()).projects()
  const project = findProject(projects, ref)
  if (!project) throw projectNotFound(ref)

  const config = value === undefined ? await readConfig() : await setProjectJira(project.id, value === 'on')
  const jira = projectGoesToJira(config, project.id, project.jira)
  const data = { id: project.id, name: project.name, jira }
  if (readBoolean(args, 'json')) {
    writeJson(successEnvelope('project jira', data, { path: configPath() }))
    return 0
  }
  if (value === undefined) writeOut(`${project.name} ${jira ? 'goes to Jira' : 'never goes to Jira'}.`)
  else if (jira) writeOut(`${project.name} goes to Jira again.`)
  else {
    writeOut(`${project.name} no longer goes to Jira.`)
    writeOut('Its time is still in bita, and summary reports it apart from the Jira hours.')
  }
  return 0
}
