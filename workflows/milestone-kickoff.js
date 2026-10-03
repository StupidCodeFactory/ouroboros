export const meta = {
  name: 'milestone-kickoff',
  description: 'Milestone kickoff: architect brief and decisions, planner appends the phase-tagged tasks, auditor writes the checks red',
  phases: [{ title: 'Brief' }, { title: 'Plan' }, { title: 'Checks' }],
}

const stageEffort = (effortByStage, stage) => {
  if (!effortByStage) return undefined
  return effortByStage[stage]
}

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
  },
  required: ['brief', 'decisions'],
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    phases: { type: 'array', items: { type: 'string' } },
    tasks_added: { type: 'number' },
    tasks: TASK_SLICES,
  },
  required: ['phases', 'tasks_added', 'tasks'],
}

const CHECKS_SCHEMA = {
  type: 'object',
  properties: {
    checks: { type: 'array', items: { type: 'string' } },
    red: { type: 'boolean' },
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
  'List every architectural decision the milestone commits to as `decisions`, each with its rationale.'

const briefText = brief => [brief.common, ...brief.tasks.map(task => `Task ${task.id}: ${task.guidance} Touches: ${task.touches.join(', ')}`)].join('\n')

const planPrompt = brief =>
  eagerPreamble('architect.md') +
  `Milestone ${args.milestone}. Append \`## Part C: ${args.milestone} tasks\` to the plan ${draftReference(args.plan)} ` +
  'in the same format as its Part B: every task heading `### Task <id>: <title> (PN)` ends with its phase tag, every step is a `- [ ]` box. ' +
  `Keep the existing parts untouched. ${TEST_NAMING}Architect brief:\n${brief}\n` +
  'Return the phases you tagged in order, how many tasks you added, and for each added task its brief slice in `tasks`: ' +
  '`guidance` (where its code goes, what to reuse) and `touches` (every repository-relative file it will create, change or delete).'

const checksPrompt = brief =>
  eagerPreamble('auditor.md') +
  `Milestone ${args.milestone}. From the spec ${draftReference(args.spec)} and this brief:\n${brief}\n` +
  'Write the milestone acceptance checks as the project\'s check commands, run them, and confirm each one is red before any implementation. ' +
  TEST_NAMING +
  'Return the check names and whether they are all red.'

phase('Brief')
const briefed = await agent(briefPrompt(), {
  agentType: ouroborosAgent('architect'),
  schema: BRIEF_SCHEMA,
  phase: 'Brief',
  effort: stageEffort(args.effort, 'brief'),
})
if (!briefed) return { brief: { common: '', tasks: [] }, decisions: [], checks: [], red: false, error: 'architect returned nothing' }

phase('Plan')
const planned = await agent(planPrompt(briefText(briefed.brief)), {
  agentType: ouroborosAgent('architect'),
  schema: PLAN_SCHEMA,
  phase: 'Plan',
  effort: stageEffort(args.effort, 'planner'),
})

phase('Checks')
const audited = await agent(checksPrompt(briefText(briefed.brief)), {
  agentType: ouroborosAgent('auditor'),
  schema: CHECKS_SCHEMA,
  phase: 'Checks',
  effort: stageEffort(args.effort, 'audit'),
})

const plannedSlices = planned ? planned.tasks : []

return {
  brief: { common: briefed.brief.common, tasks: [...briefed.brief.tasks, ...plannedSlices] },
  decisions: briefed.decisions,
  phases: planned ? planned.phases : [],
  checks: audited ? audited.checks : [],
  red: audited ? audited.red : false,
}
