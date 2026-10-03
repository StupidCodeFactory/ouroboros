import { expect, test } from 'claude-code/testing'

import { eagerSkillNames, laneOf } from './config'

const config = {
  agents: {
    implementer: {
      eager_skills: ['terse:ultra', 'code-style'],
      lanes: { ruby: { eager_skills: ['ruby-spec-conventions', 'code-style'] } },
    },
  },
}

test('a configured agent loads its list then its lane list without duplicates', () => {
  expect(eagerSkillNames(config, 'implementer', 'ruby')).toEqual([
    { name: 'terse', level: 'ultra' },
    { name: 'code-style' },
    { name: 'ruby-spec-conventions' },
  ])
})

test('an agent the project lists nothing for falls back to the ouroboros process skills', () => {
  expect(eagerSkillNames({}, 'adr-scribe', undefined)).toEqual([{ name: 'checkbox-progress' }, { name: 'adr-format' }])
  expect(eagerSkillNames({ agents: { implementer: { lanes: {} } } }, 'implementer', 'ruby')).toEqual([
    { name: 'checkbox-progress' },
    { name: 'code-style' },
    { name: 'phase-pr-workflow' },
  ])
  expect(eagerSkillNames({}, 'skill-curator', undefined)).toEqual([])
})

test('the lane is the first word of the prompt after Lane', () => {
  expect(laneOf('Lane ruby. Milestone M1 P2, task t1: do it.')).toBe('ruby')
  expect(laneOf('review the diff')).toBe(undefined)
})
