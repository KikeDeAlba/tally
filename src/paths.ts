import path from 'node:path'
import { platformContext, toolDirs, type PlatformContext } from '@kikedealba/kit/platform'

export const DB_PATH_ENV_VAR = 'TALLY_DB_PATH'
export const CONFIG_PATH_ENV_VAR = 'TALLY_CONFIG_PATH'
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

export interface BitaLocation {
  database: string
  config: string
}

export function bitaLocation(ctx: PlatformContext = platformContext()): BitaLocation {
  const p = pathApi(ctx)
  const home = ctx.env['HOME'] ?? ctx.env['USERPROFILE'] ?? ctx.home
  const database = ctx.env['BITA_DB_PATH'] || p.join(ctx.env['XDG_DATA_HOME'] ?? p.join(home, '.local', 'share'), 'bita', 'bita.db')
  const config = ctx.env['BITA_CONFIG_PATH'] || p.join(home, '.config', 'bita', 'config.json')
  return { database, config }
}
