import { expect, test } from 'claude-code/testing'

import { parseFindings } from './findings'
import { incidentLogPath } from './incident_log'

test('reads the fenced findings block', () => {
  const agentText = [
    'review done',
    '```json',
    '{"findings":[{"summary":"skipped the retry step","root_cause":"skill-misread","skill":"example-domain"}]}',
    '```',
  ].join('\n')

  expect(parseFindings(agentText)).toEqual([
    { summary: 'skipped the retry step', root_cause: 'skill-misread', skill: 'example-domain' },
  ])
})

test('returns nothing when the agent wrote no findings block', () => {
  expect(parseFindings('all good')).toEqual([])
})

test('a plugin-prefixed skill or agent is routed by its bare name', () => {
  const root = '/plugins/ouroboros'
  expect(incidentLogPath({ summary: 's', root_cause: 'skill-gap', skill: 'ouroboros:code-style' }, root)).toBe(`${root}/skills/code-style/incidents.md`)
  expect(incidentLogPath({ summary: 's', root_cause: 'skill-gap', skill: 'example-domain' }, root)).toBe('.claude/skills/example-domain/incidents.md')
  expect(incidentLogPath({ summary: 's', root_cause: 'agent-behaviour', agent: 'ouroboros:implementer' }, root)).toBe(`${root}/agents/incidents/implementer.md`)
})
