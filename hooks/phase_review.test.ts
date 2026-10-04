import { expect, test } from 'claude-code/testing'

import { checkpointVerdict, fixRequests, isBlocked, pathsOverlap, distinctFindings, followUpSection, tasksToRetry, taskWaves, needsReview, phaseFollowUps, reviewersForRound, triagePhaseFindings } from './phase_review'

const VERIFICATION_ONLY = {
  changed: false,
  commits: [],
  hunks: [],
  evidence: 'Task 2 verified. No code change, no commit (verification only; the plan is uncommitted by rule). bundle exec rspec spec/shop/backfill -> 106 examples, 0 failures',
}

const CODE_CHANGE = {
  changed: true,
  commits: ['b0510854'],
  hunks: [{ file: 'lib/shop/gap_source_planner.rb', start: 12, end: 31 }],
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
  file: 'lib/shop/gap_source_planner.rb',
  line: 19,
  summary: 'DashboardGaps still calls Backfill::DashboardClient.instance.gaps.',
  blocking: true,
}

const agentsOf = (reviewers: Array<{ agent: string }>) => reviewers.map(reviewer => reviewer.agent)

test('round one runs every reviewer', () => {
  expect(agentsOf(reviewersForRound(1, 3, REVIEWERS, [], []))).toEqual(['reviewer', 'architect', 'auditor'])
})

test('a middle round re-runs only the reviewers whose finding blocked, when the fix stays in their files', () => {
  const fix = [{ file: 'lib/shop/gap_source_planner.rb', start: 15, end: 22 }]
  expect(agentsOf(reviewersForRound(2, 3, REVIEWERS, [SINGLETON_FINDING], fix))).toEqual(['architect'])
})

test('a line three reviewers flagged is re-checked by one of them, not paid for three times', () => {
  const sameLine = ['reviewer', 'architect', 'auditor'].map(reviewer => ({ ...SINGLETON_FINDING, reviewer }))
  const fix = [{ file: '/repo/lib/shop/gap_source_planner.rb', start: 19, end: 19 }]
  expect(agentsOf(reviewersForRound(2, 3, REVIEWERS, sameLine, fix))).toEqual(['reviewer'])
})

test('a fix that touches a file outside the previous findings brings every reviewer back', () => {
  const fix = [
    { file: 'lib/shop/gap_source_planner.rb', start: 15, end: 22 },
    { file: 'lib/shop/backfill/dashboard_client.rb', start: 3, end: 9 },
  ]
  expect(agentsOf(reviewersForRound(2, 3, REVIEWERS, [SINGLETON_FINDING], fix))).toEqual(['reviewer', 'architect', 'auditor'])
})

test('the final round runs every reviewer', () => {
  const fix = [{ file: 'lib/shop/gap_source_planner.rb', start: 15, end: 22 }]
  expect(agentsOf(reviewersForRound(3, 3, REVIEWERS, [SINGLETON_FINDING], fix))).toEqual(['reviewer', 'architect', 'auditor'])
})

test('blocking findings nobody owns bring every reviewer back rather than none', () => {
  const unowned = [{ ...SINGLETON_FINDING, reviewer: undefined }]
  const fix = [{ file: 'lib/shop/gap_source_planner.rb', start: 15, end: 22 }]
  expect(agentsOf(reviewersForRound(2, 3, REVIEWERS, unowned, fix))).toEqual(['reviewer', 'architect', 'auditor'])
})

const TASK_3_DIFF = [
  { file: 'lib/shop/gap_source_planner.rb', start: 12, end: 31 },
  { file: 'lib/shop/backfill/dashboard_client.rb', start: 1, end: 14 },
]

const UNTOUCHED_CALLERS = {
  reviewer: 'reviewer',
  file: 'lib/shop/backfill/runner.rb',
  line: 163,
  summary: 'Untouched callers still reach the singleton through .instance: runner.rb:163 calls DashboardClient.instance.holes.',
  root_cause: 'code-bug',
  blocking: true,
}

const PHASE_DIFFS = {
  '3': TASK_3_DIFF,
  '17': [{ file: 'lib/shop/month_bucket.rb', start: 1, end: 40 }],
}

test('a blocking finding inside its task diff blocks that task', () => {
  const finding = { ...SINGLETON_FINDING, task: '3' }
  expect(triagePhaseFindings([finding], PHASE_DIFFS)).toEqual({ blocking: [finding], followUps: [] })
})

