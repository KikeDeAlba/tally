export const DEFAULT_MONTHLY_HOURS = 160
export const DEFAULT_MULTIPLIER = 2
export const DEFAULT_CURRENCY = 'MXN'
export const MAX_MONTHS = 36

export interface PayRate {
  salary: number | null
  monthlyHours: number
  multiplier: number
  currency: string
}

export interface MonthOvertime {
  estimateSeconds: number
  expectedSeconds: number
  overtimeSeconds: number
  payX1: number | null
  payMultiplied: number | null
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export function hourlyRate(rate: PayRate): number | null {
  return rate.salary === null ? null : rate.salary / rate.monthlyHours
}

export function expectedSeconds(rate: PayRate): number {
  return Math.round(rate.monthlyHours * 3600)
}

export function monthOvertime(estimateSeconds: number, rate: PayRate): MonthOvertime {
  const expected = expectedSeconds(rate)
  const overtimeSeconds = Math.max(0, estimateSeconds - expected)
  const perHour = hourlyRate(rate)
  const hours = overtimeSeconds / 3600
  return {
    estimateSeconds,
    expectedSeconds: expected,
    overtimeSeconds,
    payX1: perHour === null ? null : roundMoney(hours * perHour),
    payMultiplied: perHour === null ? null : roundMoney(hours * perHour * rate.multiplier),
  }
}

export function sumOvertime(months: readonly MonthOvertime[], rate: PayRate): MonthOvertime {
  const paid = rate.salary !== null
  return months.reduce<MonthOvertime>(
    (total, month) => ({
      estimateSeconds: total.estimateSeconds + month.estimateSeconds,
      expectedSeconds: total.expectedSeconds + month.expectedSeconds,
      overtimeSeconds: total.overtimeSeconds + month.overtimeSeconds,
      payX1: paid ? roundMoney((total.payX1 ?? 0) + (month.payX1 ?? 0)) : null,
      payMultiplied: paid ? roundMoney((total.payMultiplied ?? 0) + (month.payMultiplied ?? 0)) : null,
    }),
    { estimateSeconds: 0, expectedSeconds: 0, overtimeSeconds: 0, payX1: paid ? 0 : null, payMultiplied: paid ? 0 : null },
  )
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/

export function isValidMonth(value: string): boolean {
  return MONTH.test(value)
}

export function monthBounds(month: string): { fromDay: string; toDay: string } {
  const match = MONTH.exec(month)
  if (!match) throw new Error(`Invalid month "${month}".`)
  const year = Number(match[1])
  const index = Number(match[2])
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate()
  return { fromDay: `${month}-01`, toDay: `${month}-${String(last).padStart(2, '0')}` }
}

export function nextMonth(month: string): string {
  const [year, index] = month.split('-').map(Number) as [number, number]
  return index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, '0')}`
}

export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = []
  for (let month = from; month <= to; month = nextMonth(month)) months.push(month)
  return months
}

export function parseAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/[\s,_$]/g, '')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) && value > 0 ? value : null
}
