import { expect, test } from 'claude-code/testing'

import { eagerSkillNames, frontmatterSkills, laneOf } from './config'

const config = {
  agents: {
    implementer: {
      eager_skills: ['caveman:ultra', 'code-style'],
      lanes: { ruby: { eager_skills: ['ruby-spec-conventions', 'code-style'] } },
    },
  },
}

test('merges defaults, agent and lane in order without duplicates', () => {
  expect(eagerSkillNames(['phase-pr-workflow'], config, 'implementer', 'ruby')).toEqual([
    { name: 'phase-pr-workflow' },
    { name: 'caveman', level: 'ultra' },
    { name: 'code-style' },
    { name: 'ruby-spec-conventions' },
  ])
})

test('an agent without config keeps its defaults', () => {
  expect(eagerSkillNames(['adr-format'], {}, 'adr-scribe', undefined)).toEqual([{ name: 'adr-format' }])
})

test('reads the skills list from agent frontmatter', () => {
  expect(frontmatterSkills('---\nname: x\nskills: [caveman:ultra, code-style]\n---\nBody')).toEqual(['caveman:ultra', 'code-style'])
  expect(frontmatterSkills('---\nname: x\n---\nBody')).toEqual([])
})

test('the lane is the first word of the prompt after Lane', () => {
  expect(laneOf('Lane ruby. Milestone M1 P2, task t1: do it.')).toBe('ruby')
  expect(laneOf('review the diff')).toBe(undefined)
})
