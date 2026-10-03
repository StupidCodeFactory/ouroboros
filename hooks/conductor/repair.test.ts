import { expect, test } from 'claude-code/testing'

import { adoptRun, positionLine, setPosition } from './repair'
import type { LoopState } from './state'

const STUCK_AT_KICKOFF: LoopState = {
  milestone: 'M1',
  phases: ['P0', 'P1'],
  current: null,
  status: 'kickoff',
  escalations: [],
  results: {},
  pending: { workflow: 'milestone-kickoff', args: { milestone: 'M1' } },
}

test('adopting the hand-launched P1 run records it in flight, as the hand repair did', () => {
  const adopted = adoptRun(STUCK_AT_KICKOFF, 'wr4z11mqu', 'ouroboros:phase', 'P1')
  expect(adopted).toEqual({ state: { ...STUCK_AT_KICKOFF, status: 'phase', current: 'P1', run: { id: 'wr4z11mqu', workflow: 'phase' } } })
})

test('adopting a run of the pending workflow clears that pending launch', () => {
  const adopted = adoptRun(STUCK_AT_KICKOFF, 'wpsy5r9zt', 'milestone-kickoff')
  expect(adopted).toEqual({ state: { ...STUCK_AT_KICKOFF, run: { id: 'wpsy5r9zt', workflow: 'milestone-kickoff' }, pending: undefined } })
})

test('adopt refuses what it cannot record', () => {
  expect(adoptRun(STUCK_AT_KICKOFF, '', 'phase', 'P1')).toEqual({ error: 'usage: /ouroboros adopt <task-id> <workflow> [phase]' })
  expect(adoptRun(STUCK_AT_KICKOFF, 'w1', 'review-changes')).toEqual({ error: 'unknown workflow review-changes: one of milestone-kickoff, phase, retro, milestone-exit' })
  expect(adoptRun(STUCK_AT_KICKOFF, 'w1', 'phase')).toEqual({ error: 'adopting a phase run needs its phase: one of P0, P1' })
  expect(adoptRun(STUCK_AT_KICKOFF, 'w1', 'phase', 'P7')).toEqual({ error: 'unknown phase P7: one of P0, P1' })
  expect(adoptRun({ ...STUCK_AT_KICKOFF, milestone: '' }, 'w1', 'phase', 'P1')).toEqual({ error: 'no milestone in state.json: run /ouroboros kickoff first' })
})

test('set moves the phase or the status, and refuses anything else', () => {
  expect(setPosition(STUCK_AT_KICKOFF, 'phase', 'P1')).toEqual({ state: { ...STUCK_AT_KICKOFF, current: 'P1' } })
  expect(setPosition(STUCK_AT_KICKOFF, 'status', 'phase')).toEqual({ state: { ...STUCK_AT_KICKOFF, status: 'phase' } })
  expect(setPosition(STUCK_AT_KICKOFF, 'phase', 'P9')).toEqual({ error: 'unknown phase P9: one of P0, P1' })
  expect(setPosition(STUCK_AT_KICKOFF, 'status', 'done')).toEqual({ error: 'unknown status done: one of idle, kickoff, phase, retro, exit, paused, escalated' })
  expect(setPosition(STUCK_AT_KICKOFF, 'run', 'x')).toEqual({ error: 'usage: /ouroboros set phase <PN> | set status <status>' })
})

test('the position line names milestone, phase, status, run in flight and pending launch', () => {
  expect(positionLine(STUCK_AT_KICKOFF)).toBe('M1 · phase - · kickoff · in flight nothing · pending milestone-kickoff')
  expect(positionLine({ ...STUCK_AT_KICKOFF, status: 'phase', current: 'P1', run: { id: 'wr4z11mqu', workflow: 'phase' }, pending: undefined })).toBe(
    'M1 · phase P1 · phase · in flight phase (wr4z11mqu) · pending none',
  )
})
