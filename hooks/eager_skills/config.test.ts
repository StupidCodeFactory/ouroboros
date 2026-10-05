import { expect, test } from 'claude-code/testing'

import { eagerSkillNames, laneEnvNotes, laneOf } from './config'

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

const LANE_NOTES = {
  lanes: {
    ruby: { env_notes: ['DATABASE_URL=postgres://127.0.0.1:5434/app_test', 'run rspec as `rtk proxy bundle exec rspec`'] },
    python: { env_notes: ['use the service venv: `uv run pytest`'] },
  },
}

test('an implementer seat gets its own lane\'s test environment notes, the auditor every lane\'s', () => {
  expect(laneEnvNotes(LANE_NOTES, { role: 'implementer', lane: 'ruby' })).toBe(
    '\n## Test environment: ruby lane\n- DATABASE_URL=postgres://127.0.0.1:5434/app_test\n- run rspec as `rtk proxy bundle exec rspec`\n',
  )
  expect(laneEnvNotes(LANE_NOTES, { role: 'auditor', lane: undefined })).toContain('## Test environment: python lane')
  expect(laneEnvNotes(LANE_NOTES, { role: 'reviewer', lane: undefined })).toBe('')
  expect(laneEnvNotes({}, { role: 'implementer', lane: 'ruby' })).toBe('')
})
