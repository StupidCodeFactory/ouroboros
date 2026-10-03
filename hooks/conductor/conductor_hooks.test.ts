import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

const COMPOSER = { kind: 'composer' as const }
const PRESENTATION = { isFullscreen: false, columns: 80 }
const NOTIFICATION = { kind: 'task-notification' as const }
const NO_EAGER_SKILLS = { eager_skills: [] }
const CONFIG = JSON.stringify({
  drafts_dir: 'docs/drafts',
  agents: { architect: NO_EAGER_SKILLS, auditor: NO_EAGER_SKILLS, reviewer: NO_EAGER_SKILLS, implementer: NO_EAGER_SKILLS },
})
const PLAN = ['### Task 1: a (P0)', '- [x] done', '### Task 2: b (P1)', '- [ ] open'].join('\n')

const run = ($: Parameters<TestBody>[0], args: string) =>
  $.command.run({ command: 'ouroboros', args, origin: COMPOSER, presentation: PRESENTATION })

const worldBeneath = (on: On, files: Record<string, string>, sent: string[] = []) => {
  const disk = new Map(Object.entries(files))
  mock.env(on, { HOME: '/home' })
  const fileAt = (path: string) => [...disk.entries()].find(([name]) => path.endsWith(name))?.[1]
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/repo/.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.exists', (_, e) => ({ value: fileAt(e.path) !== undefined }))
  on('fs.read', (_, e) => ({ value: fileAt(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    disk.set(e.path.includes('.claude/') ? e.path.slice(e.path.indexOf('.claude/')) : e.path, e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.receive', (_, e) => ({ text: e.text }))
  on('session.id', () => ({ value: 'main-session' }))
  on('session.send', (_, e) => {
    sent.push(e.text)
    return { isDelivered: true as const }
  })
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
  on('session.id', () => ({ value: 'main-session' }))
  on('session.send', () => ({ isDelivered: true as const }))

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

test('/ouroboros kickoff submits the launch line to the model so nobody has to relay it', async ($, on) => {
  const submitted: string[] = []
  worldBeneath(on, { '.claude/ouroboros.json': CONFIG, '/repo/docs/drafts/plans/m1.md': PLAN }, submitted)

  await run($, 'kickoff M1 specs/m1.md plans/m1.md ship the loop')

  expect(submitted).toHaveLength(1)
  expect(submitted[0]).toContain('Workflow name=milestone-kickoff args={"milestone":"M1"')
})

test('/ouroboros resume submits the queued launch to the model', async ($, on) => {
  const pending = { workflow: 'phase', args: { milestone: 'M1', phase: 'P1' } }
  const submitted: string[] = []
  worldBeneath(on, { '.claude/ouroboros/state.json': JSON.stringify({ milestone: 'M1', status: 'phase', paused: true, pending }) }, submitted)

  await run($, 'resume')

  expect(submitted).toEqual([expect.stringContaining('Workflow name=phase args={"milestone":"M1","phase":"P1","merge_policy":"ask"}')])
})

test('/ouroboros status submits nothing', async ($, on) => {
  const submitted: string[] = []
  worldBeneath(on, { '.claude/ouroboros/state.json': phaseInFlight }, submitted)

  await run($, 'status')

  expect(submitted).toEqual([])
})

test('the loop header names the pending launch as the Workflow call to make', async ($, on) => {
  const pending = { workflow: 'phase', args: { phase: 'P1' } }
  worldBeneath(on, { '.claude/ouroboros/state.json': JSON.stringify({ milestone: 'M1', status: 'phase', pending }) })
  on('prompt.context', (_, e) => ({ blocks: e.blocks }))

  const { blocks } = await $.prompt.context({ blocks: [] })

  expect(blocks[0]?.text).toContain('pending launch: Workflow name=phase args={"phase":"P1"}')
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
  const disk = worldBeneath(on, { '.claude/ouroboros.json': CONFIG, '.claude/ouroboros/state.json': JSON.stringify({ milestone: 'M1', status: 'kickoff', pending }) })
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
  const disk = worldBeneath(on, { '.claude/ouroboros.json': CONFIG, '.claude/ouroboros/state.json': JSON.stringify({ milestone: 'M1', status: 'kickoff', pending }) })
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
    brief_path: '/repo/.git/.claude/ouroboros/briefs/M1.md',
    pending: { workflow: 'phase', args: { milestone: 'M1', phase: 'P0', brief_path: '/repo/.git/.claude/ouroboros/briefs/M1.md' } },
  })
  expect(stateOn(disk).pending.args.brief).toBeUndefined()
  expect(disk.get('.claude/ouroboros/briefs/M1.md')).toBe('M1 Foundations design brief (P0, P1). Branch milestone/m1-foundations.')
  expect(stateOn(disk).run).toBeUndefined()
  expect(disk.get('.claude/ouroboros/results/wpsy5r9zt.json')).toContain('"red":true')
})

test('a kickoff result\'s process findings are filed as incidents like a phase\'s', async ($, on) => {
  const outputFile = '/tmp/tasks/kickoff-findings.output'
  const brief = { common: 'c', tasks: [] }
  const finding = { root_cause: 'skill-misread', skill: 'pipeline-invariants', summary: 'the planner read the invariants skill as optional' }
  const disk = worldBeneath(on, {
    '.claude/ouroboros.json': CONFIG,
    '.claude/ouroboros/state.json': kickoffInFlight,
    '/repo/docs/drafts/plans/m1.md': PLAN,
    [outputFile]: JSON.stringify({ result: { brief, decisions: [], phases: ['P0', 'P1'], checks: [], red: true, findings: [finding] } }),
  })
  mock.clock(on, { now: Date.UTC(2026, 9, 3) })

  await $.session.receive({ origin: NOTIFICATION, text: `<task-notification>\n<task-id>wpsy5r9zt</task-id>\n<output-file>${outputFile}</output-file>\n</task-notification>` })

  expect(disk.get('.claude/skills/pipeline-invariants/incidents.md')).toContain('the planner read the invariants skill as optional')
})

test('a sliced kickoff brief is filed per task and the phase gets the directory and each task\'s touches', async ($, on) => {
  const outputFile = '/tmp/tasks/sliced.output'
  const brief = { common: 'Forbidden: new .instance callers.', tasks: [{ id: '1', guidance: 'Put it in lib/a.rb.', touches: ['lib/a.rb'] }] }
  const disk = worldBeneath(on, {
    '.claude/ouroboros.json': CONFIG,
    '.claude/ouroboros/state.json': kickoffInFlight,
    '/repo/docs/drafts/plans/m1.md': PLAN.replace('- [x] done', '- [ ] open'),
    [outputFile]: JSON.stringify({ result: { brief, decisions: [], phases: ['P0', 'P1'], checks: [], red: true } }),
  })

  await $.session.receive({ origin: NOTIFICATION, text: `<task-notification>\n<task-id>wpsy5r9zt</task-id>\n<output-file>${outputFile}</output-file>\n<status>completed</status>\n</task-notification>` })

  expect(disk.get('.claude/ouroboros/briefs/M1/common.md')).toBe('Forbidden: new .instance callers.\n')
  expect(disk.get('.claude/ouroboros/briefs/M1/1.md')).toBe('Put it in lib/a.rb.\n\nTouches:\n- lib/a.rb\n')
  expect(stateOn(disk).pending.args).toMatchObject({ brief_dir: '/repo/.git/.claude/ouroboros/briefs/M1', tasks: [{ id: '1', touches: ['lib/a.rb'] }] })
})

test('the kickoff decisions open Proposed ADRs through the scribe, since no architect Agent call carries them', async ($, on) => {
  worldBeneath(on, {
    '.claude/ouroboros.json': CONFIG,
    '.claude/ouroboros/state.json': kickoffInFlight,
    '/repo/docs/drafts/plans/m1.md': PLAN,
    [KICKOFF_OUTPUT_FILE]: KICKOFF_OUTPUT,
  })
  const spawned: Array<{ subagent_type?: string; prompt?: string }> = []
  on('agent.spawn', (_, e) => {
    spawned.push(e as { subagent_type?: string; prompt?: string })
    return { model: 'fable', agentId: 'scribe-1' }
  })

  await $.session.receive({ origin: NOTIFICATION, text: KICKOFF_NOTIFICATION })

  expect(spawned).toHaveLength(1)
  expect(spawned[0]).toMatchObject({ subagent_type: 'ouroboros:adr-scribe' })
  expect(spawned[0]?.prompt).toContain('open Proposed ADRs')
  expect(spawned[0]?.prompt).toContain('one-import-queue')
})

test('a missing workflow leaves the launch pending and nothing throws', async ($, on) => {
  const pending = { workflow: 'milestone-kickoff', args: { milestone: 'M1' } }
  const disk = worldBeneath(on, { '.claude/ouroboros.json': CONFIG, '.claude/ouroboros/state.json': JSON.stringify({ milestone: 'M1', status: 'kickoff', pending }) })
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

test('a workflow notification that arrives as a prompt is filed and dropped, since local task notifications never pass session.receive', async ($, on) => {
  const disk = worldBeneath(on, { '.claude/ouroboros.json': CONFIG, '.claude/ouroboros/state.json': phaseInFlight, '/repo/docs/drafts/plans/m1.md': PLAN })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('agent.spawn', () => ({ model: 'fable', agentId: 'curator-1' }))

  const submitted = await $.prompt.submit({ text: '<task-notification>\n<task-id>wf-1</task-id>\n<status>completed</status>\n<result>{"status":"checkpointed","tasks":[]}</result>\n</task-notification>', wait: false, origin: NOTIFICATION })

  expect(submitted.drop).toContain('ouroboros')
  expect(stateOn(disk)).toMatchObject({ status: 'retro', results: { P0: '.claude/ouroboros/results/wf-1.json' }, run: { workflow: 'retro' } })
})

const SKILL_GAP = { root_cause: 'skill-gap', skill: 'pipeline-invariants', blocking: false, summary: 'no spec checks the fail-loudly raise' }

test('/ouroboros collect files a missed result of the in-flight run as if its notification had arrived', async ($, on) => {
  const outputFile = '/tmp/tasks/wf-1.output'
  const output = JSON.stringify({ result: { status: 'checkpointed', phase: 'P0', tasks: [{ id: '1', status: 'done', findings: [SKILL_GAP] }] } })
  const disk = worldBeneath(on, { '.claude/ouroboros.json': CONFIG, '.claude/ouroboros/state.json': phaseInFlight, '/repo/docs/drafts/plans/m1.md': PLAN, [outputFile]: output })
  on('agent.spawn', () => ({ model: 'fable', agentId: 'curator-1' }))
  mock.clock(on, { now: Date.UTC(2026, 9, 3) })

  const answered = await run($, `collect ${outputFile}`)

  expect(answered.text).toContain('wf-1')
  expect(disk.get('.claude/skills/pipeline-invariants/incidents.md')).toContain('no spec checks the fail-loudly raise')
  expect(stateOn(disk)).toMatchObject({ status: 'retro', results: { P0: '.claude/ouroboros/results/wf-1.json' }, run: { workflow: 'retro' } })
})

test('/ouroboros collect of a run that is not in flight files only its incidents and leaves the state alone', async ($, on) => {
  const outputFile = '/tmp/tasks/old-p0.output'
  const output = JSON.stringify({ result: { status: 'checkpointed', phase: 'P0', tasks: [{ id: '1', status: 'done', findings: [SKILL_GAP] }] } })
  const disk = worldBeneath(on, { '.claude/ouroboros.json': CONFIG, '.claude/ouroboros/state.json': phaseInFlight, [outputFile]: output })
  mock.clock(on, { now: Date.UTC(2026, 9, 3) })

  const answered = await run($, `collect ${outputFile}`)

  expect(answered.text).toBe('old-p0 is not the run in flight: filed its 1 incident, state unchanged')
  expect(disk.get('.claude/skills/pipeline-invariants/incidents.md')).toContain('| P0 |')
  expect(disk.get('.claude/ouroboros/state.json')).toBe(phaseInFlight)
})

test('follow-ups a phase raised outside a task diff are appended to the plan as unchecked boxes', async ($, on) => {
  const outputFile = '/tmp/tasks/wf-1.output'
  const followUp = { reviewer: 'reviewer', file: 'lib/shop/backfill/runner.rb', line: 163, summary: 'Untouched callers still reach the singleton through .instance.', blocking: true }
  const output = JSON.stringify({ result: { status: 'checkpointed', phase: 'P0', tasks: [{ id: '3', status: 'done' }], follow_ups: [{ ...followUp, task: '3' }] } })
  const disk = worldBeneath(on, {
    '.claude/ouroboros.json': CONFIG,
    '.claude/ouroboros/state.json': phaseInFlight,
    '/repo/docs/drafts/plans/m1.md': PLAN,
    [outputFile]: output,
  })
  on('agent.spawn', () => ({ model: 'fable', agentId: 'curator-1' }))

  await $.session.receive({ origin: NOTIFICATION, text: `<task-notification>\n<task-id>wf-1</task-id>\n<output-file>${outputFile}</output-file>\n<status>completed</status>\n</task-notification>` })

  expect(disk.get('/repo/docs/drafts/plans/m1.md')).toBe(
    `${PLAN}\n### Task 3-P0-follow-ups: follow-ups raised while reviewing P0 task 3 (P1)\n- [ ] Untouched callers still reach the singleton through .instance. (lib/shop/backfill/runner.rb:163, raised by reviewer)\n`,
  )
  expect(stateOn(disk)).toMatchObject({ status: 'retro' })
})

test('a finished phase files its skill and agent findings as incidents, then starts the retro', async ($, on) => {
  const outputFile = '/tmp/tasks/p0.output'
  const findings = [
    { root_cause: 'skill-gap', skill: 'pipeline-invariants', agent: null, blocking: false, file: 'lib/shop/backfill/dashboard_client.rb', line: 50, summary: 'no spec checks the fail-loudly raise' },
    { root_cause: 'agent-behaviour', skill: null, agent: 'auditor', blocking: false, file: '/repo/.git/.claude/agent-memory/auditor.md', line: 13, summary: 'memory points at renamed spec files' },
    { root_cause: 'code-bug', blocking: true, file: 'lib/shop/gap_source_planner.rb', line: 19, summary: 'still .instance' },
  ]
  const output = JSON.stringify({ result: { status: 'checkpointed', phase: 'P0', tasks: [{ id: '2', status: 'done', findings }] } })
  const disk = worldBeneath(on, {
    '.claude/ouroboros.json': CONFIG,
    '.claude/ouroboros/state.json': phaseInFlight,
    '/repo/docs/drafts/plans/m1.md': PLAN,
    [outputFile]: output,
  })
  mock.clock(on, { now: Date.UTC(2026, 9, 3) })
  const spawned: Array<{ subagent_type?: string }> = []
  on('agent.spawn', (_, e) => {
    spawned.push(e as { subagent_type?: string })
    return { model: 'fable', agentId: 'curator-1' }
  })

  await $.session.receive({ origin: NOTIFICATION, text: `<task-notification>\n<task-id>wf-1</task-id>\n<output-file>${outputFile}</output-file>\n<status>completed</status>\n</task-notification>` })

  expect(disk.get('.claude/skills/pipeline-invariants/incidents.md')).toContain('| P0 |  | skill-gap | | no spec checks the fail-loudly raise | lib/shop/backfill/dashboard_client.rb:50 | open | |')
  const agentLog = [...disk.entries()].find(([path]) => path.endsWith('/auditor.md'))?.[1]
  expect(agentLog).toContain('| P0 | auditor | agent-behaviour | | memory points at renamed spec files | .claude/agent-memory/auditor.md:13 | open | |')
  expect([...disk.entries()].some(([path, text]) => path.includes('incidents') && text.includes('still .instance'))).toBe(false)
  expect(spawned.map(spawn => spawn.subagent_type)).toEqual(['ouroboros:skill-curator'])
  expect(stateOn(disk)).toMatchObject({ status: 'retro', run: { workflow: 'retro' } })
})

test('a phase reported checkpointed with no phase commit on the branch escalates instead of moving on', async ($, on) => {
  const disk = new Map<string, string>([['.claude/ouroboros.json', CONFIG], ['.claude/ouroboros/state.json', phaseInFlight], ['/repo/docs/drafts/plans/m1.md', PLAN]])
  const fileAt = (path: string) => [...disk.entries()].find(([name]) => path.endsWith(name))?.[1]
  mock.env(on, { HOME: '/home' })
  on('process.run', (_, e) => {
    const stdout = e.argv.some(arg => arg.startsWith('--grep=')) ? '' : '/repo/.git\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', (_, e) => ({ value: fileAt(e.path) !== undefined }))
  on('fs.read', (_, e) => ({ value: fileAt(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    disk.set(e.path.includes('.claude/') ? e.path.slice(e.path.indexOf('.claude/')) : e.path, e.text)
    return { value: undefined }
  })
  on('session.receive', (_, e) => ({ text: e.text }))
  on('agent.spawn', () => ({ model: 'fable', agentId: 'curator-1' }))

  const delivered = await $.session.receive({ origin: NOTIFICATION, text: 'Task wf-1 completed: {"status":"checkpointed","phase":"P0","tasks":[]}' })

  expect(delivered.text).toContain('M1 P0 escalated')
  expect(stateOn(disk)).toMatchObject({
    status: 'escalated',
    escalations: [{ phase: 'P0', summary: 'P0: the workflow reported checkpointed but no phase(P0) commit is on the branch' }],
  })
})

test('an escalating phase notification reaches the main session as one line', async ($, on) => {
  worldBeneath(on, { '.claude/ouroboros.json': CONFIG, '.claude/ouroboros/state.json': phaseInFlight })
  on('agent.spawn', () => ({ model: 'fable', agentId: 'curator-1' }))

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

  expect((await run($, 'status')).text).toContain('ouroboros · M1 · phase\n\nphase  state\n-----  -------\nP0     running\nP1     queued')
  expect((await run($, 'escalations')).text).toBe('no escalations')
  await run($, 'pause')
  const held = await $.session.receive({ origin: NOTIFICATION, text: 'wf-1 {"status":"checkpointed"}' })
  expect(held.consumed).toBeDefined()
  expect(stateOn(disk)).toMatchObject({ paused: true, status: 'retro', pending: { workflow: 'retro' } })
  expect(spawned).toEqual([])

  const resumed = await run($, 'resume')
  expect(resumed.text).toBe('resumed: launched')
  expect(spawned).toHaveLength(1)
  expect(stateOn(disk)).toMatchObject({ paused: false, run: { workflow: 'retro' } })

  const woken = await $.session.receive({ origin: NOTIFICATION, text: 'retro done, fixed 0' })
  expect(woken.text).toContain('Workflow name=phase')
  expect(stateOn(disk)).toMatchObject({ status: 'phase', current: 'P1', pending: { workflow: 'phase', args: { phase: 'P1' } } })
})

test('/ouroboros resume drops a kickoff and a phase that already ran and offers the first open phase', async ($, on) => {
  const plan = ['### Task 2: Verify dashboard holes (P0)', '- [x] Step 1: verify', '### Task 5: New event messages (P1)', '- [ ] Step 1: failing golden spec'].join('\n')
  const stuck = JSON.stringify({
    milestone: 'M1', phases: ['P0', 'P1'], current: null, status: 'kickoff', escalations: [], results: {},
    drafts: { spec: 'specs/2026-10-03-unified-ingestion-loop-design.md', plan: 'plans/m1.md' },
    pending: { workflow: 'milestone-kickoff', args: { milestone: 'M1', goal: 'build the unified ingestion loop foundations' } },
  })
  const disk = new Map<string, string>([
    ['.claude/ouroboros.json', CONFIG],
    ['.claude/ouroboros/state.json', stuck],
    ['/repo/docs/drafts/plans/m1.md', plan],
    ['/project/.claude/ouroboros/briefs/M1.md', '# M1 brief'],
  ])
  const fileAt = (path: string) => [...disk.entries()].find(([name]) => path.endsWith(name))?.[1]
  mock.env(on, { HOME: '/home' })
  on('process.run', (_, e) => {
    const argv = e.argv.join(' ')
    const stdout = argv.includes('--show-toplevel') ? '/project\n' : argv.includes('--grep=^phase(P0):') ? '4bdf974\n' : argv.includes('--git-common-dir') ? '/repo/.git\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', (_, e) => ({ value: fileAt(e.path) !== undefined }))
  on('fs.read', (_, e) => ({ value: fileAt(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    disk.set(e.path.includes('.claude/') ? e.path.slice(e.path.indexOf('.claude/')) : e.path, e.text)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'main-session' }))
  on('session.send', () => ({ isDelivered: true as const }))

  const resumed = await run($, 'resume')

  expect(resumed.text).toContain('dropped milestone-kickoff: its brief exists at .claude/ouroboros/briefs/M1.md and every plan phase (P0, P1) already carries tasks')
  expect(resumed.text).toContain('dropped phase P0: a phase(P0) commit is on the branch and none of its plan boxes is open')
  expect(resumed.text).toContain('Workflow name=phase')
  expect(stateOn(disk)).toMatchObject({ status: 'phase', current: 'P1', brief_path: '.claude/ouroboros/briefs/M1.md', pending: { workflow: 'phase', args: { phase: 'P1' } } })
})

test('/ouroboros adopt and set repair state.json and print it before and after', async ($, on) => {
  const stuck = JSON.stringify({ milestone: 'M1', phases: ['P0', 'P1'], current: null, status: 'kickoff', escalations: [], results: {}, pending: { workflow: 'milestone-kickoff', args: { milestone: 'M1' } } })
  const disk = worldBeneath(on, { '.claude/ouroboros.json': CONFIG, '.claude/ouroboros/state.json': stuck })

  const adopted = await run($, 'adopt wr4z11mqu phase P1')

  expect(adopted.text).toBe(
    'before: M1 · phase - · kickoff · in flight nothing · pending milestone-kickoff\nafter:  M1 · phase P1 · phase · in flight phase (wr4z11mqu) · pending milestone-kickoff',
  )
  expect(stateOn(disk)).toMatchObject({ status: 'phase', current: 'P1', run: { id: 'wr4z11mqu', workflow: 'phase' } })

  expect((await run($, 'set status escalated')).text).toContain('after:  M1 · phase P1 · escalated')
  expect((await run($, 'set phase P7')).text).toBe('unknown phase P7: one of P0, P1')
  expect(stateOn(disk)).toMatchObject({ status: 'escalated', current: 'P1' })
})

test('/ouroboros resume reports duplicate plan task ids instead of launching', async ($, on) => {
  const plan = ['### Task 18: Slim the web API (P1)', '- [ ] Step 1', '### Task 18: Singletons reached through class methods (P1)', '- [ ] Step 1'].join('\n')
  const queued = JSON.stringify({
    milestone: 'M1', phases: ['P1'], current: 'P1', status: 'phase', escalations: [], results: {}, paused: true,
    drafts: { spec: 'specs/m1.md', plan: 'plans/m1.md' }, pending: { workflow: 'phase', args: { milestone: 'M1', phase: 'P1' } },
  })
  const disk = worldBeneath(on, { '.claude/ouroboros.json': CONFIG, '.claude/ouroboros/state.json': queued, '/repo/docs/drafts/plans/m1.md': plan })

  const resumed = await run($, 'resume')

  expect(resumed.text).toBe('ouroboros: the plan has duplicate task ids: 18; renumber them before running a phase')
  expect(stateOn(disk)).toMatchObject({ paused: true })
})

const heldForMerge = JSON.stringify({
  milestone: 'M1', phases: ['P0', 'P1'], current: 'P1', status: 'phase', escalations: [], results: {},
  drafts: { spec: 'specs/m1.md', plan: 'plans/m1.md' },
  awaiting_merge: { phase: 'P0', pr_url: 'https://github.com/o/r/pull/841' },
  pending: { workflow: 'phase', args: { milestone: 'M1', phase: 'P1' } },
})

const prWorld = (on: On, prState: string, seen = { sent: [] as string[], ghCalls: 0 }) => {
  const disk = new Map<string, string>([['.claude/ouroboros.json', CONFIG], ['.claude/ouroboros/state.json', heldForMerge], ['/repo/docs/drafts/plans/m1.md', PLAN]])
  const fileAt = (path: string) => [...disk.entries()].find(([name]) => path.endsWith(name))?.[1]
  mock.env(on, { HOME: '/home' })
  on('process.run', (_, e) => {
    if (e.argv[0] === 'gh') seen.ghCalls++
    const stdout = e.argv[0] === 'gh' ? `${prState}\n` : e.argv.some(arg => arg.startsWith('--grep=')) ? '' : '/repo/.git\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', (_, e) => ({ value: fileAt(e.path) !== undefined }))
  on('fs.read', (_, e) => ({ value: fileAt(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    disk.set(e.path.includes('.claude/') ? e.path.slice(e.path.indexOf('.claude/')) : e.path, e.text)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'main-session' }))
  on('session.send', (_, e) => {
    seen.sent.push(e.text)
    return { isDelivered: true as const }
  })
  return disk
}

test('/ouroboros resume keeps waiting while the phase PR is still open', async ($, on) => {
  const disk = prWorld(on, 'OPEN')

  const resumed = await run($, 'resume')

  expect(resumed.text).toBe('waiting for you to merge https://github.com/o/r/pull/841 (P0, OPEN); resume again once it is merged')
  expect(stateOn(disk)).toMatchObject({ awaiting_merge: { phase: 'P0' }, pending: { workflow: 'phase' } })
})

test('/ouroboros resume after the merge starts the held phase on a fresh branch', async ($, on) => {
  const disk = prWorld(on, 'MERGED')

  const resumed = await run($, 'resume')

  expect(resumed.text).toContain('"fresh_branch":"milestone/m1-p1"')
  expect(resumed.text).toContain('"merge_policy":"ask"')
  expect(stateOn(disk).awaiting_merge).toBeUndefined()
})

test('the conductor notices a merged phase PR on its own, at most once every five minutes, and starts the held phase', async ($, on) => {
  const sent: string[] = []
  const disk = prWorld(on, 'MERGED', { sent, ghCalls: 0 })
  on('prompt.context', (_, e) => ({ blocks: e.blocks }))
  mock.clock(on, { now: Date.UTC(2026, 9, 3, 12) })

  const context = await $.prompt.context({ blocks: [] })

  expect(stateOn(disk).awaiting_merge).toBeUndefined()
  expect(sent.join('\n')).toContain('"fresh_branch":"milestone/m1-p1"')
  expect(context.blocks.map(block => block.text).join('\n')).toContain('https://github.com/o/r/pull/841 merged')
})

test('an open phase PR is checked again only after five minutes', async ($, on) => {
  const seen = { sent: [], ghCalls: 0 }
  const disk = prWorld(on, 'OPEN', seen)
  on('prompt.context', (_, e) => ({ blocks: e.blocks }))
  mock.clock(on, { now: Date.UTC(2026, 9, 3, 12) })

  await $.prompt.context({ blocks: [] })
  await $.prompt.context({ blocks: [] })

  expect(seen.ghCalls).toBe(1)
  expect(stateOn(disk)).toMatchObject({ awaiting_merge: { phase: 'P0' }, merge_checked_at: Date.UTC(2026, 9, 3, 12) })
})

test('a merge or rebase in the main session is refused while a workflow writes to the worktree', async ($, on) => {
  worldBeneath(on, { '.claude/ouroboros/state.json': phaseInFlight })
  const reached: string[] = []
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    reached.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })

  const merge = await $.tool.call({ tool: 'Bash', command: 'git merge origin/main' })
  const rebase = await $.tool.call({ tool: 'Bash', command: 'git rebase origin/main' })
  await $.tool.call({ tool: 'Bash', command: 'git status' })

  expect(merge.deny ?? merge.text).toContain('phase (wf-1) is writing to this worktree')
  expect(rebase.deny ?? rebase.text).toContain('phase (wf-1) is writing to this worktree')
  expect(reached).toEqual(['git status'])
})

test('the runtime directory ignores itself, so a project never sees its results, state or briefs as untracked', async ($, on) => {
  const disk = worldBeneath(on, { '.claude/ouroboros.json': CONFIG, '/repo/docs/drafts/plans/m1.md': PLAN })

  await run($, 'kickoff M1 specs/m1.md plans/m1.md')

  expect(disk.get('.claude/ouroboros/.gitignore')).toBe('*\n')
})

test('the loop header rides on the prompt context', async ($, on) => {
  worldBeneath(on, { '.claude/ouroboros/state.json': phaseInFlight })
  on('prompt.context', (_, e) => ({ blocks: e.blocks }))

  const { blocks } = await $.prompt.context({ blocks: [{ name: 'currentDate', text: '2026-10-03' }] })

  expect(blocks.map(block => block.name)).toEqual(['currentDate', 'ouroboros'])
  expect(blocks[1]?.text.split('\n')).toHaveLength(3)
})

test('main-session Bash output passes through whole, however long', async ($, on) => {
  const disk = worldBeneath(on, {})
  const stdout = 'x'.repeat(5000)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout, stderr: '', interrupted: false } }))

  const answered = await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'use-9' })

  expect((answered.result as { stdout: string }).stdout).toBe(stdout)
  expect(disk.has('.claude/ouroboros/results/use-9.json')).toBe(false)
})

const longAgentResult = (text: string) => ({
  agentId: 'agent-1',
  content: [{ type: 'text' as const, text }],
  totalToolUseCount: 0,
  totalDurationMs: 1,
  totalTokens: 1,
  usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: null, cache_creation: null },
})

const rootedWorld = (on: On) => {
  const written = new Map<string, string>()
  on('process.run', (_, e) => {
    const stdout = e.argv.includes('--show-toplevel') ? '/project\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ value: '' }))
  on('fs.write', (_, e) => {
    written.set(e.path, e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  return written
}

test('an oversized loop agent result is filed under the project root, whatever the cwd', async ($, on) => {
  const written = rootedWorld(on)
  on('tool.call', { tool: 'Agent' }, () => ({ result: longAgentResult('y'.repeat(5000)) }))

  const answered = await $.tool.call({ tool: 'Agent', description: 'review', prompt: 'review it', subagent_type: 'ouroboros:reviewer', tool_use_id: 'use-7' })

  expect(JSON.stringify(answered.result)).toContain('/project/.claude/ouroboros/results/use-7.json')
  expect(written.get('/project/.claude/ouroboros/results/use-7.json')).toContain('yyyy')
})

test('an oversized result from an agent outside the loop passes through whole', async ($, on) => {
  const written = rootedWorld(on)
  on('tool.call', { tool: 'Agent' }, () => ({ result: longAgentResult('z'.repeat(5000)) }))

  const answered = await $.tool.call({ tool: 'Agent', description: 'look', prompt: 'find it', subagent_type: 'Explore', tool_use_id: 'use-8' })

  expect(JSON.stringify(answered.result)).toContain('z'.repeat(5000))
  expect(written.size).toBe(0)
})
