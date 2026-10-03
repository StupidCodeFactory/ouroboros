import { expect, test } from 'claude-code/testing'

import { checkBudget, eagerBlock, stripFrontmatter } from './inline'

test('strips frontmatter', () => {
  expect(stripFrontmatter('---\nname: x\n---\nBody')).toBe('Body')
})

test('inlines bodies with levels', () => {
  expect(eagerBlock([{ ref: { name: 'terse', level: 'ultra' }, body: 'Talk short.' }])).toBe(
    '<eager-skills>\n<skill name="terse">\nLevel: ultra\nTalk short.\n</skill>\n</eager-skills>\n\n',
  )
})

test('inlines a level-less skill without a Level line', () => {
  expect(eagerBlock([{ ref: { name: 'code-style' }, body: 'Small functions.' }])).toBe(
    '<eager-skills>\n<skill name="code-style">\nSmall functions.\n</skill>\n</eager-skills>\n\n',
  )
})

test('a block within budget is ok', () => {
  expect(checkBudget('short', 60000, { a: 5 })).toEqual({ ok: true })
})

test('a block over budget names each skill size', () => {
  expect(checkBudget('x'.repeat(11), 10, { a: 7, b: 4 })).toEqual({
    ok: false,
    reason: 'eager skills block is 11 chars, over the 10 limit: a 7, b 4',
  })
})
