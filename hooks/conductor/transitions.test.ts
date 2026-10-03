import { expect, test } from 'claude-code/testing'

import type { LoopState } from './state'
import { mergeAccepted, nextAction } from './transitions'

const base: LoopState = { milestone: 'M1', phases: ['P0', 'P1'], current: 'P0', status: 'phase', escalations: [], results: {} }

const PLAN = ['### Task 1: a (P0)', '- [x] done', '### Task 2: b (P1)', '- [ ] open'].join('\n')

test('a finished kickoff launches the first phase', () => {
  const { state, launch } = nextAction({ ...base, current: null, status: 'kickoff' }, { type: 'kickoff-done', brief: 'go' })
  expect(state).toMatchObject({ status: 'phase', current: 'P0', brief: 'go' })
  expect(launch).toEqual({ workflow: 'phase', args: { milestone: 'M1', phase: 'P0', brief: 'go' } })
})

test('a finished kickoff with its brief filed passes the brief path, not the brief, to every phase', () => {
  const { state, launch } = nextAction({ ...base, current: null, status: 'kickoff' }, { type: 'kickoff-done', brief: 'a very long brief', brief_path: '/repo/.claude/ouroboros/briefs/M1.md' })
  expect(state).toMatchObject({ status: 'phase', current: 'P0', brief_path: '/repo/.claude/ouroboros/briefs/M1.md' })
  expect(state.brief).toBeUndefined()
  expect(launch).toEqual({ workflow: 'phase', args: { milestone: 'M1', phase: 'P0', brief_path: '/repo/.claude/ouroboros/briefs/M1.md' } })
})

test('a kickoff with a sliced brief passes the brief directory and each task\'s touches to the phase', () => {
  const slices = { common: 'Forbidden: .instance callers.', tasks: [{ id: '1', guidance: 'Put it in lib/a.rb.', touches: ['lib/a.rb'] }] }
  const { state, launch } = nextAction(
    { ...base, current: null, status: 'kickoff' },
    { type: 'kickoff-done', brief: '', slices, brief_dir: '/repo/.claude/ouroboros/briefs/M1' },
    PLAN.replace('- [x] done', '- [ ] open'),
  )
  expect(state).toMatchObject({ brief_dir: '/repo/.claude/ouroboros/briefs/M1', touches: { '1': ['lib/a.rb'] } })
  expect(launch?.args).toEqual({
    milestone: 'M1',
    phase: 'P0',
    brief_dir: '/repo/.claude/ouroboros/briefs/M1',
    tasks: [{ id: '1', title: 'a', line: 1, unchecked: 1, touches: ['lib/a.rb'] }],
  })
})

test('a task whose boxes are all ticked is never relaunched', () => {
  const plan = ['### Task 1: done already (P0)', '- [x] a', '### Task 2: still open (P0)', '- [x] a', '- [ ] b'].join('\n')
  const { launch } = nextAction({ ...base, current: null, status: 'kickoff' }, { type: 'kickoff-done', brief: '' }, plan)
  expect((launch?.args as { tasks: Array<{ id: string }> }).tasks.map(task => task.id)).toEqual(['2'])
})

test('a phase whose PR the architect left open escalates with the failing gate', () => {
  const { state } = nextAction({ ...base }, { type: 'phase-result', status: 'escalate', phase: 'P0', result_path: 'r0.json', failing_gate: 'CI red: rspec' })
  expect(state.escalations).toEqual([{ kind: 'task-red', phase: 'P0', summary: 'P0: CI red: rspec', result_path: 'r0.json' }])
})

