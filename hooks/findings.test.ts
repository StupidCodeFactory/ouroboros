import { expect, test } from 'claude-code/testing'

import { parseFindings } from './findings'

test('reads the fenced findings block', () => {
  const agentText = [
    'review done',
    '```json',
    '{"findings":[{"summary":"slept in drain","root_cause":"skill-misread","skill":"queue-unit-kinds"}]}',
    '```',
  ].join('\n')

  expect(parseFindings(agentText)).toEqual([
    { summary: 'slept in drain', root_cause: 'skill-misread', skill: 'queue-unit-kinds' },
  ])
})

test('returns nothing when the agent wrote no findings block', () => {
  expect(parseFindings('all good')).toEqual([])
})
