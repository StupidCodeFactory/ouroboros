import { expect, test } from 'claude-code/testing'

import { autoCloseProblems, boardProblems, deleteHeadBranchesProblems, doctorAnswer, labelProblems, prdProblems, pushProblems, scopeProblems } from './doctor'
import { githubConfigOf } from './gh_commands'

const USER = (scopes: string) => `HTTP/2.0 200 OK\nX-Oauth-Scopes: ${scopes}\n\n{"login":"octo"}`
const GITHUB = githubConfigOf({ repo: 'acme/shop', project: 'Shop board' })
const PROJECTS = { projects: [{ number: 3, id: 'PVT_shop', title: 'Shop board' }] }
const fields = (names: string[]) => ({ fields: [{ id: 'F', name: 'Status', options: names.map(name => ({ id: name, name })) }] })

test('a token without project scope names the login and the refresh command', () => {
  expect(scopeProblems(USER('repo, project, read:org'))).toEqual([])
  expect(scopeProblems(USER('repo'))).toEqual(['the gh token of octo lacks the project scope: run gh auth refresh -s project'])
})

test('the delete-head-branches setting off names the setting and how to turn it on', () => {
  expect(deleteHeadBranchesProblems('acme/shop', 'true\n')).toEqual([])
  expect(deleteHeadBranchesProblems('acme/shop', 'false')).toEqual(['the setting "Automatically delete head branches" of acme/shop is off, so a stacked PR can merge into a branch already in the default branch: turn it on under Settings > General > Pull Requests, or run gh api -X PATCH repos/acme/shop -F delete_branch_on_merge=true'])
})

test('no push rights name the login', () => {
  expect(pushProblems('octo', 'acme/shop', 'true')).toEqual([])
  expect(pushProblems('octo', 'acme/shop', 'false')).toEqual(['octo cannot push to acme/shop: ask for write access'])
})

test('every missing column is named', () => {
  expect(boardProblems(PROJECTS, fields(['Milestones', 'Planned', 'In Progress']), GITHUB)).toEqual([
    'missing column "QA" of field "Status" on project "Shop board"',
    'missing column "Done" of field "Status" on project "Shop board"',
  ])
  expect(boardProblems({ projects: [] }, fields([]), GITHUB)).toEqual(['missing project "Shop board"'])
})

test('label and PRD problems', () => {
  expect(labelProblems('acme/shop', 'needs-owner', '[{"name":"needs-owner"}]')).toEqual([])
  expect(labelProblems('acme/shop', 'needs-owner', '[]')).toHaveLength(1)
  expect(prdProblems('docs/prd.md', undefined)).toEqual(['no PRD at docs/prd.md: write one or set prd in .claude/ouroboros.json'])
  expect(prdProblems('docs/prd.md', '# Title')).toHaveLength(1)
  expect(prdProblems('docs/prd.md', '### M1. A')).toEqual([])
})

test('the answer is ready or lists every problem', () => {
  expect(doctorAnswer([])).toBe('ouroboros doctor: ready')
  expect(doctorAnswer(['a', 'b'])).toBe('ouroboros doctor found 2 problems:\n- a\n- b')
})

test('an enabled Auto-close issue workflow is named', () => {
  const workflows = (enabled: boolean) => JSON.stringify({ data: { node: { workflows: { nodes: [{ name: 'Auto-close issue', enabled }] } } } })
  expect(autoCloseProblems('Shop board', workflows(false))).toEqual([])
  expect(autoCloseProblems('Shop board', workflows(true))).toHaveLength(1)
})
