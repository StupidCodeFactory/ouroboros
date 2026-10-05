import { expect, test } from 'claude-code/testing'

import { sharedHostPorts, testDbsIn } from './test_resources'

const PARALLEL_ARGS = {
  milestones: [
    { milestone: 'M4', phase: 'P4', test_db: 'redis://127.0.0.1:6381/14 postgres://127.0.0.1:5434/app_m4_test' },
    { milestone: 'M5', phase: 'P7', test_db: 'redis://127.0.0.1:6381/15 postgres://127.0.0.1:5434/app_m5_test' },
  ],
}

test('every test_db in a launch is found, however deep the args nest it', () => {
  expect(testDbsIn(PARALLEL_ARGS)).toEqual([PARALLEL_ARGS.milestones[0]!.test_db, PARALLEL_ARGS.milestones[1]!.test_db])
  expect(testDbsIn({ phase: 'P1' })).toEqual([])
})

test('two runs on one host and port are reported, whatever database number each picked', () => {
  expect(sharedHostPorts(testDbsIn(PARALLEL_ARGS), [])).toEqual(['127.0.0.1:6381', '127.0.0.1:5434'])
})

test('a run whose servers no other run uses shares nothing', () => {
  expect(sharedHostPorts(['postgres://127.0.0.1:5434/a'], ['redis://127.0.0.1:6380/1'])).toEqual([])
})

test('a launch is checked against the test databases of runs already going in other worktrees', () => {
  expect(sharedHostPorts(['redis://127.0.0.1:6381/14'], ['redis://127.0.0.1:6381/15'])).toEqual(['127.0.0.1:6381'])
})
