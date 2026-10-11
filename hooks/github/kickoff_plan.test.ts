import { expect, test } from 'claude-code/testing'

import { renderTaskBody } from './contract'
import { kickoffChanges, plannedBody } from './kickoff_plan'
import type { PlannedTask, SubIssue } from './kickoff_plan'

const CONTRACT = {
  goal: 'Owners see their Page.',
  plan: '1. Red. 2. Green.',
  checklist: [{ text: 'the list shows the Page: `bin/rspec` passes', done: false }],
  completion: '`bin/rspec` exits 0.',
  stop: '- Meta disagrees with the spec: stop and ask.',
  must_not: '- No new gem.',
}

const planned = (title: string, phase: string, extra: Partial<PlannedTask> = {}): PlannedTask => ({ title, ...CONTRACT, phase, depends_on: [], ...extra })

const subIssue = (number: number, task: PlannedTask, state: SubIssue['state'] = 'open'): SubIssue => ({
  number,
  state,
  title: task.title,
  body: renderTaskBody({ ...task, depends_on: task.depends_on.map(dependency => ('issue' in dependency ? dependency.issue : 0)) }),
})

const LIST = planned('Page list', 'P1')
const EMPTY = planned('Empty list', 'P1')
const DETAIL = planned('Page detail', 'P2', { depends_on: [{ issue: 11 }] })

test('a first run creates every task and nothing else', () => {
  const tasks = [LIST, planned('Page detail', 'P2', { depends_on: [{ task: 1 }] })]

  expect(kickoffChanges([], tasks)).toEqual({ create: [1, 2], update: [], drop: [], unchanged: [], closed: [] })
})

test('a rerun updates the changed task, creates the new one, drops the open one left out and lists closed ones untouched', () => {
  const existing = [subIssue(10, EMPTY, 'closed'), subIssue(11, LIST), subIssue(12, DETAIL), subIssue(13, planned('Old export', 'P2'))]
  const tasks = [
    { ...LIST, issue: 11, goal: 'Owners see every Page they manage.' },
    { ...DETAIL, issue: 12 },
    planned('Page search', 'P2', { depends_on: [{ task: 1 }] }),
  ]

  expect(kickoffChanges(existing, tasks)).toEqual({ create: [3], update: [11], drop: [13], unchanged: [12], closed: [10] })
})

test('a retitled task is an update', () => {
  const changes = kickoffChanges([subIssue(11, LIST)], [{ ...LIST, issue: 11, title: 'Pages list' }])

  expect(changes).toEqual({ create: [], update: [11], drop: [], unchanged: [], closed: [] })
})

test('a task list naming a closed sub-issue, a foreign issue or one issue twice is rejected whole', () => {
  const existing = [subIssue(10, EMPTY, 'closed'), subIssue(11, LIST)]

  expect(kickoffChanges(existing, [{ ...EMPTY, issue: 10 }])).toEqual({ rejected: 'task 1 revises #10, which is closed' })
  expect(kickoffChanges(existing, [{ ...LIST, issue: 99 }])).toEqual({ rejected: 'task 1 revises #99, which is not a sub-issue of this milestone' })
  expect(kickoffChanges(existing, [{ ...LIST, issue: 11 }, { ...EMPTY, issue: 11 }])).toEqual({ rejected: 'tasks 1 and 2 both revise #11' })
})

test('more than 100 tasks are rejected', () => {
  const tasks = Array.from({ length: 101 }, (_, index) => planned(`Task ${index}`, 'P1'))

  expect(kickoffChanges([], tasks)).toEqual({ rejected: '101 tasks: a milestone holds at most 100 sub-issues; split the milestone' })
})

test('a dependency on a later phase, a dropped or foreign issue, a missing task or itself is rejected', () => {
  const existing = [subIssue(11, LIST), subIssue(13, planned('Old export', 'P2'))]

  expect(kickoffChanges([], [planned('Page list', 'P1', { depends_on: [{ task: 2 }] }), planned('Search', 'P2')])).toEqual({ rejected: 'task 1 (P1) depends on task 2 in a later phase (P2)' })
  expect(kickoffChanges(existing, [{ ...LIST, issue: 11 }, planned('Search', 'P2', { depends_on: [{ issue: 13 }] })])).toEqual({ rejected: 'task 2 depends on #13, which kickoff drops' })
  expect(kickoffChanges(existing, [planned('Search', 'P2', { depends_on: [{ issue: 99 }] })])).toEqual({ rejected: 'task 1 depends on #99, which is not a sub-issue of this milestone' })
  expect(kickoffChanges([], [planned('Search', 'P2', { depends_on: [{ task: 5 }] })])).toEqual({ rejected: 'task 1 depends on task 5, which the list does not hold' })
  expect(kickoffChanges([], [planned('Search', 'P2', { depends_on: [{ task: 1 }] })])).toEqual({ rejected: 'task 1 depends on itself' })
})

test('a dependency on a closed sub-issue is allowed', () => {
  const existing = [subIssue(10, EMPTY, 'closed')]

  expect(kickoffChanges(existing, [planned('Search', 'P2', { depends_on: [{ issue: 10 }] })])).toEqual({ create: [1], update: [], drop: [], unchanged: [], closed: [10] })
})

test('a task with a contract gap is rejected with the sections it misses', () => {
  expect(kickoffChanges([], [planned('Search', 'P2', { must_not: ' ', checklist: [] })])).toEqual({ rejected: 'task 1 "Search" misses Checklist, Must not' })
  expect(kickoffChanges([], [planned('Search', 'phase two')])).toEqual({ rejected: 'task 1 "Search" misses Phase' })
})

test('a planned body names new tasks by the issue numbers they got', () => {
  const tasks = [LIST, planned('Page detail', 'P2', { depends_on: [{ task: 1 }, { issue: 10 }] })]

  expect(plannedBody(tasks[1] as PlannedTask, position => (position === 1 ? 21 : 0))).toContain('P2\nDepends on: #21, #10')
})
