import { expect, test } from 'claude-code/testing'

import { parseFindings } from './findings'

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
