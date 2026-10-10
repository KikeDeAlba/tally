import { DEFAULT_PENDING_LOOKBACK_DAYS } from '../constants.ts'
import { UsageError } from '../errors.ts'
import { addDays, isValidIsoDay, localDay } from '../domain/timezone.ts'
import { hasExplicitRange, readInteger, readPreset, readRegistrationFilter, readString, type ParsedArgs } from './args.ts'

export interface BitaRangeRequest {
  args: string[]
  warnings: string[]
}

function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function bitaRangeArgs(args: ParsedArgs, now: Date = new Date(), fallbackTimezone?: string): BitaRangeRequest {
  const filter = readRegistrationFilter(args)
  const preset = readPreset(args)
  const from = readString(args, 'from')
  const to = readString(args, 'to')
  const timezone = readString(args, 'timezone')
  let lastDays = readInteger(args, 'last-days')
  const warnings: string[] = []

  if (preset !== undefined && (from !== undefined || to !== undefined)) {
    throw new UsageError('Use either a range preset or --from/--to, not both.')
  }
  if (from !== undefined && !isValidIsoDay(from)) throw new UsageError(`Invalid date for --from: "${from}". Expected format YYYY-MM-DD.`)
  if (to !== undefined && !isValidIsoDay(to)) throw new UsageError(`Invalid date for --to: "${to}". Expected format YYYY-MM-DD.`)
  if (lastDays !== undefined && lastDays < 1) throw new UsageError(`Invalid value for --last-days: "${lastDays}". Expected a positive integer.`)
  if (lastDays !== undefined && (preset !== undefined || from !== undefined || to !== undefined)) {
    throw new UsageError('Use --last-days on its own, not with a preset or --from/--to.')
  }
  if (from !== undefined && to !== undefined && from > to) throw new UsageError(`Empty range: --from ${from} is after --to ${to}.`)

  if (!hasExplicitRange(args) && filter === 'pending') {
    lastDays = DEFAULT_PENDING_LOOKBACK_DAYS
    warnings.push(`No range given; scanning the last ${DEFAULT_PENDING_LOOKBACK_DAYS} days. Use --from or --last-days to widen.`)
  }

  const out: string[] = []
  if (preset !== undefined) out.push(preset)
  if (from !== undefined || to !== undefined) {
    if (from !== undefined) out.push('--from', from)
    if (to !== undefined) out.push('--to', to)
  } else if (lastDays !== undefined) {
    const today = localDay(now, timezone ?? fallbackTimezone ?? systemTimezone())
    out.push('--from', addDays(today, -(lastDays - 1)))
  }
  if (timezone !== undefined) out.push('--timezone', timezone)
  return { args: out, warnings }
}
