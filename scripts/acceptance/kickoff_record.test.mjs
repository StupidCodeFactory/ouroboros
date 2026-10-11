import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { KICKOFF_DROPPED_COMMENT } from '../../hooks/github/gh_commands.ts'
import { boardGaps, createsGaps, rerunGaps } from './kickoff_record.mjs'

const STARTED_AT = '2026-10-11T10:00:00Z'
const BEFORE_START = '2026-10-11T09:00:00Z'
const AFTER_START = '2026-10-11T11:00:00Z'

const open = (number, title = `task ${number}`) => ({ number, state: 'open', state_reason: null, title, updated_at: AFTER_START })
const dropped = number => ({ number, state: 'closed', state_reason: 'not_planned', title: `task ${number}`, updated_at: AFTER_START })
const completed = (number, updated_at = BEFORE_START) => ({ number, state: 'closed', state_reason: 'completed', title: `task ${number}`, updated_at })

const record = overrides => ({ created: [1, 2], updated: [], dropped: [], left_closed: [], started_at: STARTED_AT, ...overrides })

const commentsWith = comments => () => comments

describe('the creates check', () => {
  test('passes when every created number is an open sub-issue', () => {
    assert.deepEqual(createsGaps(record(), [open(1), open(2)]), [])
  })

  test('names a created number that is closed', () => {
    assert.match(createsGaps(record(), [open(1), completed(2)]).join('\n'), /#2/)
  })

  test('names a created number that is not a sub-issue', () => {
    assert.match(createsGaps(record(), [open(1)]).join('\n'), /#2/)
  })

  test('fails on an empty created list', () => {
    assert.notDeepEqual(createsGaps(record({ created: [] }), [open(1)]), [])
  })
})

describe('the rerun check', () => {
  const rerun = record({ created: [3], updated: [1], dropped: [2], left_closed: [4] })
  const issues = [open(1), dropped(2), open(3), completed(4)]
  const droppedComments = commentsWith([KICKOFF_DROPPED_COMMENT])

  test('passes when the record satisfies every rule', () => {
    assert.deepEqual(rerunGaps(rerun, issues, droppedComments), [])
  })

  test('names a missing kind', () => {
    const { left_closed: _, ...without } = rerun
    assert.match(rerunGaps(without, issues, droppedComments).join('\n'), /left_closed/)
  })

  test('names a dropped sub-issue whose state reason is not "not planned"', () => {
    assert.match(rerunGaps(rerun, [open(1), completed(2, AFTER_START), open(3), completed(4)], droppedComments).join('\n'), /#2/)
  })

  test('names a dropped sub-issue without the kickoff dropped comment', () => {
    assert.match(rerunGaps(rerun, issues, commentsWith(['something else'])).join('\n'), /#2/)
  })

  test('names a left-closed sub-issue touched after kickoff started', () => {
    assert.match(rerunGaps(rerun, [open(1), dropped(2), open(3), completed(4, AFTER_START)], droppedComments).join('\n'), /#4/)
  })

  test('names a closed sub-issue the record omits that was touched after kickoff started', () => {
    assert.match(rerunGaps(rerun, [...issues, completed(5, AFTER_START)], droppedComments).join('\n'), /#5/)
  })

  test('compares started_at as a date, not a string', () => {
    const offsetRecord = record({ ...rerun, started_at: '2026-10-11T12:00:00+02:00' })
    assert.match(rerunGaps(offsetRecord, [open(1), dropped(2), open(3), completed(4, AFTER_START)], droppedComments).join('\n'), /#4/)
    assert.deepEqual(rerunGaps(offsetRecord, [open(1), dropped(2), open(3), completed(4, '2026-10-11T09:59:00.000Z')], droppedComments), [])
  })

  test('names a missing or unparsable started_at', () => {
    assert.match(rerunGaps(record({ ...rerun, started_at: undefined }), issues, droppedComments).join('\n'), /started_at/)
    assert.match(rerunGaps(record({ ...rerun, started_at: 'yesterday' }), issues, droppedComments).join('\n'), /started_at/)
  })

  test('names two open sub-issues sharing one title', () => {
    assert.match(rerunGaps(rerun, [open(1, 'same'), dropped(2), open(3, 'same'), completed(4)], droppedComments).join('\n'), /same/)
  })
})

describe('the board check', () => {
  const statusOf = statuses => number => statuses[number]

  test('passes when every open sub-issue sits in the planned column', () => {
    assert.deepEqual(boardGaps([open(1), dropped(2)], statusOf({ 1: 'Planned' }), 'Planned'), [])
  })

  test('names an open sub-issue outside the planned column', () => {
    assert.match(boardGaps([open(1), open(2)], statusOf({ 1: 'Planned', 2: 'Done' }), 'Planned').join('\n'), /#2/)
  })

  test('names an open sub-issue missing from the board', () => {
    assert.match(boardGaps([open(1)], statusOf({}), 'Planned').join('\n'), /#1/)
  })
})
