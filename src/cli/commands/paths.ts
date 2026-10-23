import path from 'node:path'
import { prepareDraft } from '../../drafts.ts'
import { bitaLocation, configPath, databasePath, draftsDir, DRAFTS_DIR_ENV_VAR } from '../../paths.ts'
import { PACKAGE_ROOT } from '../../version.ts'
import { parseCommandArgs, readBoolean, readString } from '../args.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'

export function skillDir(): string {
  return path.join(PACKAGE_ROOT, 'skills', 'tally')
}

export async function runPaths(argv: readonly string[]): Promise<number> {
  const args = parseCommandArgs(argv, { draft: { type: 'string' } })
  const name = readString(args, 'draft')
  const json = readBoolean(args, 'json')
  if (name !== undefined) {
    const draft = await prepareDraft(draftsDir(), name, { checkParent: !process.env[DRAFTS_DIR_ENV_VAR] })
    if (json) writeJson(successEnvelope('paths', { draft }))
    else writeOut(draft)
    return 0
  }
  const data = { database: databasePath(), config: configPath(), skill: skillDir(), drafts: draftsDir(), bita: bitaLocation() }
  if (json) {
    writeJson(successEnvelope('paths', data))
    return 0
  }
  writeOut(`database     : ${data.database}`)
  writeOut(`config       : ${data.config}`)
  writeOut(`skill        : ${data.skill}`)
  writeOut(`drafts       : ${data.drafts}`)
  writeOut(`bita database: ${data.bita.database}`)
  writeOut(`bita config  : ${data.bita.config}`)
  return 0
}
