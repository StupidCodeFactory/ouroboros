import { expect, test } from 'claude-code/testing'

import {
  KICKOFF_DROPPED_COMMENT,
  addLabelCommand,
  addToBoardCommand,
  boardIdsOf,
  commentCommand,
  createSubIssueCommand,
  creationOrder,
  dropCommand,
  editIssueCommand,
  githubConfigOf,
  issueOfPosition,
  linkSubIssueCommand,
  pullRequestCommand,
  closePullRequestCommand,
  deleteCommentCommand,
  removeLabelCommand,
  setColumnCommand,
  shellCommand,
} from './gh_commands'
import type { PlannedTask } from './kickoff_plan'

const REPO = 'acme/shop'
const GITHUB = githubConfigOf({ project: 'Shop board' })

const PROJECTS = { projects: [{ number: 2, id: 'PVT_other', title: 'Other' }, { number: 3, id: 'PVT_shop', title: 'Shop board' }] }
const FIELDS = {
  fields: [
    { id: 'F_title', name: 'Title', type: 'ProjectV2Field' },
    {
      id: 'F_status',
      name: 'Status',
      type: 'ProjectV2SingleSelectField',
      options: [
        { id: 'o_m', name: 'Milestones' },
        { id: 'o_p', name: 'Planned' },
        { id: 'o_i', name: 'In Progress' },
        { id: 'o_q', name: 'QA' },
        { id: 'o_d', name: 'Done' },
      ],
    },
  ],
}

const task = (title: string, depends_on: PlannedTask['depends_on'] = []): PlannedTask => ({
  title,
  goal: 'g',
  plan: 'p\nFiles: `a`',
  checklist: [{ text: 't', command: 'c', done: false }],
  depends_on,
})

test('a sub-issue is created on the configured repo with its body on stdin', () => {
  expect(createSubIssueCommand(REPO, 'Page list', '## Goal\nx\n')).toEqual({
    argv: ['gh', 'issue', 'create', '-R', REPO, '--title', 'Page list', '--body-file', '-'],
    stdin: '## Goal\nx\n',
  })
})

test('a created issue is linked to the milestone by its numeric id', () => {
  expect(linkSubIssueCommand(REPO, 167, 3456789)).toEqual({ argv: ['gh', 'api', '-X', 'POST', 'repos/acme/shop/issues/167/sub_issues', '-F', 'sub_issue_id=3456789'] })
})

test('an update edits title and body in place on the configured repo', () => {
  expect(editIssueCommand(REPO, 12, 'Pages list', 'body')).toEqual({
    argv: ['gh', 'issue', 'edit', '12', '-R', REPO, '--title', 'Pages list', '--body-file', '-'],
    stdin: 'body',
  })
})

test('a drop closes the sub-issue as not planned with the kickoff comment', () => {
  expect(dropCommand(REPO, 13)).toEqual({ argv: ['gh', 'issue', 'close', '13', '-R', REPO, '--reason', 'not planned', '--comment', KICKOFF_DROPPED_COMMENT] })
  expect(KICKOFF_DROPPED_COMMENT).toContain('kickoff dropped')
})

test('a sub-issue goes on the board and into a column by id', () => {
  const ids = boardIdsOf(PROJECTS, FIELDS, GITHUB)
  if ('missing' in ids) throw new Error(ids.missing)

  expect(addToBoardCommand('acme', ids, 'https://github.com/acme/shop/issues/12')).toEqual({
    argv: ['gh', 'project', 'item-add', '3', '--owner', 'acme', '--url', 'https://github.com/acme/shop/issues/12', '--format', 'json', '--jq', '.id'],
  })
  expect(setColumnCommand(ids, 'PVTI_12', 'planned')).toEqual({
    argv: ['gh', 'project', 'item-edit', '--id', 'PVTI_12', '--project-id', 'PVT_shop', '--field-id', 'F_status', '--single-select-option-id', 'o_p'],
  })
})

test('new tasks are created after the new tasks they depend on', () => {
  const tasks = [task('detail', [{ task: 3 }]), { ...task('list'), issue: 11 }, task('search', [{ issue: 11 }]), task('export', [{ task: 1 }, { task: 3 }])]

  expect(creationOrder(tasks, [1, 3, 4])).toEqual([3, 1, 4])
})

