import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { platformContext, toolDirs, type PlatformContext } from '@kikedealba/kit/platform'

export const DB_PATH_ENV_VAR = 'TALLY_DB_PATH'
export const CONFIG_PATH_ENV_VAR = 'TALLY_CONFIG_PATH'
export const DRAFTS_DIR_ENV_VAR = 'TALLY_DRAFTS_DIR'
export const MEMORY_DB_PATH = ':memory:'

function pathApi(ctx: PlatformContext): path.PlatformPath {
  return ctx.platform === 'win32' ? path.win32 : path.posix
}

export function databasePath(ctx: PlatformContext = platformContext()): string {
  const override = ctx.env[DB_PATH_ENV_VAR]
  if (override) return override
  return pathApi(ctx).join(toolDirs('tally', ctx).data, 'tally.db')
}

export function configPath(ctx: PlatformContext = platformContext()): string {
  const override = ctx.env[CONFIG_PATH_ENV_VAR]
  if (override) return override
  return pathApi(ctx).join(toolDirs('tally', ctx).config, 'config.json')
}

export function draftsDir(ctx: PlatformContext = platformContext(), temp: string = tmpdir()): string {
  const override = ctx.env[DRAFTS_DIR_ENV_VAR]
  if (override) return override
  const owner = ctx.platform === 'win32' || typeof process.getuid !== 'function' ? 'tally' : `tally-${process.getuid()}`
  return pathApi(ctx).join(temp, owner, 'drafts')
}

export interface BitaLocation {
  database: string
  config: string
}

export type Exists = (file: string) => boolean

function firstExisting(candidates: readonly string[], exists: Exists): string {
  const unique = [...new Set(candidates)]
  return unique.find((file) => exists(file)) ?? (unique[0] as string)
}

export function bitaLocation(ctx: PlatformContext = platformContext(), exists: Exists = existsSync): BitaLocation {
  const p = pathApi(ctx)
  const dirs = toolDirs('bita', ctx)
  const legacyData = p.join(ctx.home, '.local', 'share', 'bita')
  const legacyConfig = p.join(ctx.home, '.config', 'bita')
  const database = ctx.env['BITA_DB_PATH'] || firstExisting([p.join(dirs.data, 'bita.db'), p.join(legacyData, 'bita.db')], exists)
  const config = ctx.env['BITA_CONFIG_PATH'] || firstExisting(
    ctx.platform === 'win32' ? [p.join(dirs.config, 'config.json'), p.join(legacyConfig, 'config.json')] : [p.join(legacyConfig, 'config.json'), p.join(dirs.config, 'config.json')],
    exists,
  )
  return { database, config }
}
