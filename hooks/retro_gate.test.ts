import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ONE_OPEN_INCIDENT = '.claude/skills/example-domain/incidents.md:1\n'

const grepAnswers = (on: On, stdout: string) =>
  on('process.run', () => ({
    value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))

test('a phase checkpoint commit starts the skill-curator retro', async ($, on) => {
  const spawned: object[] = []
  const toasts: string[] = []
  on('agent.spawn', (_, e) => {
    spawned.push(e)
    return { model: 'fable', agentId: 'curator-1' }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))

  await $.tool.call({ tool: 'Bash', command: 'git commit -m "phase(P1): add invoice export"' })

  expect(spawned).toHaveLength(1)
  expect(spawned[0]).toMatchObject({ subagent_type: 'ouroboros:skill-curator', run_in_background: true })
  expect(toasts).toEqual(['retro started'])
})

test('a failed checkpoint commit starts nothing', async ($, on) => {
  const spawned: object[] = []
  on('agent.spawn', (_, e) => {
    spawned.push(e)
    return { model: 'fable', agentId: 'curator-1' }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'nothing to commit', isError: true }))

  await $.tool.call({ tool: 'Bash', command: 'git commit -m "phase(P1): add invoice export"' })

  expect(spawned).toEqual([])
})

test('an implementer is denied while an incident is open', async ($, on) => {
  grepAnswers(on, ONE_OPEN_INCIDENT)
  const reached: string[] = []
  on('tool.call', { tool: 'Agent' }, (_, e) => {
    reached.push(e.description)
    return { deny: 'unreachable' }
  })

  const answered = await $.tool.call({ tool: 'Agent', description: 'build', prompt: 'build it', subagent_type: 'implementer' })

  expect(answered.text ?? answered.deny).toContain('retro pending: 1 open incidents')
  expect(reached).toEqual([])
})

test('the phase workflow is denied while an incident is open', async ($, on) => {
  grepAnswers(on, ONE_OPEN_INCIDENT)
  const reached: string[] = []
  on('tool.call', { tool: 'Workflow' }, (_, e) => {
    reached.push(e.name ?? '')
    return { deny: 'unreachable' }
  })

  const answered = await $.tool.call({ tool: 'Workflow', name: 'phase', args: { phase: 'P2' } })

  expect(answered.text ?? answered.deny).toContain('retro pending')
  expect(reached).toEqual([])
})

test('the plugin-prefixed implementer is gated too', async ($, on) => {
  grepAnswers(on, ONE_OPEN_INCIDENT)
  on('tool.call', { tool: 'Agent' }, () => ({ deny: 'unreachable' }))

  const answered = await $.tool.call({ tool: 'Agent', description: 'build', prompt: 'build it', subagent_type: 'ouroboros:implementer' })

  expect(answered.text ?? answered.deny).toContain('retro pending')
})

test('an implementer runs when no incident is open', async ($, on) => {
  grepAnswers(on, '')
  const reached: string[] = []
  on('tool.call', { tool: 'Agent' }, (_, e) => {
    reached.push(e.description)
    return { deny: 'reached the engine' }
  })

  await $.tool.call({ tool: 'Agent', description: 'build', prompt: 'build it', subagent_type: 'implementer' })

  expect(reached).toEqual(['build'])
})
