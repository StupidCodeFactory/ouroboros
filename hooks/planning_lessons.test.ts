import { expect, test } from 'claude-code/testing'

import { candidateRow, isPlanningSkill, withPlanningLessons } from './planning_lessons'

const PLANNING_SKILLS = ['acme:brainstorm', 'acme:plan-writer']

test('the configured planning skills match qualified or bare', () => {
  expect(isPlanningSkill(PLANNING_SKILLS, 'brainstorm')).toBe(true)
  expect(isPlanningSkill(PLANNING_SKILLS, 'acme:plan-writer')).toBe(true)
  expect(isPlanningSkill(PLANNING_SKILLS, 'commit')).toBe(false)
})

test('no configured planning skills means nothing is a planning skill', () => {
  expect(isPlanningSkill([], 'brainstorm')).toBe(false)
  expect(isPlanningSkill(undefined, 'brainstorm')).toBe(false)
})

test('lessons follow the skill text', () => {
  expect(withPlanningLessons('SKILL', 'LESSONS')).toBe('SKILL\n\n## Planning lessons (from past sessions)\n\nLESSONS')
})

test('a candidate row keeps the prompt on one line', () => {
  expect(candidateRow('2026-10-03', 'P2', 'first line\nsecond line')).toBe(
    '| 2026-10-03 | P2 | user | candidate | | first line second line | | candidate | |\n',
  )
})
