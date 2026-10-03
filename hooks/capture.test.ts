import { expect, mock, test } from 'claude-code/testing'

const FINDINGS_BLOCK = [
  'review done',
  '```json',
  '{"findings":[{"summary":"skipped the retry step","root_cause":"skill-misread","skill":"example-domain","agent":"implementer"},{"summary":"typo","root_cause":"code-bug"}]}',
  '```',
].join('\n')

const SKILL_LOG = '.claude/skills/example-domain/incidents.md'

const agentResult = (text: string) => ({
  agentId: 'agent-1',
  content: [{ type: 'text' as const, text }],
  totalToolUseCount: 0,
  totalDurationMs: 1,
  totalTokens: 1,
  usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: null, cache_creation: null },
})

test('a reviewer finding lands as an open incident row in the skill log', async ($, on) => {
  const files = new Map<string, string>()
  const fileAt = (path: string) => [...files].find(([name]) => path.endsWith(name))?.[1]
  mock.clock(on, { now: Date.UTC(2026, 9, 3) })
  on('fs.exists', (_, e) => ({ value: fileAt(e.path) !== undefined }))
  on('fs.read', (_, e) => ({ value: fileAt(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    files.set(e.path.slice(e.path.indexOf('.claude/')), e.text)
    return { value: undefined }
  })
  on('process.run', (_, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv[0] === 'git' ? 'phase(P2): add invoice export' : '.claude/skills/example-domain/incidents.md:1\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: agentResult(FINDINGS_BLOCK) }))
  const statuses: Array<string | undefined> = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })

  await $.tool.call({ tool: 'Agent', description: 'review', prompt: 'review it', subagent_type: 'reviewer' })

  const log = files.get(SKILL_LOG) ?? ''
  expect(log).toContain('| 2026-10-03 | P3 | implementer | skill-misread | | skipped the retry step |  | open | |')
  expect(log).not.toContain('typo')
  expect(statuses).toEqual(['skills: 1 open · ADR 1 proposed'])
})

test('an implementer result is not read for findings', async ($, on) => {
  const writes: string[] = []
  on('fs.write', (_, e) => {
    writes.push(e.path)
    return { value: undefined }
  })
  on('tool.call', { tool: 'Agent' }, () => ({ result: agentResult(FINDINGS_BLOCK) }))

  await $.tool.call({ tool: 'Agent', description: 'build', prompt: 'build it', subagent_type: 'implementer' })

  expect(writes).toEqual([])
})
