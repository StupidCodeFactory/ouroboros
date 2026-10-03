import { expect, test } from 'claude-code/testing'

import { adrScribePrompt, isDraftPath, parseDecisions, planDriftRow } from './adr'

test('spec and plan drafts are drafts', () => {
  expect(isDraftPath('docs/superpowers/specs/x.md')).toBe(true)
  expect(isDraftPath('docs/superpowers/plans/x.md')).toBe(true)
  expect(isDraftPath('/home/me/project/docs/superpowers/plans/x.md')).toBe(true)
  expect(isDraftPath('docs/adr/0001-x.md')).toBe(false)
})

test('reads the architect decisions block', () => {
  const architectText = '```json\n{"decisions":[{"title":"t","context":"c","decision":"d","alternatives":"a","consequences":"q"}]}\n```'
  expect(parseDecisions(architectText)).toEqual([
    { title: 't', context: 'c', decision: 'd', alternatives: 'a', consequences: 'q' },
  ])
})

test('no decisions block means no decisions', () => {
  expect(parseDecisions('brief without a block')).toEqual([])
})

test('the scribe prompt carries the instruction and the decisions', () => {
  const decisions = [{ title: 't', context: 'c', decision: 'd', alternatives: 'a', consequences: 'q' }]
  expect(adrScribePrompt('open Proposed ADRs', decisions)).toBe(
    'open Proposed ADRs\n\n```json\n' + JSON.stringify({ decisions }) + '\n```',
  )
})

test('a plan-drift row names the draft', () => {
  expect(planDriftRow('2026-10-03', 'P2', 'docs/superpowers/plans/x.md')).toBe(
    '| 2026-10-03 | P2 | main | plan-drift | | draft edited after kickoff | docs/superpowers/plans/x.md | open | |\n',
  )
})
