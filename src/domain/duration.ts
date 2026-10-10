export function formatDuration(totalSeconds: number): string {
  const minutes = Math.max(0, Math.round(totalSeconds / 60))
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60

  if (hours === 0) return `${remainder}m`
  if (remainder === 0) return `${hours}h`
  return `${hours}h ${remainder}m`
}

export function toMinutes(totalSeconds: number): number {
  return Math.max(0, Math.round(totalSeconds / 60))
}

export function toDecimalHours(totalSeconds: number): number {
  return Math.round((totalSeconds / 3600) * 100) / 100
}

export function elapsedSeconds(entry: { start: string; duration: number }, now: Date): number {
  if (entry.duration >= 0) return entry.duration
  const started = Date.parse(entry.start)
  if (!Number.isFinite(started)) return 0
  return Math.max(0, Math.floor((now.getTime() - started) / 1000))
}

export function roundUpToStep(totalSeconds: number, stepSeconds: number): number {
  if (stepSeconds <= 0) return totalSeconds
  const minutes = Math.max(0, Math.round(totalSeconds / 60))
  const stepMinutes = Math.round(stepSeconds / 60)
  return Math.ceil(minutes / stepMinutes) * stepMinutes * 60
}
