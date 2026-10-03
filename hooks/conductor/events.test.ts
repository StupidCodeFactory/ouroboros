import { expect, test } from 'claude-code/testing'

import { loopEventOf, isLoopNotification } from './events'

const PHASE_RUN = { id: 'wf-1', workflow: 'phase' }

test('a notification is the loop\'s when it names the in-flight run or workflow', () => {
  expect(isLoopNotification('Task wf-1 completed', PHASE_RUN)).toBe(true)
  expect(isLoopNotification('Workflow ouroboros:phase finished', PHASE_RUN)).toBe(true)
  expect(isLoopNotification('Agent researcher finished', PHASE_RUN)).toBe(false)
  expect(isLoopNotification('anything', undefined)).toBe(false)
})

test('a phase result is read from the embedded JSON', () => {
  const text = 'Workflow phase completed:\n{"status":"checkpointed","tasks":[],"evidence":"ok"}'
  expect(loopEventOf(text, 'r.json', PHASE_RUN, 'P2')).toEqual({ type: 'phase-result', status: 'checkpointed', phase: 'P2', result_path: 'r.json' })
})

test('a phase result without readable JSON escalates', () => {
  expect(loopEventOf('Workflow phase failed', 'r.json', PHASE_RUN, 'P2')).toMatchObject({ type: 'phase-result', status: 'escalate' })
})

test('kickoff, retro and exit results map to their events', () => {
  expect(loopEventOf('{"brief":"do it","decisions":[]}', 'k.json', { id: 'k', workflow: 'milestone-kickoff' }, null)).toEqual({ type: 'kickoff-done', brief: 'do it' })
  expect(loopEventOf('fixed 2', 'c.json', { id: 'c', workflow: 'retro' }, 'P1')).toEqual({ type: 'retro-done' })
  expect(loopEventOf('{"merged":false,"failing_gate":"R1"}', 'e.json', { id: 'e', workflow: 'milestone-exit' }, 'P1')).toEqual({ type: 'exit-result', merged: false, failing_gate: 'R1' })
  expect(loopEventOf('{"merged":true}', 'e.json', { id: 'e', workflow: 'milestone-exit' }, 'P1')).toEqual({ type: 'exit-result', merged: true })
})
