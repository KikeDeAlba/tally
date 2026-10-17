import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  epicMode,
  jiraTarget,
  mergeProjectMapping,
  normalizeProjectMapping,
  NO_EPIC,
  readConfig,
  setBoard,
  setProjectMapping,
  setStory,
  unsetProjectMapping,
  type ProjectMapping,
} from '../src/state/config.ts'

async function tempConfigPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tally-cfg-'))
  return path.join(dir, 'config.json')
}

test('keeps a separate epic for each toggl project inside the same jira project', async () => {
  const configPath = await tempConfigPath()

  await setProjectMapping(
    222494997,
    { projectName: 'Pharma STI', jiraProjectKey: 'INN', parentKey: 'INN-1213' },
    configPath,
  )
  await setProjectMapping(
    222440981,
    { projectName: 'ARSM', jiraProjectKey: 'INN', parentKey: 'INN-1216' },
    configPath,
  )

  const config = await readConfig(configPath)

  assert.equal(config.projectMapping['222494997']?.jiraProjectKey, 'INN')
  assert.equal(config.projectMapping['222440981']?.jiraProjectKey, 'INN')
  assert.equal(config.projectMapping['222494997']?.parentKey, 'INN-1213')
  assert.equal(config.projectMapping['222440981']?.parentKey, 'INN-1216')
})

test('a mapping without an epic stays without one', async () => {
  const configPath = await tempConfigPath()

  await setProjectMapping(
    219665238,
    { projectName: 'IA DP', jiraProjectKey: 'IADP' },
    configPath,
  )

  const config = await readConfig(configPath)

  assert.equal(config.projectMapping['219665238']?.jiraProjectKey, 'IADP')
  assert.equal(config.projectMapping['219665238']?.parentKey, undefined)
})

test('overwriting a mapping replaces its epic', async () => {
  const configPath = await tempConfigPath()

  await setProjectMapping(1, { projectName: 'X', jiraProjectKey: 'INN', parentKey: 'INN-1' }, configPath)
  await setProjectMapping(1, { projectName: 'X', jiraProjectKey: 'INN', parentKey: 'INN-2' }, configPath)

  const config = await readConfig(configPath)

  assert.equal(config.projectMapping['1']?.parentKey, 'INN-2')
})

test('unsetting removes the mapping and leaves the others alone', async () => {
  const configPath = await tempConfigPath()

  await setProjectMapping(1, { projectName: 'X', jiraProjectKey: 'INN', parentKey: 'INN-1' }, configPath)
  await setProjectMapping(2, { projectName: 'Y', jiraProjectKey: 'INN', parentKey: 'INN-2' }, configPath)

  assert.equal(await unsetProjectMapping(1, configPath), true)
  assert.equal(await unsetProjectMapping(99, configPath), false)

  const config = await readConfig(configPath)

  assert.equal(config.projectMapping['1'], undefined)
  assert.equal(config.projectMapping['2']?.parentKey, 'INN-2')
})

test('the config file is written with owner-only permissions', async () => {
  const configPath = await tempConfigPath()
  await setProjectMapping(1, { projectName: 'X', jiraProjectKey: 'INN' }, configPath)

  const raw = await readFile(configPath, 'utf8')

  assert.match(raw, /"jiraProjectKey": "INN"/)
})

test('legacy stories move under the epic they were created in', () => {
  const migrated = {
    projectMapping: normalizeProjectMapping({
      '1': {
        projectName: 'Apartados',
        jiraProjectKey: 'VBAA',
        parentKey: 'VBAA-639',
        stories: { infra: { key: 'VBAA-680', summary: 'infra', verifiedAt: 'x' } },
      } as ProjectMapping,
      '2': {
        projectName: 'Global',
        jiraProjectKey: 'VBGLOBAL',
        stories: { soporte: { key: 'VBGLOBAL-9', summary: 'soporte', verifiedAt: 'x' } },
      } as ProjectMapping,
    }),
  }

  assert.equal(migrated.projectMapping?.['1']?.storiesByEpic?.['VBAA-639']?.infra?.key, 'VBAA-680')
  assert.equal(migrated.projectMapping?.['2']?.storiesByEpic?.['']?.soporte?.key, 'VBGLOBAL-9')
  assert.equal('stories' in (migrated.projectMapping?.['1'] ?? {}), false)
})

