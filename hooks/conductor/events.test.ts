import { expect, test } from 'claude-code/testing'

import { loopEventOf, isLoopNotification, verifiedCheckpoint } from './events'

const PHASE_RUN = { id: 'wf-1', workflow: 'phase' }

test('a notification is the loop\'s only when it names the in-flight run id', () => {
  expect(isLoopNotification('Task wf-1 completed', PHASE_RUN)).toBe(true)
  expect(isLoopNotification('<task-id>wf-1</task-id>', PHASE_RUN)).toBe(true)
  expect(isLoopNotification('Workflow ouroboros:phase finished', PHASE_RUN)).toBe(false)
  expect(isLoopNotification('Agent "fix the phase checkpoint" finished', PHASE_RUN)).toBe(false)
  expect(isLoopNotification('Task wf-10 completed', PHASE_RUN)).toBe(false)
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

test('a phase reported checkpointed without its phase commit on the branch escalates', () => {
  const reported = { type: 'phase-result' as const, status: 'checkpointed' as const, phase: 'P1', result_path: 'r1.json' }
  expect(verifiedCheckpoint(reported, false)).toEqual({
    ...reported,
    status: 'escalate',
    failing_gate: 'the workflow reported checkpointed but no phase(P1) commit is on the branch',
  })
  expect(verifiedCheckpoint(reported, true)).toEqual(reported)
  expect(verifiedCheckpoint({ type: 'retro-done' }, false)).toEqual({ type: 'retro-done' })
})

test('an unmerged phase PR travels with the phase result', () => {
  const run = { id: 'w1', workflow: 'phase' }
  const json = { status: 'checkpointed', phase: 'P0', pr_url: 'https://github.com/o/r/pull/841', tasks: [] }
  expect(loopEventOf('', 'r.json', run, 'P0', json)).toEqual({ type: 'phase-result', status: 'checkpointed', phase: 'P0', result_path: 'r.json', pr_url: 'https://github.com/o/r/pull/841' })
})
