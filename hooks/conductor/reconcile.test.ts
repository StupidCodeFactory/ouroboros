import { expect, test } from 'claude-code/testing'

import { reconcilePending } from './reconcile'
import type { LoopState } from './state'

const PLAN = [
  '### Task 2: Verify dashboard holes by symbol, already on main (P0)',
  '- [x] Step 1: Verify on the milestone branch',
  '### Task 17: One month-range helper (P0)',
  '- [x] Step 7: commit',
  '### Task 5: New event messages and golden payloads (P1)',
  '- [ ] Step 1: write the failing golden spec',
].join('\n')

const STUCK_AT_KICKOFF: LoopState = {
  milestone: 'M1',
  phases: ['P0', 'P1'],
  current: null,
  status: 'kickoff',
  escalations: [],
  results: {},
  drafts: { spec: 'specs/2026-10-03-unified-ingestion-loop-design.md', plan: 'plans/2026-10-03-unified-ingestion-loop.md' },
  pending: { workflow: 'milestone-kickoff', args: { milestone: 'M1', goal: 'build the unified ingestion loop foundations' } },
}

const RAN_KICKOFF_AND_P0 = { briefPath: '.claude/ouroboros/briefs/M1.md', committedPhases: ['P0'], planText: PLAN }

test('a kickoff and a phase that already ran are dropped, and the first phase still open is offered', () => {
  const { state, dropped } = reconcilePending(STUCK_AT_KICKOFF, RAN_KICKOFF_AND_P0)

  expect(dropped).toEqual([
    'dropped milestone-kickoff: its brief exists at .claude/ouroboros/briefs/M1.md and every plan phase (P0, P1) already carries tasks',
    'dropped phase P0: a phase(P0) commit is on the branch and none of its plan boxes is open',
  ])
  expect(state).toMatchObject({ status: 'phase', current: 'P1', brief_path: '.claude/ouroboros/briefs/M1.md', pending: { workflow: 'phase', args: { milestone: 'M1', phase: 'P1' } } })
})

test('a recorded kickoff result proves the kickoff ran even without a brief file', () => {
  const recorded = { ...STUCK_AT_KICKOFF, results: { kickoff: '/tmp/tasks/wpsy5r9zt.output' } }
  const { dropped } = reconcilePending(recorded, { committedPhases: [], planText: PLAN })
  expect(dropped).toEqual(['dropped milestone-kickoff: its result was recorded at /tmp/tasks/wpsy5r9zt.output'])
})

test('a kickoff with no brief and no recorded result is still offered', () => {
  const { state, dropped } = reconcilePending(STUCK_AT_KICKOFF, { committedPhases: [], planText: PLAN })
  expect(dropped).toEqual([])
  expect(state).toEqual(STUCK_AT_KICKOFF)
})

test('a phase with its checkpoint commit but open boxes is still offered', () => {
  const p1 = { ...STUCK_AT_KICKOFF, status: 'phase' as const, current: 'P1', pending: { workflow: 'phase', args: { milestone: 'M1', phase: 'P1' } } }
  expect(reconcilePending(p1, { committedPhases: ['P0', 'P1'], planText: PLAN }).dropped).toEqual([])
})

test('when every phase ran, milestone exit is offered', () => {
  const done = PLAN.replace('- [ ] Step 1', '- [x] Step 1')
  const { state, dropped } = reconcilePending(STUCK_AT_KICKOFF, { ...RAN_KICKOFF_AND_P0, committedPhases: ['P0', 'P1'], planText: done })
  expect(dropped).toHaveLength(3)
  expect(state).toMatchObject({ status: 'exit', pending: { workflow: 'milestone-exit', args: { milestone: 'M1' } } })
})
