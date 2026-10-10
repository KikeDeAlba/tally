import { ConflictError, UsageError } from '../../errors.ts'
import { parseCommandArgs, readBoolean, readString, readStringList, type ParsedArgs } from '../args.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'
import { inTransaction, openDatabase } from '../../db/open.ts'
import { findRegistration, register, unregister } from '../../db/registrations.ts'
import { requireBita, type BitaClient } from '../../integrations/bita.ts'
import { mapLimited } from '../../domain/concurrency.ts'
import { NOTES_CONCURRENCY } from '../../constants.ts'

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]+-\d+$/

const OPTIONS = {
  issue: { type: 'string' as const },
  worklog: { type: 'string' as const, multiple: true },
  ids: { type: 'string' as const },
  unlink: { type: 'boolean' as const, default: false },
  force: { type: 'boolean' as const, default: false },
}

function readIds(args: ParsedArgs): number[] {
  const fromFlag = (readString(args, 'ids') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  const raw = [...args.positionals, ...fromFlag]
  if (raw.length === 0) throw new UsageError('Usage: tally link <entryIds...> --issue <KEY> [--worklog <id>]')
  const ids = raw.map((value) => {
    const id = Number(value)
    if (!Number.isInteger(id) || id <= 0) throw new UsageError(`"${value}" is not an entry id.`)
    return id
  })
  return [...new Set(ids)]
}

function readWorklogs(args: ParsedArgs, ids: readonly number[]): Map<number, string | null> {
  const values = readStringList(args, 'worklog').flatMap((value) => value.split(',')).map((value) => value.trim()).filter((value) => value.length > 0)
  if (values.length > 1 && values.length !== ids.length) {
    throw new UsageError(`Got ${values.length} worklog ids for ${ids.length} entries. Pass one --worklog for all of them, or one per entry in the same order.`)
  }
  return new Map(ids.map((id, index) => [id, values.length === 0 ? null : (values.length === 1 ? values[0] : values[index]) ?? null]))
}

async function verifyEntries(bita: BitaClient, ids: readonly number[], force: boolean): Promise<void> {
  const details = await mapLimited(ids, NOTES_CONCURRENCY, async (id) => ({ id, detail: await bita.entry(id) }))
  const missing = details.filter((item) => item.detail === null).map((item) => item.id)
  if (missing.length > 0) throw new UsageError(`No entry with id ${missing.join(', ')} in bita.`)
  if (force) return
  const projects = new Map((await bita.projects()).map((project) => [project.id, project]))
  const outside = details.filter((item) => {
    const projectId = item.detail?.projectId ?? null
    return projectId !== null && projects.get(projectId)?.jira === false
  })
  if (outside.length > 0) {
    const projectName = outside[0]?.detail?.projectName ?? 'a project'
    throw new ConflictError(
      `Entries ${outside.map((item) => `#${item.id}`).join(', ')} belong to ${projectName}, which never goes to Jira.`,
      'NOT_A_JIRA_PROJECT',
      'tally link ... --force',
    )
  }
}

export async function runLink(argv: readonly string[]): Promise<number> {
  const args = parseCommandArgs(argv, OPTIONS)
  const json = readBoolean(args, 'json')
  const ids = readIds(args)
  const unlink = readBoolean(args, 'unlink')
  const issueKey = readString(args, 'issue')?.toUpperCase()

  if (!unlink) {
    if (issueKey === undefined) throw new UsageError('tally link needs --issue <KEY>, or --unlink to undo one.')
    if (!ISSUE_KEY_PATTERN.test(issueKey)) throw new UsageError(`Invalid Jira issue key: "${issueKey}". Expected something like DD-1896.`)
  }
  const worklogs = unlink ? new Map<number, string | null>() : readWorklogs(args, ids)

  if (!unlink) await verifyEntries(await requireBita(), ids, readBoolean(args, 'force'))

  const db = openDatabase()
  let changed: number[]
  let alreadyLinked: number[]
  try {
    alreadyLinked = unlink ? [] : ids.filter((id) => findRegistration(db, id) !== undefined)
    const linkedAt = new Date().toISOString()
    changed = inTransaction(db, () => {
      const done: number[] = []
      for (const id of ids) {
        if (unlink) {
          if (unregister(db, id)) done.push(id)
          continue
        }
        register(db, { entryId: id, issueKey: issueKey ?? null, worklogId: worklogs.get(id) ?? null, linkedAt })
        done.push(id)
      }
      return done
    })
  } finally {
    db.close()
  }

  const withWorklog = [...worklogs.entries()].filter(([, worklogId]) => worklogId !== null)
  const payload = {
    action: unlink ? 'unlink' : 'link',
    issueKey: unlink ? null : (issueKey ?? null),
    entryIds: changed,
    relinked: alreadyLinked,
    ...(withWorklog.length > 0 ? { worklogs: withWorklog.map(([entryId, worklogId]) => ({ entryId, worklogId })) } : {}),
  }

  if (json) {
    writeJson(successEnvelope('link', payload))
    return 0
  }
  if (unlink) {
    writeOut(`Unlinked ${changed.length} entries.`)
  } else {
    writeOut(`Linked ${changed.length} entries to ${issueKey}.`)
    if (alreadyLinked.length > 0) writeOut(`${alreadyLinked.length} of them were already linked and were overwritten.`)
  }
  return 0
}
