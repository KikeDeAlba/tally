import { randomBytes } from 'node:crypto'
import { lstat, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { TallyError, UsageError } from './errors.ts'

export const DRAFT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/

export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000

async function ownedDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const info = await lstat(dir)
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  if (!info.isDirectory() || info.isSymbolicLink() || (uid !== null && info.uid !== uid)) {
    throw new TallyError(`${dir} is not a directory owned by this user.`, 'DRAFTS_DIR_UNSAFE', { hint: 'Remove it or set TALLY_DRAFTS_DIR to a private directory.' })
  }
}

async function prune(dir: string, now: number): Promise<void> {
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!name.endsWith('.md')) continue
    const file = path.join(dir, name)
    const info = await lstat(file).catch(() => null)
    if (info?.isFile() && now - info.mtimeMs > DRAFT_MAX_AGE_MS) await rm(file, { force: true })
  }
}

export async function prepareDraft(dir: string, name: string, now: number = Date.now()): Promise<string> {
  const base = name.endsWith('.md') ? name.slice(0, -3) : name
  if (!DRAFT_NAME.test(base)) throw new UsageError(`Invalid draft name "${name}". Use letters, digits, "-" and "_".`)
  await ownedDirectory(path.dirname(dir))
  await ownedDirectory(dir)
  await prune(dir, now)
  return path.join(dir, `${base}-${randomBytes(4).toString('hex')}.md`)
}
