import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const DECISIONS_BLOCK = [
  'brief done',
  '```json',
  '{"decisions":[{"title":"queue is the store","context":"c","decision":"d","alternatives":"a","consequences":"q"}]}',
  '```',
].join('\n')

const agentResult = (text: string) => ({
  agentId: 'agent-1',
  content: [{ type: 'text' as const, text }],
  totalToolUseCount: 0,
  totalDurationMs: 1,
  totalTokens: 1,
  usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: null, cache_creation: null },
})

const spawnsBeneath = (on: On) => {
  const spawned: Array<{ subagent_type?: string; prompt?: string }> = []
  on('agent.spawn', (_, e) => {
    spawned.push(e as { subagent_type?: string; prompt?: string })
    return { model: 'fable', agentId: 'scribe-1' }
  })
  return spawned
}

const gitBeneath = (on: On, answers: Record<string, string>) =>
  on('process.run', (_, e) => ({
    value: { exitCode: 0, stdout: answers[e.argv.slice(0, 2).join(' ')] ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))

const CONFIG_FILE = '.claude/ouroboros.json'
const CONFIG = JSON.stringify({ drafts_dir: 'docs/drafts' })

const filesBeneath = (on: On) => {
  const files = new Map<string, string>()
  on('fs.exists', (_, e) => ({ value: e.path.endsWith(CONFIG_FILE) }))
  on('fs.read', (_, e) => ({ value: e.path.endsWith(CONFIG_FILE) ? CONFIG : '' }))
  on('fs.write', (_, e) => {
    files.set(e.path.slice(e.path.indexOf('skills/')), e.text)
    return { value: undefined }
  })
  return files
}

test('an architect brief with decisions opens Proposed ADRs through the scribe', async ($, on) => {
  const spawned = spawnsBeneath(on)
  gitBeneath(on, {})
  filesBeneath(on)
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: agentResult(DECISIONS_BLOCK) }))

  await $.tool.call({ tool: 'Agent', description: 'brief', prompt: 'design it', subagent_type: 'ouroboros:architect' })

  expect(spawned).toHaveLength(1)
  expect(spawned[0]).toMatchObject({ subagent_type: 'ouroboros:adr-scribe' })
  expect(spawned[0]?.prompt).toContain('open Proposed ADRs')
  expect(spawned[0]?.prompt).toContain('queue is the store')
})

test('a reviewer result without decisions spawns no scribe', async ($, on) => {
  const spawned = spawnsBeneath(on)
  gitBeneath(on, {})
  filesBeneath(on)
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: agentResult('all good') }))

  await $.tool.call({ tool: 'Agent', description: 'review', prompt: 'review it', subagent_type: 'reviewer' })

  expect(spawned).toEqual([])
})

test('editing a draft after milestone kickoff folds it into the active ADR and files no skill incident', async ($, on) => {
  const spawned = spawnsBeneath(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 3) })
  gitBeneath(on, { 'git branch': 'milestone/m1\n', 'git log': 'phase(P1): first' })
  const files = filesBeneath(on)
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'edited' }))

  await $.tool.call({ tool: 'Edit', file_path: '/project/docs/drafts/plans/m1.md', old_string: 'a', new_string: 'b' })

  expect(spawned).toHaveLength(1)
  expect(spawned[0]?.prompt).toContain('fold this draft change into its active ADR: note it under Implementation')
  expect(spawned[0]?.prompt).toContain('/project/docs/drafts/plans/m1.md')
  expect(files.size).toBe(0)
})

test('editing a draft before kickoff folds it without logging drift', async ($, on) => {
  const spawned = spawnsBeneath(on)
  gitBeneath(on, { 'git branch': 'feature/x\n', 'git log': '' })
  const files = filesBeneath(on)
  on('tool.call', { tool: 'Write' }, () => ({ result: 'written' }))

  await $.tool.call({ tool: 'Write', file_path: 'docs/drafts/specs/x.md', content: 'spec' })

  expect(spawned).toHaveLength(1)
  expect(files.size).toBe(0)
})

test('writing a non-draft file touches nothing', async ($, on) => {
  const spawned = spawnsBeneath(on)
  filesBeneath(on)
  on('tool.call', { tool: 'Write' }, () => ({ result: 'written' }))

  await $.tool.call({ tool: 'Write', file_path: 'lib/x.rb', content: 'code' })

  expect(spawned).toEqual([])
})

test('a merged milestone PR starts the retro and the ADR acceptance', async ($, on) => {
  const spawned = spawnsBeneath(on)
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  on('fs.exists', () => ({ value: false }))

  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 12 --merge' })

  expect(spawned.map(spawn => spawn.subagent_type)).toEqual(['ouroboros:skill-curator', 'ouroboros:adr-scribe'])
  expect(spawned[1]?.prompt).toContain('fill Outcome and Verification, set Accepted')
})
