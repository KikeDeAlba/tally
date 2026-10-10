import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BASE_OPTIONS, FILTER_OPTIONS, RANGE_OPTIONS, parseCommandArgs } from '../src/cli/args.ts'
import { bitaRangeArgs } from '../src/cli/range.ts'
import { UsageError } from '../src/errors.ts'

const NOW = new Date('2026-10-10T18:00:00Z')

function range(argv: string[]) {
  return bitaRangeArgs(parseCommandArgs(argv, {}, { ...BASE_OPTIONS, ...RANGE_OPTIONS, ...FILTER_OPTIONS }), NOW, 'America/Mazatlan')
}

test('pending without a range looks back 90 days and says so', () => {
  const result = range(['--pending'])
  assert.deepEqual(result.args, ['--from', '2026-07-13'])
  assert.equal(result.warnings.length, 1)
})

test('presets, explicit days and the timezone go to bita as they are', () => {
  assert.deepEqual(range(['week']).args, ['week'])
  assert.deepEqual(range(['--from', '2026-10-01', '--to', '2026-10-05', '--timezone', 'UTC']).args, ['--from', '2026-10-01', '--to', '2026-10-05', '--timezone', 'UTC'])
  assert.deepEqual(range(['--last-days', '7']).args, ['--from', '2026-10-04'])
  assert.deepEqual(range([]).args, [])
})

test('contradictory ranges are refused', () => {
  assert.throws(() => range(['week', '--from', '2026-10-01']), UsageError)
  assert.throws(() => range(['week', '--last-days', '3']), UsageError)
  assert.throws(() => range(['--to', '2026-10-05', '--last-days', '3']), UsageError)
  assert.throws(() => range(['--from', '2026-10-06', '--to', '2026-10-05']), UsageError)
  assert.throws(() => range(['--from', '2026-02-31']), UsageError)
  assert.throws(() => range(['someday']), UsageError)
  assert.throws(() => range(['--pending', '--registered']), UsageError)
})
