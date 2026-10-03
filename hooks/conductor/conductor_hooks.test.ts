import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

const COMPOSER = { kind: 'composer' as const }
const PRESENTATION = { isFullscreen: false, columns: 80 }
const NOTIFICATION = { kind: 'task-notification' as const }
const CONFIG = JSON.stringify({ drafts_dir: 'docs/drafts' })
const PLAN = ['### Task 1: a (P0)', '- [x] done', '### Task 2: b (P1)', '- [ ] open'].join('\n')

const run = ($: Parameters<TestBody>[0], args: string) =>
  $.command.run({ command: 'ouroboros', args, origin: COMPOSER, presentation: PRESENTATION })

const worldBeneath = (on: On, files: Record<string, string>) => {
  const disk = new Map(Object.entries(files))
  const fileAt = (path: string) => [...disk.entries()].find(([name]) => path.endsWith(name))?.[1]
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/repo/.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.exists', (_, e) => ({ value: fileAt(e.path) !== undefined }))
  on('fs.read', (_, e) => ({ value: fileAt(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    disk.set(e.path.slice(e.path.indexOf('.claude/')), e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.receive', (_, e) => ({ text: e.text }))
  return disk
}

const stateOn = (disk: Map<string, string>) => JSON.parse(disk.get('.claude/ouroboros/state.json') ?? '{}')

const phaseInFlight = JSON.stringify({
  milestone: 'M1', phases: ['P0', 'P1'], current: 'P0', status: 'phase', escalations: [], results: {},
  drafts: { spec: 'specs/m1.md', plan: 'plans/m1.md' }, run: { id: 'wf-1', workflow: 'phase' },
})

test('/ouroboros kickoff stores the drafts and hands the milestone-kickoff launch to the model', async ($, on) => {
  const disk = worldBeneath(on, { '.claude/ouroboros.json': CONFIG, '/repo/docs/drafts/plans/m1.md': PLAN })

  const answered = await run($, 'kickoff M1 specs/m1.md plans/m1.md ship the loop')

  const args = { milestone: 'M1', goal: 'ship the loop', spec: 'specs/m1.md', plan: 'plans/m1.md' }
  expect(answered.text).toBe(`spec: specs/m1.md\nplan: plans/m1.md\nlaunch now: Workflow name=milestone-kickoff args=${JSON.stringify(args)} (or later with /ouroboros resume)`)
  expect(stateOn(disk)).toMatchObject({ milestone: 'M1', phases: ['P0', 'P1'], status: 'kickoff', drafts: { spec: 'specs/m1.md', plan: 'plans/m1.md' }, pending: { workflow: 'milestone-kickoff', args } })
})

test('/ouroboros kickoff with only a milestone discovers the plan and its spec under drafts_dir', async ($, on) => {
  const files = { 'work/loop.md': ['# M1 plan', '**Spec:** `design/loop-design.md`', PLAN].join('\n'), 'design/loop-design.md': '# design' }
  const disk = new Map<string, string>([['.claude/ouroboros.json', CONFIG]])
  on('process.run', (_, e) => {
    const stdout = e.argv[0] === 'sh' ? Object.keys(files).map(path => `./${path}`).join('\n') : '/repo/.git\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const fileAt = (path: string) => [...disk.entries()].find(([name]) => path.endsWith(name))?.[1] ?? Object.entries(files).find(([name]) => path.endsWith(`/${name}`))?.[1]
  on('fs.exists', (_, e) => ({ value: fileAt(e.path) !== undefined }))
  on('fs.read', (_, e) => ({ value: fileAt(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    disk.set(e.path.slice(e.path.indexOf('.claude/')), e.text)
    return { value: undefined }
  })

  const answered = await run($, 'kickoff M1')

  expect(answered.text).toContain('spec: design/loop-design.md\nplan: work/loop.md')
  expect(stateOn(disk)).toMatchObject({ milestone: 'M1', drafts: { spec: 'design/loop-design.md', plan: 'work/loop.md' } })
})

test('/ouroboros kickoff without a project config says how to create one and launches nothing', async ($, on) => {
  const disk = worldBeneath(on, {})

  const answered = await run($, 'kickoff M1')

  expect(answered.text).toContain('no .claude/ouroboros.json')
  expect(disk.has('.claude/ouroboros/state.json')).toBe(false)
})

test('/ouroboros kickoff passes the configured per-stage effort map in the launch args', async ($, on) => {
  const effort = { brief: 'high', checkpoint: 'low' }
  const disk = worldBeneath(on, { '.claude/ouroboros.json': JSON.stringify({ drafts_dir: 'docs/drafts', effort }), '/repo/docs/drafts/plans/m1.md': PLAN })

  const answered = await run($, 'kickoff M1 specs/m1.md plans/m1.md')

  expect(answered.text).toContain('"effort":{"brief":"high","checkpoint":"low"}')
  expect(stateOn(disk).pending.args.effort).toEqual(effort)
})

test('the Workflow call the model makes records the run and clears the pending launch', async ($, on) => {
  const pending = { workflow: 'milestone-kickoff', args: { milestone: 'M1' } }
  const disk = worldBeneath(on, { '.claude/ouroboros/state.json': JSON.stringify({ milestone: 'M1', status: 'kickoff', pending }) })
  on('tool.call', { tool: 'Workflow' }, () => ({ result: { status: 'async_launched' as const, taskId: 'wf-k' } }))

  await $.tool.call({ tool: 'Workflow', name: 'milestone-kickoff', args: pending.args })

  expect(stateOn(disk)).toMatchObject({ run: { id: 'wf-k', workflow: 'milestone-kickoff' } })
  expect(stateOn(disk).pending).toBeUndefined()
})

const KICKOFF_OUTPUT_FILE = '/private/tmp/claude-501/-repo/c16ef1c5/tasks/wpsy5r9zt.output'

const KICKOFF_NOTIFICATION = [
  '<task-notification>',
  '<task-id>wpsy5r9zt</task-id>',
  '<tool-use-id>toolu_0177gkCw8AMtXBK4VXKz6xTd</tool-use-id>',
  `<output-file>${KICKOFF_OUTPUT_FILE}</output-file>`,
  '<status>completed</status>',
  '<summary>Dynamic workflow "Milestone kickoff: architect brief and decisions, planner appends the phase-tagged tasks, auditor writes the checks red" completed</summary>',
  '<result>{"brief":"M1 Foundations design brief (P0, P1). Branch milestone/m1-foundations.\\n\\n- Code comments.\\n- else after return, or nested if/else.\\n- New rubocop offe',
  `... (truncated 25759 chars, full result in ${KICKOFF_OUTPUT_FILE})</result>`,
  '<diagnostics>Per-agent results: /repo/subagents/workflows/wf_0b761a2a-26f/journal.jsonl — one {"type":"result",...} line per completed agent with its full return value.',
  'To re-run with edited post-processing: Workflow({scriptPath: \'/repo/workflows/scripts/milestone-kickoff-wf_0b761a2a-26f.js\', resumeFromRunId: \'wf_0b761a2a-26f\', args: {"milestone":"M1","effort":{"brief":"high"}}}) — agents whose (prompt, opts) are unchanged replay from cache.</diagnostics>',
  '<usage><agent_count>3</agent_count><agents_done>3</agents_done><agents_error>0</agents_error></usage>',
  '</task-notification>',
].join('\n')

const KICKOFF_OUTPUT = JSON.stringify({
  summary: 'Milestone kickoff: architect brief and decisions, planner appends the phase-tagged tasks, auditor writes the checks red',
  agentCount: 3,
  logs: [],
  result: {
    brief: 'M1 Foundations design brief (P0, P1). Branch milestone/m1-foundations.',
    decisions: [{ title: 'one-import-queue: one ImportQueue and one ImportDrain fiber pool with unit kinds', rationale: 'one drain' }],
    phases: ['P0', 'P1'],
    checks: ['rspec m1: owners API answers an unknown symbol with every month null -- red: 404'],
    red: true,
  },
  totalTokens: 442888,
  totalToolCalls: 140,
})

const kickoffInFlight = JSON.stringify({
  milestone: 'M1', phases: ['P0', 'P1'], current: null, status: 'kickoff', escalations: [], results: {},
  drafts: { spec: 'specs/m1.md', plan: 'plans/m1.md' }, run: { id: 'wpsy5r9zt', workflow: 'milestone-kickoff' },
})

test('the plugin-prefixed Workflow call the model makes records the run', async ($, on) => {
  const pending = { workflow: 'milestone-kickoff', args: { milestone: 'M1' } }
  const disk = worldBeneath(on, { '.claude/ouroboros/state.json': JSON.stringify({ milestone: 'M1', status: 'kickoff', pending }) })
  on('tool.call', { tool: 'Workflow' }, () => ({ result: { status: 'async_launched' as const, taskId: 'wpsy5r9zt', workflowName: 'milestone-kickoff' } }))

  await $.tool.call({ tool: 'Workflow', name: 'ouroboros:milestone-kickoff', args: pending.args })

  expect(stateOn(disk)).toMatchObject({ run: { id: 'wpsy5r9zt', workflow: 'milestone-kickoff' } })
  expect(stateOn(disk).pending).toBeUndefined()
})

test('the real kickoff notification reads the full result from its output file and queues phase P0', async ($, on) => {
  const disk = worldBeneath(on, {
    '.claude/ouroboros.json': CONFIG,
    '.claude/ouroboros/state.json': kickoffInFlight,
    '/repo/docs/drafts/plans/m1.md': PLAN,
    [KICKOFF_OUTPUT_FILE]: KICKOFF_OUTPUT,
  })
  on('agent.spawn', () => ({ model: 'fable', agentId: 'scribe-1' }))

  const delivered = await $.session.receive({ origin: NOTIFICATION, text: KICKOFF_NOTIFICATION })

  expect(delivered.text).toContain('Workflow name=phase')
  expect(stateOn(disk)).toMatchObject({
    status: 'phase',
    current: 'P0',
    brief: 'M1 Foundations design brief (P0, P1). Branch milestone/m1-foundations.',
    pending: { workflow: 'phase', args: { milestone: 'M1', phase: 'P0' } },
  })
  expect(stateOn(disk).run).toBeUndefined()
  expect(disk.get('.claude/ouroboros/results/wpsy5r9zt.json')).toContain('"red":true')
})

test('a missing workflow leaves the launch pending and nothing throws', async ($, on) => {
  const pending = { workflow: 'milestone-kickoff', args: { milestone: 'M1' } }
  const disk = worldBeneath(on, { '.claude/ouroboros/state.json': JSON.stringify({ milestone: 'M1', status: 'kickoff', pending }) })
  on('tool.call', { tool: 'Workflow' }, () => ({ deny: 'no workflow named milestone-kickoff' }))

  const answered = await $.tool.call({ tool: 'Workflow', name: 'milestone-kickoff', args: pending.args })

  expect(answered.deny ?? answered.text).toContain('no workflow named milestone-kickoff')
  expect(stateOn(disk).pending).toEqual(pending)
})

test('a checkpointed phase notification is filed, starts the retro and is consumed', async ($, on) => {
  const disk = worldBeneath(on, { '.claude/ouroboros.json': CONFIG, '.claude/ouroboros/state.json': phaseInFlight, '/repo/docs/drafts/plans/m1.md': PLAN })
  const spawned: object[] = []
  on('agent.spawn', (_, e) => {
    spawned.push(e)
    return { model: 'fable', agentId: 'curator-1' }
  })

  const delivered = await $.session.receive({ origin: NOTIFICATION, text: 'Task wf-1 completed: {"status":"checkpointed","tasks":[]}' })

  expect(delivered.consumed).toContain('ouroboros')
  expect(disk.get('.claude/ouroboros/results/wf-1.json')).toContain('checkpointed')
  expect(spawned).toHaveLength(1)
  expect(stateOn(disk)).toMatchObject({ status: 'retro', results: { P0: '.claude/ouroboros/results/wf-1.json' }, run: { workflow: 'retro' } })
})

test('an escalating phase notification reaches the main session as one line', async ($, on) => {
  worldBeneath(on, { '.claude/ouroboros.json': CONFIG, '.claude/ouroboros/state.json': phaseInFlight })

  const delivered = await $.session.receive({ origin: NOTIFICATION, text: 'Task wf-1 completed: {"status":"escalate"}' })

  expect(delivered.text).toBe('M1 P0 escalated: see .claude/ouroboros/results/wf-1.json')
})

test('a notification for something else passes through untouched', async ($, on) => {
  worldBeneath(on, { '.claude/ouroboros/state.json': phaseInFlight })

  const delivered = await $.session.receive({ origin: NOTIFICATION, text: 'Agent researcher finished' })

  expect(delivered.text).toBe('Agent researcher finished')
})

test('status, pause, resume and escalations answer from state.json', async ($, on) => {
  const disk = worldBeneath(on, { '.claude/ouroboros.json': CONFIG, '.claude/ouroboros/state.json': phaseInFlight, '/repo/docs/drafts/plans/m1.md': PLAN })
  const spawned: object[] = []
  on('agent.spawn', (_, e) => {
    spawned.push(e)
    return { model: 'fable', agentId: 'curator-1' }
  })

  expect((await run($, 'status')).text).toContain('ouroboros M1 · phase P0')
  expect((await run($, 'escalations')).text).toBe('no escalations')
  await run($, 'pause')
  const held = await $.session.receive({ origin: NOTIFICATION, text: 'wf-1 {"status":"checkpointed"}' })
  expect(held.consumed).toBeDefined()
  expect(stateOn(disk)).toMatchObject({ paused: true, status: 'retro', pending: { workflow: 'retro' } })
  expect(spawned).toEqual([])

  const resumed = await run($, 'resume')
  expect(resumed.text).toBe('resumed')
  expect(spawned).toHaveLength(1)
  expect(stateOn(disk)).toMatchObject({ paused: false, run: { workflow: 'retro' } })

  const woken = await $.session.receive({ origin: NOTIFICATION, text: 'retro done, fixed 0' })
  expect(woken.text).toContain('Workflow name=phase')
  expect(stateOn(disk)).toMatchObject({ status: 'phase', current: 'P1', pending: { workflow: 'phase', args: { phase: 'P1' } } })
})

test('the loop header rides on the prompt context', async ($, on) => {
  worldBeneath(on, { '.claude/ouroboros/state.json': phaseInFlight })
  on('prompt.context', (_, e) => ({ blocks: e.blocks }))

  const { blocks } = await $.prompt.context({ blocks: [{ name: 'currentDate', text: '2026-10-03' }] })

  expect(blocks.map(block => block.name)).toEqual(['currentDate', 'ouroboros'])
  expect(blocks[1]?.text.split('\n')).toHaveLength(3)
})

test('an oversized Bash result is filed and digested', async ($, on) => {
  const disk = worldBeneath(on, {})
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'x'.repeat(5000), stderr: '', interrupted: false } }))

  const answered = await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'use-9' })

  expect((answered.result as { stdout: string }).stdout).toContain('.claude/ouroboros/results/use-9.json')
  expect(disk.get('.claude/ouroboros/results/use-9.json')).toContain('xxxx')
})
