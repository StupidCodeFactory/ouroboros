import { expect, test } from 'claude-code/testing'

import { activeDraftsOf, checkoutRootOf, draftsPathOf, firstUncheckedBox, phaseTasks, planPhases } from './drafts'

const TAGGED_PLAN = [
  '# Plan',
  '### Task 1: first thing (P1)',
  '- [x] **Step 1: done**',
  '- [ ] ~~Step 2: skipped~~ dropped: not needed',
  '- [ ] **Step 3: pending**',
  '- [ ] **Step 4: also pending**',
  '### Task 2: second thing (P10)',
  '- [ ] **Step 1: elsewhere**',
  '### Task 3: third: with colon (P1)',
  '- [x] **Step 1: done**',
].join('\n')

const UNTAGGED_PLAN = ['### Task 1: alpha', '- [ ] a', '### Task 2: beta', '- [x] b'].join('\n')

test('the main checkout root is the parent of the common git dir, from the main checkout and from a worktree', () => {
  expect(checkoutRootOf('/repo/.git\n')).toBe('/repo')
  expect(checkoutRootOf('/repo/.git\n')).toBe(checkoutRootOf('/repo/.git'))
})

test('a draft path joins the main checkout root, drafts_dir and the relative path', () => {
  expect(draftsPathOf('/repo', 'docs/drafts', 'plans/m1.md')).toBe('/repo/docs/drafts/plans/m1.md')
  expect(() => draftsPathOf('/repo', undefined, 'plans/m1.md')).toThrow('drafts_dir')
})

test('active drafts come from state.json and are null when unset', () => {
  expect(activeDraftsOf('{"drafts":{"spec":"specs/m1.md","plan":"plans/m1.md"}}')).toEqual({ spec: 'specs/m1.md', plan: 'plans/m1.md' })
  expect(activeDraftsOf('{"milestone":"M1"}')).toBe(null)
  expect(activeDraftsOf(undefined)).toBe(null)
})

test('phase tasks are the headings tagged with exactly that phase', () => {
  expect(phaseTasks(TAGGED_PLAN, 'P1')).toEqual([
    { id: '1', title: 'first thing', line: 2, unchecked: 2 },
    { id: '3', title: 'third: with colon', line: 9, unchecked: 0 },
  ])
})

test('an untagged plan is one phase holding every task', () => {
  expect(phaseTasks(UNTAGGED_PLAN, 'P1')).toEqual([
    { id: '1', title: 'alpha', line: 1, unchecked: 1 },
    { id: '2', title: 'beta', line: 3, unchecked: 0 },
  ])
})

test('the first unchecked box skips ticked and dropped boxes', () => {
  expect(firstUncheckedBox(TAGGED_PLAN, 'P1')).toEqual({ task: '1', line: 5, text: '**Step 3: pending**' })
  expect(firstUncheckedBox(TAGGED_PLAN, 'P10')).toEqual({ task: '2', line: 8, text: '**Step 1: elsewhere**' })
  expect(firstUncheckedBox(UNTAGGED_PLAN, 'P2')).toEqual({ task: '1', line: 2, text: 'a' })
})

test('a phase with every box ticked has no unchecked box', () => {
  expect(firstUncheckedBox('### Task 1: x (P1)\n- [x] y', 'P1')).toBe(null)
})

test('a heading tagged with a phase and a lane keeps both', () => {
  const plan = ['### Task 5: New event messages and golden payloads (P1)', '- [ ] Step 1', '### Task 6: Python decodes the goldens (P1, python)', '- [ ] Step 1'].join('\n')
  expect(phaseTasks(plan, 'P1')).toEqual([
    { id: '5', title: 'New event messages and golden payloads', line: 1, unchecked: 1 },
    { id: '6', title: 'Python decodes the goldens', line: 3, unchecked: 1, lane: 'python' },
  ])
  expect(planPhases(plan)).toEqual(['P1'])
})

const PLAN_WITH_DUPLICATE_IDS = [
  '### Task 17: One month-range helper (P0)',
  '- [x] Step 7: commit',
  '### Task 18: Slim the web API (P1)',
  '- [ ] Step 1',
  '### Task 19: One Python contract test per service (P1)',
  '- [ ] Step 1',
  '### Task 18: Singletons reached through class methods (P1)',
  '- [ ] Step 1',
  '### Task 19: P0 review follow-ups (P1)',
  '- [ ] Step 1',
].join('\n')

test('a plan with duplicate task ids fails loudly instead of running either copy', () => {
  expect(() => phaseTasks(PLAN_WITH_DUPLICATE_IDS, 'P1')).toThrow('the plan has duplicate task ids: 18, 19; renumber them before running a phase')
})