test('changing the epic keeps the cached stories and the done transition', async () => {
  const configPath = await tempConfigPath()

  await setProjectMapping(
    1,
    {
      projectName: 'Apartados',
      jiraProjectKey: 'VBAA',
      parentKey: 'VBAA-639',
      doneTransition: { id: '41', name: 'Listo' },
      issueTypeName: 'Subtarea',
    },
    configPath,
  )
  await setStory(1, 'infra', { key: 'VBAA-680', summary: 'infra', verifiedAt: 'x' }, 'VBAA-639', configPath)
  await setProjectMapping(1, { projectName: 'Apartados', jiraProjectKey: 'VBAA', parentKey: 'VBAA-685' }, configPath)

  const mapping = (await readConfig(configPath)).projectMapping['1']

  assert.equal(mapping?.parentKey, 'VBAA-685')
  assert.equal(mapping?.doneTransition?.id, '41')
  assert.equal(mapping?.issueTypeName, 'Subtarea')
  assert.equal(mapping?.storiesByEpic?.['VBAA-639']?.infra?.key, 'VBAA-680')
})

test('pointing at the board drops the epic and keeps every cached story', async () => {
  const configPath = await tempConfigPath()

  await setProjectMapping(1, { projectName: 'Apartados', jiraProjectKey: 'VBAA', parentKey: 'VBAA-639' }, configPath)
  await setStory(1, 'infra', { key: 'VBAA-680', summary: 'infra', verifiedAt: 'x' }, 'VBAA-639', configPath)
  await setProjectMapping(
    1,
    { projectName: 'Apartados', jiraProjectKey: 'VBAA', parentKey: null, hierarchy: 'story-subtask', epicResolved: true },
    configPath,
  )

  const mapping = (await readConfig(configPath)).projectMapping['1']

  assert.equal(mapping?.parentKey, undefined)
  assert.equal(mapping && epicMode(mapping), 'per-run')
  assert.equal(mapping?.storiesByEpic?.['VBAA-639']?.infra?.key, 'VBAA-680')
})

test('moving to another board forgets what belonged to the old one', () => {
  const merged = mergeProjectMapping(
    {
      projectName: 'X',
      jiraProjectKey: 'INN',
      parentKey: 'INN-1',
      doneTransition: { id: '31', name: 'Done' },
      issueTypeId: '10012',
      storiesByEpic: { 'INN-1': { infra: { key: 'INN-2', summary: 'infra', verifiedAt: 'x' } } },
      issueTypeName: 'Tarea',
    },
    { projectName: 'X', jiraProjectKey: 'VBAA' },
  )

  assert.equal(merged.jiraProjectKey, 'VBAA')
  assert.equal(merged.parentKey, undefined)
  assert.equal(merged.doneTransition, undefined)
  assert.equal(merged.issueTypeId, undefined)
  assert.equal(merged.storiesByEpic, undefined)
  assert.equal(merged.issueTypeName, 'Tarea')
})

test('stories cached under different epics do not overwrite each other', async () => {
  const configPath = await tempConfigPath()

  await setProjectMapping(1, { projectName: 'Apartados', jiraProjectKey: 'VBAA' }, configPath)
  await setStory(1, 'seguridad', { key: 'VBAA-686', summary: 'Seguridad', verifiedAt: 'x' }, 'VBAA-685', configPath)
  await setStory(1, 'seguridad', { key: 'VBAA-700', summary: 'Seguridad', verifiedAt: 'x' }, 'VBAA-5', configPath)
  await setStory(1, 'soporte', { key: 'VBAA-701', summary: 'Soporte', verifiedAt: 'x' }, NO_EPIC, configPath)

  const stories = (await readConfig(configPath)).projectMapping['1']?.storiesByEpic

  assert.equal(stories?.['VBAA-685']?.seguridad?.key, 'VBAA-686')
  assert.equal(stories?.['VBAA-5']?.seguridad?.key, 'VBAA-700')
  assert.equal(stories?.['']?.soporte?.key, 'VBAA-701')
})

