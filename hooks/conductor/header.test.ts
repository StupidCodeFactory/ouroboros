import { expect, test } from 'claude-code/testing'

import type { LoopState } from './state'
import { escalationsText, loopHeader, statusReport } from './header'

const state: LoopState = {
  milestone: 'M1', phases: ['P0', 'P1'], current: 'P1', status: 'escalated', results: { P0: 'r0.json' },
  escalations: [{ kind: 'task-red', phase: 'P1', summary: 'task 3 red after 3 rounds', result_path: 'r1.json' }],
  drafts: { spec: 'specs/m1.md', plan: 'plans/m1.md' },
}

test('the loop header is three lines', () => {
  const lines = loopHeader(state).split('\n')
  expect(lines).toHaveLength(3)
  expect(lines[0]).toContain('M1')
  expect(lines[0]).toContain('P1')
  expect(lines[1]).toContain('1 open')
  expect(lines[2]).toContain('plans/m1.md')
})

test('escalations list one line each with the result path', () => {
  expect(escalationsText(state)).toBe('task-red P1: task 3 red after 3 rounds (r1.json)')
  expect(escalationsText({ ...state, escalations: [] })).toBe('no escalations')
})

test('status reads as tables: phases with their state, then the loop, then escalations', () => {
  expect(statusReport(state)).toBe(
    [
      'ouroboros · M1 · escalated',
      '',
      'phase  state',
      '-----  ---------',
      'P0     done',
      'P1     escalated',
      '',
      'in flight       nothing',
      'pending launch  none',
      'plan            plans/m1.md',
      '',
      'escalation  phase  summary                    result',
      '----------  -----  -------------------------  -------',
      'task-red    P1     task 3 red after 3 rounds  r1.json',
    ].join('\n'),
  )
})

test('a pending phase launch shows the phase and how to start it, never its args', () => {
  const pending = { ...state, status: 'phase' as const, escalations: [], pending: { workflow: 'phase', args: { phase: 'P1', tasks: [{ id: '5' }], brief_dir: '/b' } } }
  const report = statusReport(pending)
  expect(report).toContain('pending launch  phase P1 (run /ouroboros resume)')
  expect(report).not.toContain('{')
  expect(report).not.toContain('escalation  phase')
})

test('before any phase runs every phase is queued', () => {
  expect(statusReport({ ...state, current: null, status: 'kickoff', escalations: [], results: {} })).toContain('P0     queued\nP1     queued')
})
