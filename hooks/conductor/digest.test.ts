import { expect, test } from 'claude-code/testing'

import { RESULT_LIMIT, digestLine, digestedResult } from './digest'

test('a digest line lists scalar fields and array sizes', () => {
  expect(digestLine({ status: 'checkpointed', tasks: [1, 2, 3], evidence: 'x'.repeat(300) })).toBe('status=checkpointed tasks[3] evidence=' + 'x'.repeat(60) + '…')
})

test('an oversized Bash result keeps its shape with a digested stdout', () => {
  const result = { stdout: 'y'.repeat(RESULT_LIMIT + 1), stderr: '', interrupted: false }
  expect(digestedResult('Bash', result, 'results/u1.json')).toMatchObject({ stderr: '', interrupted: false })
  expect((digestedResult('Bash', result, 'results/u1.json') as { stdout: string }).stdout).toContain('results/u1.json')
})

test('an oversized Agent result keeps one text block', () => {
  const result = { agentId: 'a', content: [{ type: 'text', text: 'z'.repeat(RESULT_LIMIT + 1) }] }
  const digested = digestedResult('Agent', result, 'results/u2.json') as { content: Array<{ text: string }> }
  expect(digested.content).toHaveLength(1)
  expect(digested.content[0]?.text).toContain('results/u2.json')
})

test('a small result is returned untouched', () => {
  const result = { stdout: 'ok', stderr: '', interrupted: false }
  expect(digestedResult('Bash', result, 'p')).toBe(result)
})
