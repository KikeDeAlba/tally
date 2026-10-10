import { readFileSync } from 'node:fs'

const args = process.argv.slice(2).filter((arg) => arg !== '--json')
const notes = JSON.parse(readFileSync(process.env['FAKE_INKWELL_NOTES'] ?? '', 'utf8')) as Record<string, string>

function reply(command: string, data: unknown): void {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: true, command, generatedAt: new Date().toISOString(), data })}\n`)
}

const [head, sub, id] = args
if (head === 'capabilities') {
  reply('capabilities', { name: 'inkwell', version: '0.2.0', envelope: 1, capabilities: ['docs.page.read', 'docs.entry-notes'], emits: [] })
} else if (head === 'note' && sub === 'show') {
  const markdown = notes[id ?? '']
  const doc = markdown === undefined ? null : { kind: 'note', relPath: `notes/${id}.md`, path: `/docs/notes/${id}.md`, docTitle: `Note ${id}`, sectionCount: 2, byteSize: markdown.length, markdown }
  reply('note show', { id: Number(id), description: 'ajustar pipeline', doc, appendices: [] })
} else if (head === 'page' && sub === 'ls') {
  const entry = args[args.indexOf('--entry') + 1]
  reply('page ls', { pages: entry === '1' ? [{ pageId: 5, title: 'Pipeline', relPath: 'plataforma/pipeline.md', issues: [{ key: 'INN-9', status: 'Cerrada' }] }] : [] })
} else {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: false, command: head, generatedAt: new Date().toISOString(), error: { code: 'UNKNOWN_COMMAND', message: 'unknown' } })}\n`)
  process.exitCode = 2
}
