import { expect, test } from 'claude-code/testing'

import { PLANNING_SKILLS, candidateRow, isPlanningSkill, withPlanningLessons } from './planning_lessons'

test('planning skills are brainstorming and writing-plans', () => {
  expect([...PLANNING_SKILLS]).toEqual(['superpowers:brainstorming', 'superpowers:writing-plans'])
})

test('a bare skill name matches too', () => {
  expect(isPlanningSkill('brainstorming')).toBe(true)
  expect(isPlanningSkill('superpowers:writing-plans')).toBe(true)
  expect(isPlanningSkill('commit')).toBe(false)
})

test('lessons follow the skill text', () => {
  expect(withPlanningLessons('SKILL', 'LESSONS')).toBe('SKILL\n\n## Planning lessons (from past sessions)\n\nLESSONS')
})

test('a candidate row keeps the prompt on one line', () => {
  expect(candidateRow('2026-10-03', 'P2', 'first line\nsecond line')).toBe(
    '| 2026-10-03 | P2 | user | candidate | | first line second line | | candidate | |\n',
  )
})