test('a blocking finding that names no task is owned by the task whose diff holds its line', () => {
  const finding = { ...SINGLETON_FINDING, file: 'lib/shop/month_bucket.rb', line: 12 }
  expect(triagePhaseFindings([finding], PHASE_DIFFS).blocking).toEqual([{ ...finding, task: '17' }])
})

test('a blocking finding on code outside its task diff becomes a follow-up and blocks nothing', () => {
  const finding = { ...UNTOUCHED_CALLERS, task: '3' }
  expect(triagePhaseFindings([finding], PHASE_DIFFS)).toEqual({ blocking: [], followUps: [finding] })
})

test('a blocking finding without a file and line cannot be placed in a diff, so it is a follow-up', () => {
  const planDrift = { reviewer: 'auditor', summary: 'Plan Task 4 is stale: its Files list still says Create: spec/guards/dangerous_tasks_spec.rb.', blocking: true }
  expect(triagePhaseFindings([planDrift], PHASE_DIFFS)).toEqual({ blocking: [], followUps: [planDrift] })
})

test('a non-blocking finding is neither', () => {
  expect(triagePhaseFindings([{ ...UNTOUCHED_CALLERS, blocking: false }], PHASE_DIFFS)).toEqual({ blocking: [], followUps: [] })
})

test('phase follow-ups group by task, unowned ones under the phase', () => {
  const unowned = { reviewer: 'auditor', summary: 'Plan drift in Task 4.', blocking: true }
  expect(phaseFollowUps({ phase: 'P0', follow_ups: [{ ...UNTOUCHED_CALLERS, task: '3' }, unowned] }, 'P1')).toBe(
    followUpSection('P0', '3', [{ ...UNTOUCHED_CALLERS, task: '3' }], 'P1') + followUpSection('P0', 'P0', [unowned], 'P1'),
  )
})

test('follow-ups land in the plan as a task of the next phase, named after the phase that raised them', () => {
  expect(followUpSection('P0', '3', [UNTOUCHED_CALLERS], 'P1')).toBe(
    '\n### Task 3-P0-follow-ups: follow-ups raised while reviewing P0 task 3 (P1)\n' +
      '- [ ] Untouched callers still reach the singleton through .instance: runner.rb:163 calls DashboardClient.instance.holes. (lib/shop/backfill/runner.rb:163, raised by reviewer)\n',
  )
})

