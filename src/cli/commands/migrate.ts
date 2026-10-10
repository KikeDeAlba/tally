import { UsageError } from '../../errors.ts'
import { parseCommandArgs, readBoolean } from '../args.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'
import { openDatabase } from '../../db/open.ts'
import { bitaLocation, configPath } from '../../paths.ts'
import { migrateFromBita } from '../../migrate/from-bita.ts'

export async function runMigrate(argv: readonly string[]): Promise<number> {
  const args = parseCommandArgs(argv, {
    'from-bita': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  })
  if (!readBoolean(args, 'from-bita')) throw new UsageError('Usage: tally migrate --from-bita [--dry-run]')
  const dryRun = readBoolean(args, 'dry-run')
  const bita = bitaLocation()
  const db = openDatabase()
  try {
    const report = await migrateFromBita(db, { bitaDatabase: bita.database, bitaConfig: bita.config, tallyConfig: configPath() }, { dryRun })
    if (readBoolean(args, 'json')) {
      writeJson(successEnvelope('migrate', report))
      return 0
    }
    const { counts } = report
    const verb = dryRun ? 'would copy' : 'copied'
    writeOut(`${dryRun ? 'Dry run: nothing was written.' : 'Imported from bita.'}`)
    writeOut(`Registrations: ${counts.links.found} found, ${verb} ${counts.links.copied}, ${counts.links.skipped} already here`)
    writeOut(`Mappings     : ${counts.mappings.found} found, ${verb} ${counts.mappings.copied}, merged ${counts.mappings.merged}, ${counts.mappings.skipped} unchanged`)
    writeOut(`Stories      : ${counts.stories.found} found, ${verb} ${counts.stories.copied}`)
    writeOut(`Themes       : ${counts.themes.found} found, ${verb} ${counts.themes.copied}`)
    if (counts.jiraSettings.copied.length > 0) writeOut(`Jira settings: ${counts.jiraSettings.copied.join(', ')}`)
    if (counts.defaults.copied.length > 0) writeOut(`Defaults     : ${counts.defaults.copied.join(', ')}`)
    for (const warning of report.warnings) writeOut(`! ${warning}`)
    writeOut('bita was not modified.')
    return 0
  } finally {
    db.close()
  }
}
