import { expect, test } from 'claude-code/testing'

import { architectResult, kickoffAnswer, kickoffIssueNumber, kickoffRecord, milestoneColumn, prdSection } from './kickoff_issue'

const PRD = [
  '# Product',
  'Intro.',
  '## Milestones',
  '### M1. Kickoff on GitHub',
  'Goal: plan a milestone.',
  '#### Detail',
  'More.',
  '### M2. Sub-issues run one at a time',
  'Goal: run them.',
  '## Appendix',
].join('\n')

const TASK = {
  title: 'Page list',
  goal: 'g',
  plan: 'p\nFiles: `app/**`',
  checklist: [{ text: 'the list shows', command: 'bin/rspec spec/a_spec.rb' }],
  completion: ['bin/rspec'],
  stop: 's',
  must_not: 'm',
  depends_on: [{ issue: 10 }, { task: 2 }],
}

test('the kickoff argument is an issue number, a #number or an issue URL', () => {
  expect(kickoffIssueNumber('167')).toBe(167)
  expect(kickoffIssueNumber('#167')).toBe(167)
  expect(kickoffIssueNumber('https://github.com/acme/shop/issues/167')).toBe(167)
  expect(kickoffIssueNumber('M1')).toBe(undefined)
  expect(kickoffIssueNumber('')).toBe(undefined)
})

test('the PRD section is the text under the heading matching the issue title, up to the next heading as high', () => {
  expect(prdSection(PRD, 'M1. Kickoff on GitHub')).toEqual({ section: 'Goal: plan a milestone.\n#### Detail\nMore.' })
  expect(prdSection(PRD, 'M2. Sub-issues run one at a time')).toEqual({ section: 'Goal: run them.' })
  expect(prdSection(PRD, 'M9. Nowhere')).toEqual({
    headings: ['Product', 'Milestones', 'M1. Kickoff on GitHub', 'Detail', 'M2. Sub-issues run one at a time', 'Appendix'],
  })
})

test('the milestone column is the issue\'s status on the configured project', () => {
  const items = [
    { title: 'Other', status: { name: 'Todo' } },
    { title: 'Shop board', status: { name: 'Milestones' } },
  ]
  expect(milestoneColumn(items, 'Shop board')).toBe('Milestones')
  expect(milestoneColumn(items, 'Missing board')).toBe(undefined)
  expect(milestoneColumn([{ title: 'Shop board' }], 'Shop board')).toBe(undefined)
})

test('the architect result reads into a milestone body and planned tasks, nothing ticked', () => {
  const json = {
    milestone: { goal: 'G', brief: 'B', acceptance: [{ text: 'all green', command: './scripts/pre-push' }] },
    tasks: [{ ...TASK, issue: 12 }, { ...TASK, title: 'Search' }],
  }

  expect(architectResult(json)).toEqual({
    milestone: { goal: 'G', brief: 'B', acceptance: [{ text: 'all green', command: './scripts/pre-push', done: false }] },
    tasks: [
      { ...TASK, issue: 12, checklist: [{ text: 'the list shows', command: 'bin/rspec spec/a_spec.rb', done: false }] },
      { ...TASK, title: 'Search', checklist: [{ text: 'the list shows', command: 'bin/rspec spec/a_spec.rb', done: false }] },
    ],
  })
})

test('an architect result without a milestone or tasks is an error', () => {
  expect(architectResult(undefined)).toEqual({ error: 'the architect returned no milestone body and task list' })
  expect(architectResult({ tasks: [] })).toEqual({ error: 'the architect returned no milestone body and task list' })
})

test('the kickoff record holds the start and the planned tasks, by issue when they revise one', () => {
  expect(kickoffRecord(Date.UTC(2026, 9, 11, 12), [{ ...TASK, issue: 12 }, { ...TASK, title: 'Search' }] as never)).toEqual({
    started_at: '2026-10-11T12:00:00.000Z',
    planned: [{ issue: 12, title: 'Page list' }, { title: 'Search' }],
  })
})

test('the kickoff answer names every sub-issue by what happened to it', () => {
  const applied = { created: [21, 22], updated: [12], dropped: [13], unchanged: [], closed: [10] }

  expect(kickoffAnswer(3, applied)).toBe('kickoff #3: created #21, #22; updated #12; dropped #13; unchanged none; left closed #10')
})