test('the epic mode follows from what the mapping points at', () => {
  assert.equal(epicMode({ projectName: 'A', jiraProjectKey: 'GCCAPP', parentKey: 'GCCAPP-2207' }), 'fixed')
  assert.equal(epicMode({ projectName: 'B', jiraProjectKey: 'VBAA' }), 'per-run')
  assert.equal(epicMode({ projectName: 'C', jiraProjectKey: 'VBAA', hierarchy: 'story-subtask' }), 'per-run')
  assert.equal(epicMode({ projectName: 'D', jiraProjectKey: 'DD', hierarchy: 'flat-task' }), 'flat')
})

test('a fixed epic reports the same target as before', () => {
  const target = jiraTarget({
    projectName: 'GCC',
    jiraProjectKey: 'GCCAPP',
    parentKey: 'GCCAPP-2207',
    hierarchy: 'epic-story-subtask',
    epicResolved: true,
    storiesByEpic: { 'GCCAPP-2207': { infra: { key: 'GCCAPP-2208', summary: 'infra', verifiedAt: 'x' } } },
  })

  assert.equal(target.epicMode, 'fixed')
  assert.equal(target.jiraEpicKey, 'GCCAPP-2207')
  assert.equal(target.jiraParentKey, 'GCCAPP-2207')
  assert.equal(target.hierarchy, 'epic-story-subtask')
  assert.equal(target.jiraStories.infra?.key, 'GCCAPP-2208')
})

test('a board target leaves the epic open and hands over every cached story', () => {
  const target = jiraTarget({
    projectName: 'Apartados',
    jiraProjectKey: 'VBAA',
    hierarchy: 'story-subtask',
    epicResolved: true,
    storiesByEpic: {
      'VBAA-639': { infra: { key: 'VBAA-680', summary: 'infra', verifiedAt: 'x' } },
      '': { soporte: { key: 'VBAA-701', summary: 'soporte', verifiedAt: 'x' } },
    },
  })

  assert.equal(target.epicMode, 'per-run')
  assert.equal(target.jiraEpicKey, null)
  assert.equal(target.jiraParentKey, null)
  assert.deepEqual(Object.keys(target.jiraStories), ['soporte'])
  assert.equal(target.jiraStoriesByEpic['VBAA-639']?.infra?.key, 'VBAA-680')
})

test('an unmapped project has no target', () => {
  const target = jiraTarget(undefined)

  assert.equal(target.jiraProjectKey, null)
  assert.equal(target.epicMode, null)
  assert.equal(target.hierarchy, 'story-subtask')
})

test('keys tally does not know survive a rewrite', async () => {
  const configPath = await tempConfigPath()
  const { writeFile } = await import('node:fs/promises')
  await writeFile(configPath, JSON.stringify({ version: 1, projectMapping: {}, extra: { keep: true } }))
  await setProjectMapping(5, { projectName: 'Cinco', jiraProjectKey: 'CIN' }, configPath)
  const raw = JSON.parse(await readFile(configPath, 'utf8'))
  assert.deepEqual(raw.extra, { keep: true })
  assert.equal(raw.projectMapping['5'].jiraProjectKey, 'CIN')
})

test('the sprint board stays with its Jira project', async () => {
  const configPath = await tempConfigPath()

  await setProjectMapping(1, { projectName: 'X', jiraProjectKey: 'DD' }, configPath)
  await setBoard(1, 174, configPath)
  await setProjectMapping(1, { projectName: 'X', jiraProjectKey: 'DD', hierarchy: 'story-subtask' }, configPath)
  assert.equal((await readConfig(configPath)).projectMapping['1']?.boardId, 174)
  assert.equal(jiraTarget((await readConfig(configPath)).projectMapping['1']).jiraBoardId, 174)

  await setProjectMapping(1, { projectName: 'X', jiraProjectKey: 'INN' }, configPath)
  assert.equal((await readConfig(configPath)).projectMapping['1']?.boardId, undefined)
  assert.equal(jiraTarget(undefined).jiraBoardId, null)
  await assert.rejects(setBoard(2, 84, configPath))
})
