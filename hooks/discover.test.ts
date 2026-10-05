import { expect, test } from 'claude-code/testing'

import { discoverDrafts, kickoffArgs } from './discover'

const plan = (milestone: string, specLine = '') =>
  [`# Plan for ${milestone}`, specLine, '### Task 1: first (P0)', '- [ ] step'].join('\n')

test('kickoff args take explicit drafts only when both name markdown files', () => {
  expect(kickoffArgs('M1 specs/a.md plans/a.md ship it')).toEqual({ milestone: 'M1', spec: 'specs/a.md', plan: 'plans/a.md', goal: 'ship it' })
  expect(kickoffArgs('M1 ship it')).toEqual({ milestone: 'M1', goal: 'ship it' })
  expect(kickoffArgs('M3 --phase P5 heal the merged path')).toEqual({ milestone: 'M3', phase: 'P5', goal: 'heal the merged path' })
  expect(kickoffArgs('M3 specs/a.md plans/a.md --phase P5')).toEqual({ milestone: 'M3', spec: 'specs/a.md', plan: 'plans/a.md', phase: 'P5', goal: '' })
  expect(kickoffArgs('M1')).toEqual({ milestone: 'M1', goal: '' })
  expect(kickoffArgs('')).toEqual({ goal: '' })
})

test('the newest plan naming the milestone wins and its Spec line names the spec', () => {
  const files = [
    { path: 'notes/ideas.md', text: '# ideas M1' },
    { path: 'work/2026-10-03-loop.md', text: plan('M1', '**Spec:** `docs/drafts/design/2026-10-03-loop-design.md`') },
    { path: 'work/2026-09-01-old.md', text: plan('M1') },
    { path: 'design/2026-10-03-loop-design.md', text: '# Loop design' },
  ]
  expect(discoverDrafts(files, 'M1', 'docs/drafts')).toEqual({ drafts: { plan: 'work/2026-10-03-loop.md', spec: 'design/2026-10-03-loop-design.md' } })
})

test('without a Spec line the spec is the non-plan file sharing the plan slug', () => {
  const files = [
    { path: 'a/2026-10-03-loop.md', text: plan('M2') },
    { path: 'b/2026-10-02-loop-design.md', text: '# design' },
    { path: 'b/2026-10-02-other-design.md', text: '# other' },
  ]
  expect(discoverDrafts(files, 'M2', 'docs')).toEqual({ drafts: { plan: 'a/2026-10-03-loop.md', spec: 'b/2026-10-02-loop-design.md' } })
})

test('a plan that never names the milestone is used only when no plan names it', () => {
  const files = [{ path: 'p.md', text: plan('M9') }, { path: 'p-design.md', text: '# d' }]
  expect(discoverDrafts(files, 'M1', 'docs')).toEqual({ drafts: { plan: 'p.md', spec: 'p-design.md' } })
  expect(discoverDrafts([{ path: 'q.md', text: plan('M3') }, ...files], 'M9', 'docs')).toEqual({ drafts: { plan: 'p.md', spec: 'p-design.md' } })
})

test('M1 does not match M10', () => {
  const files = [{ path: 'ten.md', text: plan('M10') }, { path: 'one.md', text: plan('M1') }, { path: 'one-design.md', text: '# d' }]
  expect(discoverDrafts(files, 'M1', 'docs')).toMatchObject({ drafts: { plan: 'one.md' } })
})

test('discovery explains what is missing', () => {
  expect(discoverDrafts([{ path: 'x.md', text: '# notes' }], 'M1', 'docs')).toEqual({ error: 'no plan with task checkboxes under docs; pass /ouroboros kickoff M1 <spec> <plan>' })
  expect(discoverDrafts([{ path: 'p.md', text: plan('M1') }], 'M1', 'docs')).toEqual({ error: 'found plan p.md but no spec (no Spec: line, no file sharing its name); pass /ouroboros kickoff M1 <spec> p.md' })
})
