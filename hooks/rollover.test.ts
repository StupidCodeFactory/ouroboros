import { expect, test } from 'claude-code/testing'

import { contextShare, shouldRollOver } from './rollover'

test('context share counts every input token kind', () => {
  const usage = { input_tokens: 10_000, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 10_000, output_tokens: 0 }
  expect(contextShare(usage, 200_000)).toBe(0.55)
})

test('rolls over at 55 percent', () => {
  expect(shouldRollOver(0.55)).toBe(true)
  expect(shouldRollOver(0.54)).toBe(false)
})
