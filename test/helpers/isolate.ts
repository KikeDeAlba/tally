import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = mkdtempSync(join(tmpdir(), 'tally-test-'))
process.env['KIT_REGISTRY_DIR'] ??= join(sandbox, 'registry')
process.env['TALLY_DB_PATH'] ??= join(sandbox, 'tally.db')
process.env['TALLY_CONFIG_PATH'] ??= join(sandbox, 'config.json')
process.env['BITA_DB_PATH'] ??= join(sandbox, 'bita.db')
process.env['BITA_CONFIG_PATH'] ??= join(sandbox, 'bita-config.json')
process.env['TALLY_NO_NOTIFY'] ??= '1'
