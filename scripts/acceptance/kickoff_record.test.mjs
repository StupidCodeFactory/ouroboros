import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { KICKOFF_DROPPED_COMMENT } from '../../hooks/github/gh_commands.ts'
import { boardGaps, createsGaps, outcomesOf, rerunGaps } from './kickoff_record.mjs'

const STARTED_AT = '2026-10-11T10:00:00Z'
const BEFORE_START = '2026-10-11T09:00:00Z'
const AFTER_START = '2026-10-11T11:00:00Z'

const subIssue = (number, overrides = {}) => ({
  number,
  state: 'open',
  state_reason: null,
  title: `task ${number}`,
  created_at: BEFORE_START,
  updated_at: BEFORE_START,
  ...overrides,
})
const created = number => subIssue(number, { created_at: AFTER_START, updated_at: AFTER_START })
const updated = number => subIssue(number, { updated_at: AFTER_START })
const dropped = number => subIssue(number, { state: 'closed', state_reason: 'not_planned', updated_at: AFTER_START })
const completed = (number, updated_at = BEFORE_START) => subIssue(number, { state: 'closed', state_reason: 'completed', updated_at })

const record = planned => ({ started_at: STARTED_AT, planned })
const plannedOf = issues => issues.filter(issue => issue.state === 'open').map(issue => ({ issue: issue.number, title: issue.title }))

const commentsWith = comments => () => comments

describe('the outcomes', () => {
  test('created, updated and dropped are read from GitHub after the start', () => {
    const issues = [created(5), updated(1), subIssue(2), dropped(3), completed(4)]

    assert.deepEqual(outcomesOf(STARTED_AT, issues), { created: [5], updated: [1], dropped: [3], touched_closed: [] })
  })

  test('a closed sub-issue touched after the start that kickoff did not drop is touched', () => {
    assert.deepEqual(outcomesOf(STARTED_AT, [completed(4, AFTER_START)]).touched_closed, [4])
  })

  test('the start compares as a date, not a string', () => {
    assert.deepEqual(outcomesOf('2026-10-11T12:00:00+02:00', [updated(1)]).updated, [1])
    assert.deepEqual(outcomesOf('2026-10-11T12:00:00+02:00', [subIssue(1, { updated_at: '2026-10-11T09:59:00.000Z' })]).updated, [])
  })
})

describe('the creates check', () => {
  test('passes when every planned task is an open sub-issue', () => {
    const issues = [created(1), created(2)]
    assert.deepEqual(createsGaps(record(plannedOf(issues)), issues), [])
  })

  test('a planned task with no sub-issue is reported', () => {
    assert.match(createsGaps(record([{ title: 'task 1' }, { title: 'search' }]), [created(1)]).join('\n'), /search/)
  })

  test('a planned revision of a closed sub-issue is reported', () => {
    assert.match(createsGaps(record([{ issue: 4, title: 'task 4' }]), [completed(4)]).join('\n'), /#4/)
  })

  test('fails on an empty plan or a record without a start', () => {
    assert.notDeepEqual(createsGaps(record([]), [created(1)]), [])
    assert.match(createsGaps({ planned: [{ title: 'task 1' }] }, [created(1)]).join('\n'), /started_at/)
    assert.match(createsGaps({ started_at: 'yesterday', planned: [{ title: 'task 1' }] }, [created(1)]).join('\n'), /started_at/)
  })
})

describe('the rerun check', () => {
  const issues = [updated(1), dropped(2), created(3), completed(4)]
  const rerun = record(plannedOf(issues))
  const droppedComments = commentsWith([KICKOFF_DROPPED_COMMENT])

  test('passes when the rerun updated, created and dropped, and touched nothing closed', () => {
    assert.deepEqual(rerunGaps(rerun, issues, droppedComments), [])
  })

  test('a rerun that updated or dropped nothing fails', () => {
    const firstRun = [created(1), created(2)]
    const gaps = rerunGaps(record(plannedOf(firstRun)), firstRun, droppedComments).join('\n')
    assert.match(gaps, /updated: none/)
    assert.match(gaps, /dropped: none/)
  })

  test('names a dropped sub-issue without the kickoff dropped comment', () => {
    assert.match(rerunGaps(rerun, issues, commentsWith(['something else'])).join('\n'), /#2/)
  })

  test('names a closed sub-issue touched after kickoff started', () => {
    assert.match(rerunGaps(rerun, [...issues, completed(5, AFTER_START)], droppedComments).join('\n'), /#5/)
  })

  test('names two open sub-issues sharing one title', () => {
    const twins = [updated(1), dropped(2), created(3), subIssue(6, { title: 'task 3' })]
    assert.match(rerunGaps(record(plannedOf(twins)), twins, droppedComments).join('\n'), /task 3/)
  })
})

describe('the board check', () => {
  const statusOf = statuses => number => statuses[number]

  test('passes when every open sub-issue sits in the planned column', () => {
    assert.deepEqual(boardGaps([subIssue(1), dropped(2)], statusOf({ 1: 'Planned' }), 'Planned'), [])
  })

  test('names an open sub-issue outside the planned column', () => {
    assert.match(boardGaps([subIssue(1), subIssue(2)], statusOf({ 1: 'Planned', 2: 'Done' }), 'Planned').join('\n'), /#2/)
  })

  test('names an open sub-issue missing from the board', () => {
    assert.match(boardGaps([subIssue(1)], statusOf({}), 'Planned').join('\n'), /#1/)
  })
})
