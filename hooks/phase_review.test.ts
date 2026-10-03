import { expect, test } from 'claude-code/testing'

import { needsReview } from './phase_review'

const VERIFICATION_ONLY = {
  changed: false,
  commits: [],
  hunks: [],
  evidence: 'Task 2 verified. No code change, no commit (verification only; the plan is uncommitted by rule). bundle exec rspec spec/price_feed/backfill -> 106 examples, 0 failures',
}

const CODE_CHANGE = {
  changed: true,
  commits: ['b0510854'],
  hunks: [{ file: 'lib/price_feed/gap_source_planner.rb', start: 12, end: 31 }],
  evidence: 'Task 3 done. Commit b0510854 on milestone/m1-foundations.',
}

test('a task whose implementer changed nothing is not reviewed', () => {
  expect(needsReview(VERIFICATION_ONLY)).toBe(false)
})

test('a task with a code change is reviewed', () => {
  expect(needsReview(CODE_CHANGE)).toBe(true)
})

test('an implementer result without the structured field is reviewed, never skipped', () => {
  expect(needsReview(undefined)).toBe(true)
  expect(needsReview({ evidence: 'Task 2 verified. No code change.' })).toBe(true)
})
