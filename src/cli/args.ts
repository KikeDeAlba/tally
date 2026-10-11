import { parseArgs, type ParseArgsConfig } from 'node:util'
import { UsageError } from '../errors.ts'
import { RANGE_PRESETS, type RangePreset } from '../domain/presets.ts'
import type { RegistrationFilter } from '../domain/filter.ts'

type OptionConfig = NonNullable<ParseArgsConfig['options']>

export const BASE_OPTIONS: OptionConfig = {
  json: { type: 'boolean', default: false },
  timezone: { type: 'string' },
  verbose: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
}

export const RANGE_OPTIONS: OptionConfig = {
  from: { type: 'string' },
  to: { type: 'string' },
  'last-days': { type: 'string' },
}

export const FILTER_OPTIONS: OptionConfig = {
  pending: { type: 'boolean', default: false },
  registered: { type: 'boolean', default: false },
  'include-running': { type: 'boolean', default: false },
}

export const GLOBAL_OPTIONS: OptionConfig = {
  ...BASE_OPTIONS,
  ...RANGE_OPTIONS,
  ...FILTER_OPTIONS,
}

export interface ParsedArgs {
  values: Record<string, string | boolean | string[] | undefined>
  positionals: string[]
}

function nfc(value: string): string {
  return value.normalize('NFC')
}

export function parseCommandArgs(argv: readonly string[], options: OptionConfig, globals: OptionConfig = BASE_OPTIONS): ParsedArgs {
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: { ...globals, ...options },
      allowPositionals: true,
      strict: true,
    })
    const values: ParsedArgs['values'] = {}
    for (const [key, value] of Object.entries(parsed.values as ParsedArgs['values'])) {
      values[key] = typeof value === 'string' ? nfc(value) : Array.isArray(value) ? value.map(nfc) : value
    }
    return { values, positionals: parsed.positionals.map(nfc) }
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
}

export function readString(args: ParsedArgs, name: string): string | undefined {
  const value = args.values[name]
  return typeof value === 'string' ? value : undefined
}

export function readBoolean(args: ParsedArgs, name: string): boolean {
  return args.values[name] === true
}

export function readStringList(args: ParsedArgs, name: string): string[] {
  const value = args.values[name]
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return [value]
  return []
}

export function readInteger(args: ParsedArgs, name: string): number | undefined {
  const raw = readString(args, name)
  if (raw === undefined) return undefined
  const parsed = Number(raw)
  if (!Number.isInteger(parsed)) throw new UsageError(`Invalid value for --${name}: "${raw}". Expected an integer.`)
  return parsed
}

export function readEstimateStepSeconds(args: ParsedArgs): number | undefined {
  const minutes = readInteger(args, 'estimate-step-minutes')
  if (minutes !== undefined && minutes < 1) throw new UsageError(`--estimate-step-minutes must be 1 or more, got ${minutes}.`)
  return minutes === undefined ? undefined : minutes * 60
}

export function readPreset(args: ParsedArgs): RangePreset | undefined {
  const first = args.positionals[0]
  if (!first) return undefined
  if (!RANGE_PRESETS.includes(first as RangePreset)) {
    throw new UsageError(`Unknown range preset "${first}". Valid presets: ${RANGE_PRESETS.join(', ')}.`)
  }
  return first as RangePreset
}

export function hasExplicitRange(args: ParsedArgs): boolean {
  return readPreset(args) !== undefined || readString(args, 'from') !== undefined || readString(args, 'to') !== undefined || readInteger(args, 'last-days') !== undefined
}

export function readRegistrationFilter(args: ParsedArgs): RegistrationFilter {
  const pending = readBoolean(args, 'pending')
  const registered = readBoolean(args, 'registered')
  if (pending && registered) throw new UsageError('--pending and --registered contradict each other; pass only one.')
  if (pending) return 'pending'
  if (registered) return 'registered'
  return 'any'
}