test('follow-ups of the last phase stay untagged for the next milestone', () => {
  expect(followUpSection('P2', '9', [UNTOUCHED_CALLERS], undefined)).toContain('### Task 9-P2-follow-ups: follow-ups raised while reviewing P2 task 9\n')
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

const P0_TASKS = [
  { id: '2', title: 'verify the backfill', touches: [] },
  { id: '3', title: 'DashboardGaps delegates', touches: ['lib/shop/gap_source_planner.rb', 'lib/shop/backfill/dashboard_client.rb'] },
  { id: '4', title: 'delete clean_unmonitored', touches: ['lib/tasks/db.rake', 'bin/clean_unmonitored'] },
  { id: '17', title: 'one month-range helper', touches: ['lib/shop/chain_builder.rb', 'lib/shop/gap_source_planner.rb', 'lib/shop/month_bucket.rb'] },
]

const idsOf = (waves: Array<Array<{ id: string }>>) => waves.map(wave => wave.map(task => task.id))

test('P0 tasks touching disjoint files share a wave; one that overlaps an earlier task waits for it', () => {
  expect(idsOf(taskWaves(P0_TASKS))).toEqual([['2', '3', '4'], ['17']])
})

test('a task that names no touched files runs alone, after everything before it', () => {
  const unknown = { id: '5', title: 'proto messages' }
  expect(idsOf(taskWaves([P0_TASKS[1]!, unknown, P0_TASKS[2]!]))).toEqual([['3'], ['5'], ['4']])
})

test('a chain of overlaps runs in plan order', () => {
  const tasks = [
    { id: 'a', title: 'a', touches: ['x.rb'] },
    { id: 'b', title: 'b', touches: ['x.rb', 'y.rb'] },
    { id: 'c', title: 'c', touches: ['y.rb'] },
  ]
  expect(idsOf(taskWaves(tasks))).toEqual([['a'], ['b'], ['c']])
})

test('every changed task the merge did not land is retried sequentially', () => {
  const entries = [
    { task: { id: '3', title: '' }, changed: true },
    { task: { id: '4', title: '' }, changed: true },
    { task: { id: '2', title: '' }, changed: false },
  ]
  expect(tasksToRetry(entries, { merged: ['3'], conflicted: ['4'] }).map(entry => entry.task.id)).toEqual(['4'])
  expect(tasksToRetry(entries, null).map(entry => entry.task.id)).toEqual(['3', '4'])
})

test('one line three reviewers flagged reaches the fix agent once', () => {
  const sameLine = ['reviewer', 'architect', 'auditor'].map(reviewer => ({ ...SINGLETON_FINDING, reviewer, task: '3' }))
  const other = { ...SINGLETON_FINDING, line: 27, reviewer: 'auditor', task: '3' }
  expect(distinctFindings([...sameLine, other])).toEqual([sameLine[0], other])
})

test('a lane glob overlaps the files and globs under it and nothing outside it', () => {
  expect(pathsOverlap('lib/**', 'lib/shop/a.rb')).toBe(true)
  expect(pathsOverlap('lib/shop/a.rb', 'lib/**')).toBe(true)
  expect(pathsOverlap('lib/**', 'lib/shop/**')).toBe(true)
  expect(pathsOverlap('lib/**', 'services/**')).toBe(false)
  expect(pathsOverlap('lib/**', 'spec/lib/a_spec.rb')).toBe(false)
  expect(pathsOverlap('lib/a.rb', '/repo/lib/a.rb')).toBe(true)
})

test('tasks owning different lanes share a wave, two tasks of one lane do not', () => {
  const ruby = (id: string) => ({ id, title: id, touches: ['lib/**', 'spec/**'] })
  const python = { id: 'p', title: 'p', touches: ['services/**'] }
  expect(idsOf(taskWaves([ruby('a'), python, ruby('b')]))).toEqual([['a', 'p'], ['b']])
})

test('an implementer that could not work is blocked, whatever it says about changes', () => {
  const refused = { changed: false, commits: [], hunks: [], evidence: 'BLOCKED: every Bash call refused, working-directory isolation context lost' }
  expect(isBlocked(refused)).toBe(true)
  expect(isBlocked({ ...VERIFICATION_ONLY, blocked: true })).toBe(true)
  expect(isBlocked({ ...CODE_CHANGE, evidence: 'Blocker: the test database is down' })).toBe(true)
  expect(isBlocked(null)).toBe(true)
})

test('a verification-only task or a real change is not blocked', () => {
  expect(isBlocked(VERIFICATION_ONLY)).toBe(false)
  expect(isBlocked(CODE_CHANGE)).toBe(false)
  expect(isBlocked({ ...CODE_CHANGE, evidence: 'removed the blocked_users scope' })).toBe(false)
  expect(isBlocked({ ...CODE_CHANGE, evidence: 'the guard spec checks a request is blocked' })).toBe(false)
})

const authored = (id: string, handoff: string) => ({ task: { id, title: id }, handoff })

test('a blocking finding goes to its own task\'s fixer with that implementer\'s handoff note, once per line', () => {
  const onThree = { ...SINGLETON_FINDING, task: '3' }
  const sameLineAgain = { ...onThree, reviewer: 'reviewer' }
  const three = authored('3', 'kept the proxy; run bundle exec rspec spec/shop/backfill')
  const seventeen = authored('17', 'month helper lives in month_bucket.rb')
  expect(fixRequests([three, seventeen], [onThree, sameLineAgain])).toEqual([{ entry: three, findings: [onThree], handoff: three.handoff }])
})

test('a task whose implementer left no handoff note still gets its fix, with an empty note', () => {
  const entry = { task: { id: '3', title: '3' } }
  expect(fixRequests([entry], [{ ...SINGLETON_FINDING, task: '3' }])[0]?.handoff).toBe('')
})

test('a suite failure blocks the task that broke it even outside that task\'s diff', () => {
  const brokenOldSpec = { reviewer: 'suite', source: 'suite' as const, task: '3', file: 'spec/shop/legacy_report_spec.rb', line: 40, summary: 'legacy report spec now fails: expected 3 rows, got 0', blocking: true }
  expect(triagePhaseFindings([brokenOldSpec], PHASE_DIFFS)).toEqual({ blocking: [brokenOldSpec], followUps: [] })
})

test('a suite failure that names no task of this phase is a follow-up, not a blocker nobody can fix', () => {
  const orphan = { reviewer: 'suite', source: 'suite' as const, file: 'spec/shop/flaky_spec.rb', line: 9, summary: 'order-dependent failure', blocking: true }
  expect(triagePhaseFindings([orphan], PHASE_DIFFS)).toEqual({ blocking: [], followUps: [orphan] })
})
