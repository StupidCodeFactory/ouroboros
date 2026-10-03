export const meta = {
  name: 'milestone-kickoff',
  description: 'Milestone kickoff: a fresh branch from the default branch when asked, architect brief and decisions, then at once the planner appends the phase-tagged tasks and the auditor writes the checks red',
  phases: [{ title: 'Branch' }, { title: 'Brief' }, { title: 'Plan' }, { title: 'Checks' }],
}

const stageEffort = (effortByStage, stage) => {
  if (!effortByStage) return undefined
  return effortByStage[stage]
}

const PROCESS_FINDINGS = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      root_cause: { type: 'string', enum: ['skill-gap', 'skill-misread', 'skill-misuse', 'agent-behaviour'] },
      skill: { type: 'string' },
      agent: { type: 'string' },
    },
    required: ['summary', 'root_cause'],
  },
}

const PROCESS_FINDINGS_RULE =
  'Under `findings`, report only what a skill or agent definition got wrong or left out (root_cause, the skill or agent, summary); leave it empty otherwise. '

const findingsOf = (...results) => results.flatMap(result => (result && result.findings) || [])

const TASK_SLICES = {
  type: 'array',
  items: {
    type: 'object',
    properties: { id: { type: 'string' }, guidance: { type: 'string' }, touches: { type: 'array', items: { type: 'string' } } },
    required: ['id', 'guidance', 'touches'],
  },
}

const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    brief: {
      type: 'object',
      properties: { common: { type: 'string' }, tasks: TASK_SLICES },
      required: ['common', 'tasks'],
    },
    decisions: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, rationale: { type: 'string' } }, required: ['title'] } },
    findings: PROCESS_FINDINGS,
  },
  required: ['brief', 'decisions'],
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    phases: { type: 'array', items: { type: 'string' } },
    tasks_added: { type: 'number' },
    tasks: TASK_SLICES,
    findings: PROCESS_FINDINGS,
  },
  required: ['phases', 'tasks_added', 'tasks'],
}

const BRANCH_SCHEMA = {
  type: 'object',
  properties: { branch: { type: 'string' }, base: { type: 'string' } },
  required: ['branch', 'base'],
}

const CHECKS_SCHEMA = {
  type: 'object',
  properties: {
    checks: { type: 'array', items: { type: 'string' } },
    red: { type: 'boolean' },
    findings: PROCESS_FINDINGS,
  },
  required: ['checks', 'red'],
}

const ouroborosAgent = agent => `ouroboros:${agent}`

const eagerPreamble = file =>
  args.eager_dir ? `Before anything else, read ${args.eager_dir}/${file} in full and follow the skills it holds.\n` : ''

const draftReference = relative => `\`<drafts_dir from .claude/ouroboros.json>/${relative}\` in the main checkout`

const TEST_NAMING =
  'Name test files, describe blocks and examples after the domain behaviour they check, never after milestone, phase or task ids or names. '

const goalLine = () => (args.goal ? `Goal: ${args.goal}.\n` : '')

const briefPrompt = () =>
  eagerPreamble('architect.md') +
  `Milestone ${args.milestone} kickoff. ${goalLine()}` +
  `Read the spec ${draftReference(args.spec)} and the plan ${draftReference(args.plan)}. ` +
  'Write the design brief for this milestone in two parts. `brief.common`: what every task shares, the forbidden list, the review gates, ' +
  'the constraints and seams, what must not change. `brief.tasks`: one entry per plan task (its `### Task <id>` id) with `guidance` ' +
  '(where its code goes, what to reuse) and `touches` (every repository-relative file it will create, change or delete). ' +
  'List every architectural decision the milestone commits to as `decisions`, each with its rationale. ' +
  PROCESS_FINDINGS_RULE

const briefText = brief => [brief.common, ...brief.tasks.map(task => `Task ${task.id}: ${task.guidance} Touches: ${task.touches.join(', ')}`)].join('\n')

const planPrompt = brief =>
  eagerPreamble('architect.md') +
  `Milestone ${args.milestone}. Append \`## Part C: ${args.milestone} tasks\` to the plan ${draftReference(args.plan)} ` +
  'in the same format as its Part B: every task heading `### Task <id>: <title> (PN)` ends with its phase tag, every step is a `- [ ]` box. ' +
  'No task is left untagged, the milestone acceptance-checks task included: tag it with the first phase and give it only check steps; any code a check needs (a script, a helper) is its own tagged task. ' +
  'Read the highest `### Task <n>` number already in the plan and number your tasks from the next one up; never reuse an id. ' +
  `Keep the existing parts untouched. ${TEST_NAMING}Architect brief:\n${brief}\n` +
  'Return the phases you tagged in order, how many tasks you added, and for each added task its brief slice in `tasks`: ' +
  '`guidance` (where its code goes, what to reuse) and `touches` (every repository-relative file it will create, change or delete). ' +
  PROCESS_FINDINGS_RULE

const checksPrompt = brief =>
  eagerPreamble('auditor.md') +
  `Milestone ${args.milestone}. From the spec ${draftReference(args.spec)} and this brief:\n${brief}\n` +
  'Write the milestone acceptance checks as the project\'s check commands, run them, and confirm each one is red before any implementation. ' +
  TEST_NAMING +
  'Return the check names and whether they are all red. ' +
  PROCESS_FINDINGS_RULE

const freshBranchPrompt = () =>
  `Milestone ${args.milestone} starts on a fresh branch. Run \`git fetch origin\`, then create and switch to \`${args.fresh_branch}\` from the default branch's origin tip. ` +
  'Leave uncommitted draft files where they are. Never merge or rebase another branch. Return the `branch` you are on and its `base` commit.'

if (args.fresh_branch) {
  phase('Branch')
  const branched = await agent(freshBranchPrompt(), {
    agentType: ouroborosAgent('implementer'),
    schema: BRANCH_SCHEMA,
    phase: 'Branch',
    model: 'haiku',
    effort: 'low',
  })
  if (!branched || branched.branch !== args.fresh_branch) return { brief: { common: '', tasks: [] }, decisions: [], checks: [], red: false, error: `fresh branch ${args.fresh_branch} not created` }
}

phase('Brief')
const briefed = await agent(briefPrompt(), {
  agentType: ouroborosAgent('architect'),
  schema: BRIEF_SCHEMA,
  phase: 'Brief',
  effort: stageEffort(args.effort, 'brief'),
})
if (!briefed) return { brief: { common: '', tasks: [] }, decisions: [], checks: [], red: false, error: 'architect returned nothing' }

const [planned, audited] = await parallel([
  () =>
    agent(planPrompt(briefText(briefed.brief)), {
      agentType: ouroborosAgent('architect'),
      schema: PLAN_SCHEMA,
      phase: 'Plan',
      effort: stageEffort(args.effort, 'planner'),
    }),
  () =>
    agent(checksPrompt(briefText(briefed.brief)), {
      agentType: ouroborosAgent('auditor'),
      schema: CHECKS_SCHEMA,
      phase: 'Checks',
      effort: stageEffort(args.effort, 'audit'),
    }),
])

const plannedSlices = planned ? planned.tasks : []

return {
  brief: { common: briefed.brief.common, tasks: [...briefed.brief.tasks, ...plannedSlices] },
  decisions: briefed.decisions,
  phases: planned ? planned.phases : [],
  checks: audited ? audited.checks : [],
  red: audited ? audited.red : false,
  findings: findingsOf(briefed, planned, audited),
}
