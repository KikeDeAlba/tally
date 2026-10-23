import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { agents } from '@kikedealba/kit'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), 'utf8')
const json = (...parts: string[]) => JSON.parse(read(...parts)) as Record<string, any>
const lines = (text: string) => text.split('\n').length
const VERSION = json('package.json')['version']

function pluginMarkdown(): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(rel)
      else if (entry.name.endsWith('.md')) files.push(rel)
    }
  }
  walk('skills')
  walk('agents')
  return files
}

test('the plugin and marketplace manifests are valid and carry the package version', () => {
  const plugin = json('.claude-plugin', 'plugin.json')
  const marketplace = json('.claude-plugin', 'marketplace.json')
  assert.equal(plugin['name'], 'tally')
  assert.equal(plugin['version'], VERSION)
  assert.equal(marketplace['name'], 'tally')
  assert.equal(typeof marketplace['owner']?.name, 'string')
  assert.deepEqual(marketplace['plugins'].map((entry: { name: string; source: string; version: string }) => [entry.name, entry.source, entry.version]), [['tally', './', VERSION]])
})

test('the tally skill stays short and links its supporting files', () => {
  const skill = read('skills', 'tally', 'SKILL.md')
  assert.ok(lines(skill) < 150, `SKILL.md has ${lines(skill)} lines`)
  const { attributes } = agents.parseFrontmatter(skill)
  assert.equal(attributes['name'], 'tally')
  assert.ok(!('disable-model-invocation' in attributes))
  for (const file of ['procedure.md', 'meetings.md']) {
    assert.ok(skill.includes(`](${file})`), `SKILL.md links ${file}`)
    assert.ok(existsSync(path.join(ROOT, 'skills', 'tally', file)))
  }
  assert.ok(skill.includes('inkwell guide writing'))
  for (const file of pluginMarkdown()) assert.ok(lines(read(file)) < 500, `${file} is under 500 lines`)
})

test('the user skills only run when the user invokes them', () => {
  for (const name of ['tally-pending', 'tally-push']) {
    const { attributes, body } = agents.parseFrontmatter(read('skills', name, 'SKILL.md'))
    assert.equal(attributes['name'], name)
    assert.equal(attributes['disable-model-invocation'], 'true')
    assert.ok((attributes['description'] ?? '').length > 0)
    assert.ok(body.trim().length > 0)
  }
    assert.ok(read('skills', 'tally-push', 'SKILL.md').includes('subagente `tally-push`'))
})

test('the tally-push subagent is limited to Bash, Read and Write and uses the brief summary', () => {
  const { attributes, body } = agents.parseFrontmatter(read('agents', 'tally-push.md'))
  assert.equal(attributes['name'], 'tally-push')
  assert.ok((attributes['description'] ?? '').length > 0)
  assert.deepEqual((attributes['tools'] ?? '').split(',').map((tool) => tool.trim()), ['Bash', 'Read', 'Write'])
  assert.ok(['sonnet', 'inherit'].includes(attributes['model'] ?? ''))
  assert.ok(body.includes('tally summary --pending --brief --json'))
  assert.ok(body.includes('tally link'))
})

test('markdown drafts come from tally paths --draft and are written with the file tool, never with a shell heredoc', () => {
  for (const file of pluginMarkdown()) {
    const text = read(file)
    assert.doesNotMatch(text, /<<'?[A-Z]+'?|cat >|\/tmp\//, `${file} writes files through the shell`)
  }
  for (const file of [path.join('skills', 'tally', 'procedure.md'), path.join('agents', 'tally-push.md')]) {
    const text = read(...file.split(path.sep))
    assert.ok(text.includes('tally paths --draft'), file)
    assert.ok(text.includes('"@<ruta>"'), file)
  }
})

test('Jira goes only through the atl CLI, and every JSON summary call asks for the brief shape', () => {
  for (const file of pluginMarkdown()) {
    const text = read(file)
    assert.doesNotMatch(text, /rovo|mcp__|:::\s*agent/i, `${file} mentions an MCP path to Jira`)
    assert.doesNotMatch(text, /\bjira_[a-z]/, `${file} mentions an atl MCP tool`)
    for (const call of text.match(/tally summary(?!:)[^`\n]*/g) ?? []) if (call.includes('--json')) assert.match(call, /--brief/, `${file}: ${call}`)
  }
})
