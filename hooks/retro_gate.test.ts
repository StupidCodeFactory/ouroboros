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
  on('fs.exists', () => ({ value: false }))

  await $.tool.call({ tool: 'Bash', command: 'git commit -m "phase(P1): add invoice export"' })

  expect(spawned).toHaveLength(1)
  expect(spawned[0]).toMatchObject({ subagent_type: 'ouroboros:skill-curator', run_in_background: true })
  expect(toasts).toEqual(['retro started'])
})

const PLAN_WITH_OPEN_P0 = [
  '### Task 4: delete the clean_unmonitored task (P0)',
  '- [x] Step 5: commit',
  '### Task 17: One month-range helper (P0)',
  '- [ ] Step 1: write the failing spec',
].join('\n')

test('a phase commit made while that phase still has open plan boxes starts no retro', async ($, on) => {
  const spawned: object[] = []
  on('agent.spawn', (_, e) => {
    spawned.push(e)
    return { model: 'fable', agentId: 'curator-1' }
  })
  const files: Record<string, string> = {
    '.claude/ouroboros/state.json': JSON.stringify({ milestone: 'M1', drafts: { spec: 'specs/m1.md', plan: 'plans/m1.md' } }),
    '.claude/ouroboros.json': JSON.stringify({ drafts_dir: 'docs/drafts' }),
    'docs/drafts/plans/m1.md': PLAN_WITH_OPEN_P0,
  }
  const fileAt = (path: string) => Object.entries(files).find(([name]) => path.endsWith(name))?.[1]
  on('fs.exists', (_, e) => ({ value: fileAt(e.path) !== undefined }))
  on('fs.read', (_, e) => ({ value: fileAt(e.path) ?? '' }))
  grepAnswers(on, '/repo/.git\n')
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))

  await $.tool.call({ tool: 'Bash', command: 'git commit -m "phase(P0): delete clean_unmonitored and its rake task"' })

  expect(spawned).toEqual([])
})

test('merging a phase PR starts no second retro and accepts no ADRs', async ($, on) => {
  const spawned: object[] = []
  on('agent.spawn', (_, e) => {
    spawned.push(e)
    return { model: 'fable', agentId: 'curator-1' }
  })
  const state = JSON.stringify({ milestone: 'M1', status: 'phase', current: 'P0' })
  on('fs.exists', (_, e) => ({ value: e.path.endsWith('.claude/ouroboros/state.json') }))
  on('fs.read', () => ({ value: state }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))

  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 12 --merge' })

  expect(spawned).toEqual([])
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

test('the plugin-prefixed phase workflow is gated too', async ($, on) => {
  grepAnswers(on, ONE_OPEN_INCIDENT)
  on('tool.call', { tool: 'Workflow' }, () => ({ deny: 'unreachable' }))

  const answered = await $.tool.call({ tool: 'Workflow', name: 'ouroboros:phase', args: { phase: 'P2' } })

  expect(answered.text ?? answered.deny).toContain('retro pending')
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
