import { expect, test } from 'claude-code/testing'

import { checkpointVerdict, followUpSection, needsReview, reviewersForRound, triageFindings } from './phase_review'

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

const TASK_3_DIFF = [
  { file: 'lib/price_feed/gap_source_planner.rb', start: 12, end: 31 },
  { file: 'lib/price_feed/backfill/dashboard_client.rb', start: 1, end: 14 },
]

const UNTOUCHED_CALLERS = {
  reviewer: 'reviewer',
  file: 'lib/price_feed/backfill/runner.rb',
  line: 163,
  summary: 'Untouched callers still reach the singleton through .instance: runner.rb:163 calls DashboardClient.instance.holes.',
  root_cause: 'code-bug',
  blocking: true,
}

test('a blocking finding inside the task diff blocks', () => {
  expect(triageFindings([SINGLETON_FINDING], TASK_3_DIFF)).toEqual({ blocking: [SINGLETON_FINDING], followUps: [] })
})

test('a blocking finding on code outside the task diff becomes a follow-up and blocks nothing', () => {
  expect(triageFindings([UNTOUCHED_CALLERS], TASK_3_DIFF)).toEqual({ blocking: [], followUps: [UNTOUCHED_CALLERS] })
})

test('a blocking finding without a file and line cannot be placed in the diff, so it is a follow-up', () => {
  const planDrift = { reviewer: 'auditor', summary: 'Plan Task 4 is stale: its Files list still says Create: spec/guards/dangerous_tasks_spec.rb.', blocking: true }
  expect(triageFindings([planDrift], TASK_3_DIFF)).toEqual({ blocking: [], followUps: [planDrift] })
})

test('a non-blocking finding is neither', () => {
  expect(triageFindings([{ ...UNTOUCHED_CALLERS, blocking: false }], TASK_3_DIFF)).toEqual({ blocking: [], followUps: [] })
})

test('follow-ups land in the plan as one untagged task of unchecked boxes', () => {
  expect(followUpSection('P0', '3', [UNTOUCHED_CALLERS])).toBe(
    '\n### Task 3-follow-ups: follow-ups raised while reviewing P0 task 3\n' +
      '- [ ] Untouched callers still reach the singleton through .instance: runner.rb:163 calls DashboardClient.instance.holes. (lib/price_feed/backfill/runner.rb:163, raised by reviewer)\n',
  )
})

const WITHHELD_CHECKPOINT = {
  committed: false,
  sha: '',
  suite_green: false,
  evidence: 'I did not make the `phase(P0)` commit. The full ruby test run is red, and about 127 of its 136 failures are a regression caused by a P0 acceptance check, not by anything still waiting on P1.',
}

test('a checkpoint that withheld its commit escalates with its evidence', () => {
  expect(checkpointVerdict(WITHHELD_CHECKPOINT)).toEqual({ status: 'escalate', evidence: WITHHELD_CHECKPOINT.evidence })
})

test('a committed checkpoint on a red suite escalates', () => {
  expect(checkpointVerdict({ ...WITHHELD_CHECKPOINT, committed: true, sha: '4bdf9749' }).status).toBe('escalate')
})

test('a committed checkpoint on a green suite is checkpointed', () => {
  expect(checkpointVerdict({ committed: true, sha: '4bdf9749', suite_green: true, evidence: '1203 examples, 0 failures' })).toEqual({ status: 'checkpointed', evidence: '1203 examples, 0 failures' })
})

test('a checkpoint agent that returned nothing escalates', () => {
  expect(checkpointVerdict(null)).toEqual({ status: 'escalate', evidence: 'checkpoint agent returned nothing' })
})
