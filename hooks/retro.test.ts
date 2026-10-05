import { expect, test } from 'claude-code/testing'

import { RETRO_PROMPT, checkpointPhaseOf, isGuardedMerge, isPhaseWorkflow, isRetroTrigger, retroPrompt } from './retro'

test('a phase checkpoint commit triggers the retro', () => {
  expect(isRetroTrigger('git commit -m "phase(P0): add invoice export"', true)).toBe(true)
})

test('a successful milestone merge triggers the retro', () => {
  expect(isRetroTrigger('gh pr merge 812 --squash', true)).toBe(true)
})

test('a failed merge does not', () => {
  expect(isRetroTrigger('gh pr merge 812 --squash', false)).toBe(false)
})

test('an ordinary commit does not', () => {
  expect(isRetroTrigger('git commit -m "fix(api): invoice totals"', true)).toBe(false)
})

test('the phase a checkpoint commit names', () => {
  expect(checkpointPhaseOf('git commit -m "phase(P0): delete clean_unmonitored"')).toBe('P0')
  expect(checkpointPhaseOf('git commit -m "feat: add owners API"')).toBeUndefined()
})

test('the retro also prunes agent memory lines that point at paths gone from the repository', () => {
  expect(RETRO_PROMPT).toContain('.claude/agent-memory/*.md')
  expect(RETRO_PROMPT).toContain('no longer exist in the repository')
})

test('a merge is guarded only in the main session, so a workflow\'s own merge agent is never refused', () => {
  expect(isGuardedMerge('git merge origin/main', undefined)).toBe(true)
  expect(isGuardedMerge('git merge --no-ff milestone/task-7', 'workflow-agent-1')).toBe(false)
  expect(isGuardedMerge('git status', undefined)).toBe(false)
})

test('the retro prompt asks the curator to slim every eager file over the limit, largest first', () => {
  const files = [
    { name: 'reviewer.md', size: 9000 },
    { name: 'implementer-ruby.md', size: 48213 },
    { name: 'architect.md', size: 31000 },
  ]
  const prompt = retroPrompt(files, 20000)
  expect(prompt.startsWith(RETRO_PROMPT)).toBe(true)
  expect(prompt).toContain('Slim these eager files (over 20000 chars): .claude/ouroboros/eager/implementer-ruby.md (48213), .claude/ouroboros/eager/architect.md (31000).')
  expect(prompt).not.toContain('reviewer.md')
})

test('with no oversized eager file the retro prompt is the plain one', () => {
  expect(retroPrompt([{ name: 'reviewer.md', size: 9000 }], 20000)).toBe(RETRO_PROMPT)
})

test('the shipped kickoff-then-phase workflow counts as a phase launch', () => {
  expect(isPhaseWorkflow({ name: 'ouroboros:kickoff-phase' })).toBe(true)
  expect(isPhaseWorkflow({ name: 'ouroboros:milestone-kickoff' })).toBe(false)
})
