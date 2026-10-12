import { expect, test } from 'claude-code/testing'

import { renderTaskBody } from './github/contract'
import { branchName, nextSubIssue, readinessComment, reviewOutcome } from './loop'
import type { BoardSubIssue } from './loop'

const COLUMNS = { milestones: 'Milestones', planned: 'Planned', in_progress: 'In Progress', qa: 'QA', done: 'Done' }

const TASK = {
  goal: 'Owners see their Page.',
  plan: '1. Red.\n2. Green.\nFiles: `app/**`',
  checklist: [
    { text: 'the list shows the Page', command: 'bin/rspec spec/a_spec.rb', done: false },
    { text: 'an empty list says so', command: 'bin/rspec spec/b_spec.rb', done: false },
  ],
  depends_on: [],
}

const subIssue = (number: number, column: string | undefined, extra: Partial<BoardSubIssue> = {}): BoardSubIssue => ({
  number,
  state: 'open',
  title: `task ${number}`,
  body: renderTaskBody(TASK),
  column,
  labels: [],
  ...extra,
})

const dependingOn = (...numbers: number[]) => renderTaskBody({ ...TASK, depends_on: numbers })

test('the next sub-issue is the lowest-numbered planned one whose dependencies are done or closed', () => {
  const subIssues = [
    subIssue(14, 'Planned'),
    subIssue(12, 'Planned', { body: dependingOn(11) }),
    subIssue(11, 'Done'),
    subIssue(13, 'Planned', { body: dependingOn(15) }),
    subIssue(15, undefined),
    subIssue(10, undefined, { state: 'closed' }),
  ]

  expect(nextSubIssue(subIssues, COLUMNS)).toEqual({ issue: subIssues[1] })
})

test('nextSubIssue prefers an open In Progress or QA sub-issue over Planned', () => {
  const subIssues = [subIssue(10, 'Planned'), subIssue(13, 'In Progress'), subIssue(12, 'QA'), subIssue(11, 'QA', { state: 'closed' })]

  expect(nextSubIssue(subIssues, COLUMNS)).toEqual({ issue: subIssues[2] })
})

test('a closed dependency counts as met', () => {
  const subIssues = [subIssue(12, 'Planned', { body: dependingOn(10) }), subIssue(10, undefined, { state: 'closed' })]

  expect(nextSubIssue(subIssues, COLUMNS)).toEqual({ issue: subIssues[0] })
})

test('with nothing ready, the answer names each waiting sub-issue and its blockers', () => {
  const subIssues = [subIssue(12, 'Planned', { body: dependingOn(15) }), subIssue(15, undefined), subIssue(11, 'Done')]

  expect(nextSubIssue(subIssues, COLUMNS)).toEqual({ none: 'no sub-issue is ready: #12 waits on #15' })
})

test('with every sub-issue done or closed, the milestone is finished', () => {
  expect(nextSubIssue([subIssue(11, 'Done'), subIssue(10, undefined, { state: 'closed' })], COLUMNS)).toEqual({ finished: true })
})

test('a sub-issue with a body that does not parse waits on its blockers by its unreadable body', () => {
  const subIssues = [subIssue(12, 'Planned', { body: 'free text' })]

  expect(nextSubIssue(subIssues, COLUMNS)).toEqual({ issue: subIssues[0] })
})

test('the readiness comment names every missing section, or nothing when the sub-issue is ready', () => {
  expect(readinessComment(renderTaskBody(TASK))).toBeUndefined()
  expect(readinessComment('## Goal\ng\n')).toBe(
    '## Ouroboros needs the owner\nThis sub-issue cannot start: Plan, Checklist, Depends on are missing or incomplete. Every section must be present, the plan must end in a `Files:` line, and every checklist item must name a command. Fix the body, remove the `needs-owner` label and run `/ouroboros start` again.',
  )
})

test('a task branch is the prefix, the number and the title slug cut to 50 characters', () => {
  expect(branchName('work/', 18, 'Refactor: GitHub IO out of the conductor!')).toBe('work/18-refactor-github-io-out-of-the-conductor')
  expect(branchName('work/', 7, 'x'.repeat(80))).toBe(`work/7-${'x'.repeat(50)}`)
})

test('a review that passes every item with no defects ticks them all and is accepted', () => {
  const outcome = reviewOutcome(renderTaskBody(TASK), {
    items: [
      { index: 1, pass: true, evidence: '1 example, 0 failures' },
      { index: 2, pass: true, evidence: '1 example, 0 failures' },
    ],
    defects: [],
  })

  expect(outcome.accepted).toBe(true)
  expect(outcome.body).toContain('- [x] the list shows the Page: `bin/rspec spec/a_spec.rb`')
  expect(outcome.body).toContain('- [x] an empty list says so: `bin/rspec spec/b_spec.rb`')
})

test('a review ticks only the items that passed and lists failures and defects in its comment', () => {
  const outcome = reviewOutcome(renderTaskBody({ ...TASK, checklist: TASK.checklist.map(item => ({ ...item, done: true })) }), {
    items: [{ index: 1, pass: true, evidence: 'ok' }, { index: 2, pass: false, evidence: 'expected "empty", got ""' }],
    defects: ['the empty state is not translated'],
  })

  expect(outcome.accepted).toBe(false)
  expect(outcome.body).toContain('- [x] the list shows the Page')
  expect(outcome.body).toContain('- [ ] an empty list says so')
  expect(outcome.comment).toBe(
    '## Review found defects\nFailed checks:\n- an empty list says so: `bin/rspec spec/b_spec.rb`\n  expected "empty", got ""\n\nDefects:\n- the empty state is not translated\n\nBack to In Progress.',
  )
})

test('an item the review does not report counts as failed', () => {
  const outcome = reviewOutcome(renderTaskBody(TASK), { items: [{ index: 1, pass: true, evidence: 'ok' }], defects: [] })

  expect(outcome.accepted).toBe(false)
  expect(outcome.comment).toContain('- an empty list says so: `bin/rspec spec/b_spec.rb`\n  not reported by the review')
})

test('defects alone reject an otherwise passing review', () => {
  const outcome = reviewOutcome(renderTaskBody(TASK), {
    items: [{ index: 1, pass: true, evidence: 'ok' }, { index: 2, pass: true, evidence: 'ok' }],
    defects: ['the controller swallows errors'],
  })

  expect(outcome.accepted).toBe(false)
  expect(outcome.body).toContain('- [x] an empty list says so')
  expect(outcome.comment).toBe('## Review found defects\nDefects:\n- the controller swallows errors\n\nBack to In Progress.')
})
