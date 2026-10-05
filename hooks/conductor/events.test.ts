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

const HEAD_IS_P1 = { head: { sha: '28284a7a1c', subject: 'phase(P1): event contract' }, phaseCommitFound: true, openTasks: [] }

test('a phase reported checkpointed without its phase commit on the branch escalates', () => {
  const reported = { type: 'phase-result' as const, status: 'checkpointed' as const, phase: 'P1', result_path: 'r1.json' }
  expect(verifiedCheckpoint(reported, { ...HEAD_IS_P1, phaseCommitFound: false })).toEqual({
    ...reported,
    status: 'escalate',
    failing_gate: 'the workflow reported checkpointed but no phase(P1) commit is on the branch',
  })
  expect(verifiedCheckpoint(reported, HEAD_IS_P1)).toEqual(reported)
  expect(verifiedCheckpoint({ type: 'retro-done' }, HEAD_IS_P1)).toEqual({ type: 'retro-done' })
})

test('a reported checkpoint sha must be HEAD with a phase subject, an older phase commit does not count', () => {
  const reported = { type: 'phase-result' as const, status: 'checkpointed' as const, phase: 'P1', result_path: 'r1.json', checkpoint_sha: '28284a7a' }
  expect(verifiedCheckpoint(reported, HEAD_IS_P1)).toEqual(reported)
  expect(verifiedCheckpoint(reported, { ...HEAD_IS_P1, head: { sha: '9f00aa11', subject: 'fix: remove duplicate golden test' } })).toMatchObject({
    status: 'escalate',
    failing_gate: 'the workflow reported checkpoint 28284a7a but HEAD is 9f00aa11 "fix: remove duplicate golden test"',
  })
  expect(verifiedCheckpoint(reported, { ...HEAD_IS_P1, head: { sha: '28284a7a1c', subject: 'feat: tick P1 boxes' } })).toMatchObject({ status: 'escalate' })
})

test('a checkpoint with open boxes in a task the phase ran escalates', () => {
  const reported = { type: 'phase-result' as const, status: 'checkpointed' as const, phase: 'P1', result_path: 'r1.json' }
  expect(verifiedCheckpoint(reported, { ...HEAD_IS_P1, openTasks: ['5', '7'] })).toMatchObject({
    status: 'escalate',
    failing_gate: 'the workflow reported checkpointed with open plan boxes in tasks 5, 7',
  })
})

test('the checkpoint sha travels with the phase result', () => {
  const json = { status: 'checkpointed', phase: 'P0', checkpoint_sha: 'abc123', tasks: [] }
  expect(loopEventOf('', 'r.json', { id: 'w1', workflow: 'phase' }, 'P0', json)).toMatchObject({ checkpoint_sha: 'abc123' })
})

test('an unmerged phase PR travels with the phase result', () => {
  const run = { id: 'w1', workflow: 'phase' }
  const json = { status: 'checkpointed', phase: 'P0', pr_url: 'https://github.com/o/r/pull/841', tasks: [] }
  expect(loopEventOf('', 'r.json', run, 'P0', json)).toEqual({ type: 'phase-result', status: 'checkpointed', phase: 'P0', result_path: 'r.json', pr_url: 'https://github.com/o/r/pull/841' })
})

test('a kickoff result that names an error is a failed kickoff', () => {
  const json = { brief: { common: '', tasks: [] }, decisions: [], checks: [], red: false, error: 'architect returned nothing' }
  expect(loopEventOf('', 'k.json', { id: 'k', workflow: 'milestone-kickoff' }, null, json)).toEqual({ type: 'kickoff-done', brief: '', failed: 'architect returned nothing' })
})

test('blocked tasks travel with a checkpointed phase result', () => {
  const json = { status: 'checkpointed', phase: 'P8', pr_url: 'https://github.com/o/r/pull/860', blocked_tasks: [{ id: '88', reason: 'needs the drive key' }], tasks: [] }
  expect(loopEventOf('', 'r.json', { id: 'w', workflow: 'phase' }, 'P8', json)).toMatchObject({ blocked: ['88: needs the drive key'] })
})

test('a blocked task listed on the PR does not count as an open box at the checkpoint', () => {
  const reported = { type: 'phase-result' as const, status: 'checkpointed' as const, phase: 'P8', result_path: 'r.json', blocked: ['88: needs the drive key'] }
  expect(verifiedCheckpoint(reported, { ...HEAD_IS_P1, openTasks: [] })).toEqual(reported)
})