test('board ids resolve the project, the status field and every configured column', () => {
  expect(boardIdsOf(PROJECTS, FIELDS, GITHUB)).toEqual({
    project_id: 'PVT_shop',
    project_number: 3,
    status_field_id: 'F_status',
    columns: { milestones: 'o_m', planned: 'o_p', in_progress: 'o_i', qa: 'o_q', done: 'o_d' },
  })
})

test('a missing project, status field or column stops with its configured name', () => {
  expect(boardIdsOf({ projects: [] }, FIELDS, GITHUB)).toEqual({ missing: 'project "Shop board"' })
  expect(boardIdsOf(PROJECTS, { fields: [] }, GITHUB)).toEqual({ missing: 'field "Status" on project "Shop board"' })
  expect(boardIdsOf(PROJECTS, FIELDS, githubConfigOf({ project: 'Shop board', columns: { qa: 'Review' } }))).toEqual({ missing: 'column "Review" of field "Status"' })
  expect(boardIdsOf(PROJECTS, FIELDS, githubConfigOf({}))).toEqual({ missing: 'github.project in .claude/ouroboros.json' })
})

test('github config fills in defaults for everything but the project', () => {
  expect(githubConfigOf(undefined)).toEqual({
    status_field: 'Status',
    columns: { milestones: 'Milestones', planned: 'Planned', in_progress: 'In Progress', qa: 'QA', done: 'Done' },
    labels: { needs_owner: 'needs-owner' },
  })
  expect(githubConfigOf({ repo: REPO, project: 'Shop board', columns: { qa: 'Review' } })).toMatchObject({
    repo: REPO,
    project: 'Shop board',
    columns: { milestones: 'Milestones', planned: 'Planned', in_progress: 'In Progress', qa: 'Review', done: 'Done' },
  })
})

test('a dependency by place in the list names the revised issue or the issue just created', () => {
  const tasks = [{ ...task('list'), issue: 11 }, task('search')]
  const issueOf = issueOfPosition(tasks, new Map([[2, 21]]))

  expect([issueOf(1), issueOf(2)]).toEqual([11, 21])
})

test('a comment goes on the issue with its text on stdin', () => {
  expect(commentCommand(REPO, 12, '## Review found defects')).toEqual({
    argv: ['gh', 'issue', 'comment', '12', '-R', REPO, '--body-file', '-'],
    stdin: '## Review found defects',
  })
})

test('the needs-owner label is added by its configured name', () => {
  expect(addLabelCommand(REPO, 12, 'needs-owner')).toEqual({ argv: ['gh', 'issue', 'edit', '12', '-R', REPO, '--add-label', 'needs-owner'] })
})

test('the pull request targets its base, heads the task branch and closes the sub-issue', () => {
  expect(pullRequestCommand(REPO, { base: 'main', head: 'work/12-page-list', title: 'Page list', number: 12 })).toEqual({
    argv: ['gh', 'pr', 'create', '-R', REPO, '--base', 'main', '--head', 'work/12-page-list', '--title', 'Page list', '--body-file', '-'],
    stdin: 'Closes #12\n',
  })
})

test('a failing command reads back as one shell line', () => {
  expect(shellCommand(['gh', 'pr', 'create', '--title', "Owner's page", '--body-file', '-', ''])).toBe("gh pr create --title 'Owner'\\''s page' --body-file - ''")
})

test('undoing a label removes it', () => {
  expect(removeLabelCommand(REPO, 12, 'needs-owner')).toEqual({ argv: ['gh', 'issue', 'edit', '12', '-R', REPO, '--remove-label', 'needs-owner'] })
})

test('undoing a comment deletes it by the id in its url', () => {
  expect(deleteCommentCommand(REPO, 'https://github.com/acme/shop/issues/12#issuecomment-4567')).toEqual({ argv: ['gh', 'api', '-X', 'DELETE', 'repos/acme/shop/issues/comments/4567'] })
  expect(deleteCommentCommand(REPO, '')).toBeUndefined()
})

test('undoing a pull request closes it and keeps its branch', () => {
  expect(closePullRequestCommand(REPO, 'https://github.com/acme/shop/pull/99')).toEqual({ argv: ['gh', 'pr', 'close', 'https://github.com/acme/shop/pull/99', '-R', REPO, '--delete-branch=false'] })
})
