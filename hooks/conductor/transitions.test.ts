import { expect, test } from 'claude-code/testing'

import type { LoopState } from './state'
import { nextAction } from './transitions'

const base: LoopState = { milestone: 'M1', phases: ['P0', 'P1'], current: 'P0', status: 'phase', escalations: [], results: {} }

const PLAN = ['### Task 1: a (P0)', '- [x] done', '### Task 2: b (P1)', '- [ ] open'].join('\n')

test('a finished kickoff launches the first phase', () => {
  const { state, launch } = nextAction({ ...base, current: null, status: 'kickoff' }, { type: 'kickoff-done', brief: 'go' })
  expect(state).toMatchObject({ status: 'phase', current: 'P0', brief: 'go' })
  expect(launch).toEqual({ workflow: 'phase', args: { milestone: 'M1', phase: 'P0', brief: 'go' } })
})

test('a checkpointed phase starts the retro', () => {
  const { state, launch } = nextAction({ ...base }, { type: 'phase-result', status: 'checkpointed', phase: 'P0', result_path: 'r0.json' })
  expect(state.status).toBe('retro')
  expect(state.results).toEqual({ P0: 'r0.json' })
  expect(launch?.workflow).toBe('retro')
})

test('a finished retro launches the next phase', () => {
  const { state, launch } = nextAction({ ...base, status: 'retro' }, { type: 'retro-done' })
  expect(state.current).toBe('P1')
  expect(launch?.workflow).toBe('phase')
})

test('a finished retro launches the first phase the plan still has open', () => {
  const { state } = nextAction({ ...base, status: 'retro' }, { type: 'retro-done' }, PLAN)
  expect(state.current).toBe('P1')
  const again = nextAction({ ...base, current: 'P1', status: 'retro' }, { type: 'retro-done' }, PLAN)
  expect(again.state.current).toBe('P1')
  expect(again.launch?.workflow).toBe('phase')
})

test('a finished retro after the last phase launches the exit', () => {
  const { state, launch } = nextAction({ ...base, current: 'P1', status: 'retro' }, { type: 'retro-done' })
  expect(launch?.workflow).toBe('milestone-exit')
  expect(state.status).toBe('exit')
})

test('an escalating phase wakes the main session and launches nothing', () => {
  const { state, launch, notify } = nextAction({ ...base }, { type: 'phase-result', status: 'escalate', phase: 'P0', result_path: 'r0.json' })
  expect(state.status).toBe('escalated')
  expect(state.escalations[0]).toMatchObject({ kind: 'task-red', phase: 'P0', result_path: 'r0.json' })
  expect(launch).toBeUndefined()
  expect(notify).toContain('r0.json')
})

test('a refused merge escalates', () => {
  const { state, notify } = nextAction({ ...base, current: 'P1', status: 'exit' }, { type: 'exit-result', merged: false, failing_gate: 'R1 red' })
  expect(state.escalations[0]?.kind).toBe('gate-refused')
  expect(notify).toContain('R1 red')
})

test('a merged exit idles and reports', () => {
  const { state, launch, notify } = nextAction({ ...base, current: 'P1', status: 'exit' }, { type: 'exit-result', merged: true })
  expect(state.status).toBe('idle')
  expect(launch).toBeUndefined()
  expect(notify).toContain('M1')
})

test('a paused loop queues the launch instead of performing it', () => {
  const { state, launch } = nextAction({ ...base, status: 'retro', paused: true }, { type: 'retro-done' })
  expect(launch).toBeUndefined()
  expect(state.pending?.workflow).toBe('phase')
  expect(state).toMatchObject({ status: 'phase', current: 'P1', paused: true })
})

test('an event for another status changes nothing', () => {
  const { state, launch } = nextAction({ ...base }, { type: 'retro-done' })
  expect(state).toEqual(base)
  expect(launch).toBeUndefined()
})
