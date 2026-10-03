import { expect, test } from 'claude-code/testing'

import { IDLE_STATE, kickoffState, parseState } from './state'

test('missing or partial state parses to the idle defaults', () => {
  expect(parseState(undefined)).toEqual(IDLE_STATE)
  expect(parseState('{"drafts":{"spec":"s","plan":"p"}}')).toMatchObject({ ...IDLE_STATE, drafts: { spec: 's', plan: 'p' } })
})

test('a kickoff state derives its phases from the plan tags', () => {
  const plan = '### Task 1: a (P2)\n### Task 2: b (P1)\n### Task 3: c (P2)'
  expect(kickoffState('M1', { spec: 's', plan: 'p' }, plan)).toMatchObject({ milestone: 'M1', phases: ['P1', 'P2'], status: 'kickoff', current: null })
  expect(kickoffState('M1', { spec: 's', plan: 'p' }, '### Task 1: a').phases).toEqual(['P0'])
})
