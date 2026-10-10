import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roundUpToStep } from '../src/domain/duration.ts'
import { groupEntries } from '../src/domain/group.ts'
import { makeEntry, TEST_TZ } from './helpers/entries.ts'

const HALF_HOUR = 1800
const options = { timezone: TEST_TZ }

test('rounds the estimate up to the next half hour', () => {
  assert.equal(roundUpToStep(3 * 3600 + 43 * 60, HALF_HOUR), 4 * 3600)
  assert.equal(roundUpToStep(5 * 3600 + 43 * 60, HALF_HOUR), 6 * 3600)
  assert.equal(roundUpToStep(60, HALF_HOUR), HALF_HOUR)
  assert.equal(roundUpToStep(2 * 3600 + 60, HALF_HOUR), 2 * 3600 + HALF_HOUR)
})

test('leaves an exact multiple alone', () => {
  assert.equal(roundUpToStep(HALF_HOUR, HALF_HOUR), HALF_HOUR)
  assert.equal(roundUpToStep(3600, HALF_HOUR), 3600)
  assert.equal(roundUpToStep(8 * 3600, HALF_HOUR), 8 * 3600)
})

test('rounds zero to zero rather than to a full step', () => {
  assert.equal(roundUpToStep(0, HALF_HOUR), 0)
})

test('rounds the seconds first so a hair under a step does not jump twice', () => {
  assert.equal(roundUpToStep(HALF_HOUR - 20, HALF_HOUR), HALF_HOUR)
  assert.equal(roundUpToStep(HALF_HOUR + 20, HALF_HOUR), HALF_HOUR)
  assert.equal(roundUpToStep(HALF_HOUR + 40, HALF_HOUR), 2 * HALF_HOUR)
})

test('a group carries the exact total and the rounded estimate side by side', () => {
  const groups = groupEntries(
    [
      makeEntry({ id: 1, start: '2026-09-14T16:53:36Z', durationSeconds: 16035 }),
      makeEntry({ id: 2, start: '2026-09-14T23:00:54Z', durationSeconds: 4562 }),
    ],
    options,
  )
  const group = groups[0]

  assert.equal(group?.totalSeconds, 20597)
  assert.equal(group?.totalHuman, '5h 43m')
  assert.equal(group?.estimateSeconds, 6 * 3600)
  assert.equal(group?.estimateHuman, '6h')
})

test('the worklogs keep the exact toggl time, only the estimate is rounded', () => {
  const groups = groupEntries([makeEntry({ id: 1, durationSeconds: 4562 })], options)
  const group = groups[0]

  assert.equal(group?.worklogs[0]?.timeSpent, '1h 16m')
  assert.equal(group?.worklogs[0]?.durationSeconds, 4562)
  assert.equal(group?.estimateHuman, '1h 30m')
})

test('rounding never pushes a capped task over the eight hour limit', () => {
  const groups = groupEntries(
    [
      makeEntry({ id: 1, start: '2026-09-14T13:00:00Z', durationSeconds: 7 * 3600 + 46 * 60 }),
      makeEntry({ id: 2, start: '2026-09-15T13:00:00Z', durationSeconds: 3600 }),
    ],
    options,
  )

  for (const group of groups) {
    assert.ok(group.estimateSeconds <= 8 * 3600, `${group.summary} estimate over the cap`)
  }
})

test('honours a custom rounding step', () => {
  const groups = groupEntries([makeEntry({ id: 1, durationSeconds: 3660 })], {
    ...options,
    estimateStepSeconds: 900,
  })

  assert.equal(groups[0]?.estimateHuman, '1h 15m')
})
