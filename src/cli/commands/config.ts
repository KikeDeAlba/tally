import { UsageError } from '../../errors.ts'
import { parseCommandArgs, readBoolean, readString } from '../args.ts'
import { configPath } from '../../paths.ts'
import { readConfig, writeConfig } from '../../state/config.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'

export async function runConfig(argv: readonly string[]): Promise<number> {
  const subcommand = argv[0] ?? 'get'
  const args = parseCommandArgs(argv.slice(1), {
    'cloud-id': { type: 'string' },
    site: { type: 'string' },
    'atl-site': { type: 'string' },
    'account-id': { type: 'string' },
    'issue-type': { type: 'string' },
  })
  const file = configPath()

  if (subcommand === 'get') {
    const config = await readConfig(file)
    if (readBoolean(args, 'json')) {
      writeJson(successEnvelope('config get', config, { path: file }))
      return 0
    }
    writeOut(`Path        : ${file}`)
    writeOut(`Jira site   : ${config.jira?.siteUrl ?? '(not set)'}`)
    writeOut(`atl site    : ${config.jira?.site ?? '(default)'}`)
    writeOut(`Jira cloudId: ${config.jira?.cloudId ?? '(not set)'}`)
    writeOut(`Jira account: ${config.jira?.accountId ?? '(not set)'}`)
    writeOut(`Issue type  : ${config.defaults?.issueTypeName ?? '(not set)'}`)
    writeOut(`Mapped projects: ${Object.keys(config.projectMapping).length}`)
    return 0
  }

  if (subcommand === 'set-jira') {
    const cloudId = readString(args, 'cloud-id')
    const site = readString(args, 'site')
    const atlSite = readString(args, 'atl-site')
    const accountId = readString(args, 'account-id')
    const issueType = readString(args, 'issue-type')

    if (!cloudId && !site && !atlSite && !accountId && !issueType) {
      throw new UsageError('Usage: tally config set-jira [--cloud-id ID] [--site URL] [--atl-site NAME] [--account-id ID] [--issue-type NAME]')
    }

    const config = await readConfig(file)
    config.jira = {
      ...config.jira,
      ...(cloudId !== undefined ? { cloudId } : {}),
      ...(site !== undefined ? { siteUrl: site } : {}),
      ...(atlSite !== undefined ? { site: atlSite } : {}),
      ...(accountId !== undefined ? { accountId } : {}),
    }
    if (issueType !== undefined) config.defaults = { ...config.defaults, issueTypeName: issueType }
    await writeConfig(config, file)

    if (readBoolean(args, 'json')) writeJson(successEnvelope('config set-jira', config.jira, { path: file }))
    else writeOut(`Saved Jira settings to ${file}.`)
    return 0
  }

  throw new UsageError(`Unknown config subcommand "${subcommand}". Use get or set-jira.`)
}
