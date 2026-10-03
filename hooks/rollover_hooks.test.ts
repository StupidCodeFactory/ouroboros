import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ARCHITECT = { id: 'agent-7', name: 'architect', type: 'ouroboros:architect', description: 'architect', status: 'running' }
const usageAt = (share: number) => ({
  model: 'fable',
  input_tokens: share * 200_000,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  output_tokens: 10,
})

const completedTurn = (agentId: string, share: number) => ({
  reason: 'answer' as const,
  answer: 'done',
  durationMs: 1,
  isAborted: false,
  turnId: 'turn-1',
  agentId,
  usage: usageAt(share),
})

const sessionBeneath = (on: On) => {
  const sent: Array<{ to: unknown; text: string }> = []
  on('agent.list', () => ({ value: [ARCHITECT] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('session.send', (_, e) => {
    sent.push({ to: e.to, text: e.text })
    return { isDelivered: true as const }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return sent
}

test('a named agent past 55 percent is told to write its digest, then its next message spawns a fresh one', async ($, on) => {
  const sent = sessionBeneath(on)
  const spawned: object[] = []
  on('agent.spawn', (_, e) => {
    spawned.push(e)
    return { model: 'fable', agentId: 'agent-8' }
  })
  on('tool.call', { tool: 'SendMessage' }, () => ({ deny: 'unreachable' }))

  await $.turn.complete(completedTurn('agent-7', 0.6))

  expect(sent).toHaveLength(1)
  expect(sent[0]?.text).toContain('.claude/agent-memory/architect.md')

  await $.tool.call({ tool: 'SendMessage', to: 'architect', message: 'review the next phase' })
  const afterRetirement = await $.tool.call({ tool: 'SendMessage', to: 'architect', message: 'and again' })

  expect(spawned).toHaveLength(1)
  expect(spawned[0]).toMatchObject({ subagent_type: 'ouroboros:architect', name: 'architect', prompt: 'review the next phase' })
  expect(afterRetirement.text ?? afterRetirement.deny).toContain('unreachable')
})

test('an agent under 55 percent is left alone', async ($, on) => {
  const sent = sessionBeneath(on)

  await $.turn.complete(completedTurn('agent-7', 0.3))

  expect(sent).toEqual([])
})

test('a subagent compaction is told what to keep', async ($, on) => {
  let instructions: string | undefined
  on('session.compact', (_, e) => {
    instructions = e.instructions
    return { skip: 'test' }
  })

  await $.session.compact({ trigger: 'auto', agentId: 'agent-7', messages: [{ role: 'user', text: 'hi', toolUses: [] }] })

  expect(instructions).toBe('Keep domain facts, owned paths, and the open task.')
})
