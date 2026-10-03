import { expect, test } from 'claude-code/testing'

import { checkpointPhaseOf, isRetroTrigger } from './retro'

test('a phase checkpoint commit triggers the retro', () => {
  expect(isRetroTrigger('git commit -m "phase(P0): add invoice export"', true)).toBe(true)
})

test('a successful milestone merge triggers the retro', () => {
  expect(isRetroTrigger('gh pr merge 812 --squash', true)).toBe(true)
})

test('a failed merge does not', () => {
  expect(isRetroTrigger('gh pr merge 812 --squash', false)).toBe(false)
})

test('an ordinary commit does not', () => {
  expect(isRetroTrigger('git commit -m "fix(api): invoice totals"', true)).toBe(false)
})

test('the phase a checkpoint commit names', () => {
  expect(checkpointPhaseOf('git commit -m "phase(P0): delete clean_unmonitored"')).toBe('P0')
  expect(checkpointPhaseOf('git commit -m "feat: add owners API"')).toBeUndefined()
})
