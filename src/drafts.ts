import { randomBytes } from 'node:crypto'
import { chmod, lstat, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { TallyError, UsageError } from './errors.ts'

export const DRAFT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/

export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000

function unsafe(dir: string): TallyError {
  return new TallyError(`${dir} is not a private directory owned by this user.`, 'DRAFTS_DIR_UNSAFE', { hint: 'Remove it or set TALLY_DRAFTS_DIR to a private directory.' })
}

async function ownedDirectory(dir: string, create: boolean): Promise<void> {
  if (create) await mkdir(dir, { recursive: true, mode: 0o700 })
  const info = await lstat(dir).catch(() => null)
  if (!info) throw unsafe(dir)
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  if (!info.isDirectory() || info.isSymbolicLink() || (uid !== null && info.uid !== uid)) throw unsafe(dir)
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) await chmod(dir, 0o700)
}

async function prune(dir: string, now: number): Promise<void> {
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!name.endsWith('.md')) continue
    const file = path.join(dir, name)
    const info = await lstat(file).catch(() => null)
    if (info?.isFile() && now - info.mtimeMs > DRAFT_MAX_AGE_MS) await rm(file, { force: true })
  }
}

export interface DraftOptions {
  now?: number
  checkParent?: boolean
}

export async function prepareDraft(dir: string, name: string, options: DraftOptions = {}): Promise<string> {
  const base = name.endsWith('.md') ? name.slice(0, -3) : name
  if (!DRAFT_NAME.test(base)) throw new UsageError(`Invalid draft name "${name}". Use letters, digits, "-" and "_".`)
  if (options.checkParent ?? true) await ownedDirectory(path.dirname(dir), true)
  await ownedDirectory(dir, true)
  await prune(dir, options.now ?? Date.now())
  return path.join(dir, `${base}-${randomBytes(4).toString('hex')}.md`)
}

export function isDraftPath(dir: string, file: string): boolean {
  const relative = path.relative(path.resolve(dir), path.resolve(file))
  return relative.length > 0 && !path.isAbsolute(relative) && !relative.startsWith('..') && path.dirname(relative) === '.' && relative.endsWith('.md')
}

export async function consumeDraft(dir: string, file: string): Promise<string> {
  const notDraft = new UsageError(`${file} is not a draft from "tally paths --draft".`, 'Write the text in the path printed by "tally paths --draft <name>".')
  if (!isDraftPath(dir, file)) throw notDraft
  await ownedDirectory(dir, false)
  const info = await lstat(file).catch(() => null)
  if (!info) throw new UsageError(`Cannot read the draft ${file}.`, 'Write the text in the path printed by "tally paths --draft <name>".')
  if (!info.isFile() || info.isSymbolicLink()) throw notDraft
  try {
    return await readFile(file, 'utf8')
  } finally {
    await rm(file, { force: true }).catch(() => undefined)
  }
}