test('each phase task carries its lane, so one phase run mixes ruby and python tasks', () => {
  const plan = ['### Task 7: Owners API (P0)', '- [ ] Step 1', '### Task 19: One Python contract test per service (P0)', '- [ ] Step 1'].join('\n')
  const touched = { ...base, current: null, status: 'kickoff' as const, brief_dir: '/b', touches: { '7': ['lib/shop/web/api.rb'], '19': ['services/parquet_writer/tests/test_events_contract.py'] } }
  const { launch } = nextAction(touched, { type: 'kickoff-done', brief: '' }, plan, { ruby: ['lib/**'], python: ['services/**'] })
  expect((launch?.args as { tasks: Array<{ id: string; lane?: string }> }).tasks.map(task => [task.id, task.lane])).toEqual([['7', 'ruby'], ['19', 'python']])
})

test('a lane-tagged task without brief touches is given its lane\'s owned paths, so the phase can still place it in a wave', () => {
  const plan = ['### Task 7: Owners API (P0, ruby)', '- [ ] Step 1', '### Task 19: contract test (P0, python)', '- [ ] Step 1'].join('\n')
  const { launch } = nextAction({ ...base, current: null, status: 'kickoff' as const, brief_dir: '/b' }, { type: 'kickoff-done', brief: '' }, plan, { ruby: ['lib/**'], python: ['services/**'] })
  expect((launch?.args as { tasks: Array<{ id: string; touches?: string[] }> }).tasks.map(task => [task.id, task.touches])).toEqual([['7', ['lib/**']], ['19', ['services/**']]])
})

test('an escalated phase still starts the retro, so its incidents never strand the implementers', () => {
  const { state, launch } = nextAction({ ...base }, { type: 'phase-result', status: 'escalate', phase: 'P0', result_path: 'r0.json' })
  expect(state.status).toBe('escalated')
  expect(launch?.workflow).toBe('retro')
})

test('a phase whose PR waits for the user holds the next phase until the merge', () => {
  const reported = nextAction({ ...base }, { type: 'phase-result', status: 'checkpointed', phase: 'P0', result_path: 'r0.json', pr_url: 'https://github.com/o/r/pull/841' })
  expect(reported.state).toMatchObject({ status: 'retro', awaiting_merge: { phase: 'P0', pr_url: 'https://github.com/o/r/pull/841' } })
  expect(reported.notify).toBe('M1 P0: pull request https://github.com/o/r/pull/841 is open for your review and merge')

  const afterRetro = nextAction(reported.state, { type: 'retro-done' }, PLAN)
  expect(afterRetro.launch).toBeUndefined()
  expect(afterRetro.state).toMatchObject({ status: 'phase', current: 'P1', pending: { workflow: 'phase', args: { phase: 'P1' } } })
  expect(afterRetro.notify).toBe('M1: merge https://github.com/o/r/pull/841 (P0), then /ouroboros resume starts P1 on a fresh branch')
})

test('a merged phase PR releases the held phase onto a fresh branch from the default branch', () => {
  const held = { ...base, current: 'P1', awaiting_merge: { phase: 'P0', pr_url: 'u' }, pending: { workflow: 'phase', args: { milestone: 'M1', phase: 'P1' } } }
  expect(mergeAccepted(held, 'milestone/')).toEqual({ ...base, current: 'P1', pending: { workflow: 'phase', args: { milestone: 'M1', phase: 'P1', fresh_branch: 'milestone/m1-p1' } } })
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

test('an escalating phase wakes the main session and launches only the retro', () => {
  const { state, launch, notify } = nextAction({ ...base }, { type: 'phase-result', status: 'escalate', phase: 'P0', result_path: 'r0.json' })
  expect(state.status).toBe('escalated')
  expect(state.escalations[0]).toMatchObject({ kind: 'task-red', phase: 'P0', result_path: 'r0.json' })
  expect(launch).toEqual({ workflow: 'retro', args: {} })
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

test('a phase launch carries the tasks the plan tags for it', () => {
  const { launch } = nextAction({ ...base, status: 'retro' }, { type: 'retro-done' }, PLAN)
  expect(launch?.args).toMatchObject({ phase: 'P1', tasks: [{ id: '2', title: 'b', unchecked: 1 }] })
})
