import { expect, test } from 'claude-code/testing'

import { needsReview, reviewersForRound } from './phase_review'

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

const REVIEWERS = [
  { agent: 'reviewer', stage: 'review' },
  { agent: 'architect', stage: 'architect_review' },
  { agent: 'auditor', stage: 'audit' },
]

const SINGLETON_FINDING = {
  reviewer: 'architect',
  file: 'lib/price_feed/gap_source_planner.rb',
  line: 19,
  summary: 'DashboardGaps still calls Backfill::DashboardClient.instance.gaps.',
  blocking: true,
}

const agentsOf = (reviewers: Array<{ agent: string }>) => reviewers.map(reviewer => reviewer.agent)

test('round one runs every reviewer', () => {
  expect(agentsOf(reviewersForRound(1, 3, REVIEWERS, [], []))).toEqual(['reviewer', 'architect', 'auditor'])
})

test('a middle round re-runs only the reviewers whose finding blocked, when the fix stays in their files', () => {
  const fix = [{ file: 'lib/price_feed/gap_source_planner.rb', start: 15, end: 22 }]
  expect(agentsOf(reviewersForRound(2, 3, REVIEWERS, [SINGLETON_FINDING], fix))).toEqual(['architect'])
})

test('a line three reviewers flagged is re-checked by one of them, not paid for three times', () => {
  const sameLine = ['reviewer', 'architect', 'auditor'].map(reviewer => ({ ...SINGLETON_FINDING, reviewer }))
  const fix = [{ file: '/repo/lib/price_feed/gap_source_planner.rb', start: 19, end: 19 }]
  expect(agentsOf(reviewersForRound(2, 3, REVIEWERS, sameLine, fix))).toEqual(['reviewer'])
})

test('a fix that touches a file outside the previous findings brings every reviewer back', () => {
  const fix = [
    { file: 'lib/price_feed/gap_source_planner.rb', start: 15, end: 22 },
    { file: 'lib/price_feed/backfill/dashboard_client.rb', start: 3, end: 9 },
  ]
  expect(agentsOf(reviewersForRound(2, 3, REVIEWERS, [SINGLETON_FINDING], fix))).toEqual(['reviewer', 'architect', 'auditor'])
})

test('the final round runs every reviewer', () => {
  const fix = [{ file: 'lib/price_feed/gap_source_planner.rb', start: 15, end: 22 }]
  expect(agentsOf(reviewersForRound(3, 3, REVIEWERS, [SINGLETON_FINDING], fix))).toEqual(['reviewer', 'architect', 'auditor'])
})

test('blocking findings nobody owns bring every reviewer back rather than none', () => {
  const unowned = [{ ...SINGLETON_FINDING, reviewer: undefined }]
  const fix = [{ file: 'lib/price_feed/gap_source_planner.rb', start: 15, end: 22 }]
  expect(agentsOf(reviewersForRound(2, 3, REVIEWERS, unowned, fix))).toEqual(['reviewer', 'architect', 'auditor'])
})
