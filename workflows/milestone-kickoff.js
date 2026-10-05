export const meta = {
  name: 'milestone-kickoff',
  description: 'Milestone kickoff: a fresh branch from the default branch when asked, one architect pass for the brief, decisions and phase-tagged tasks, then the auditor commits the acceptance checks red against that brief',
  phases: [{ title: 'Branch' }, { title: 'Brief' }, { title: 'Checks' }],
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
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      phase: { type: 'string' },
      lane: { type: 'string' },
      guidance: { type: 'string' },
      touches: { type: 'array', items: { type: 'string' } },
    },
    required: ['id', 'title', 'phase', 'guidance', 'touches'],
  },
}

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    brief: {
      type: 'object',
      properties: { common: { type: 'string' }, tasks: TASK_SLICES },
      required: ['common', 'tasks'],
    },
    decisions: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, rationale: { type: 'string' } }, required: ['title'] } },
    phases: { type: 'array', items: { type: 'string' } },
    tasks_added: { type: 'number' },
    findings: PROCESS_FINDINGS,
  },
  required: ['brief', 'decisions', 'phases', 'tasks_added'],
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

const withRetry = async (prompt, opts) => {
  const first = await agent(prompt, opts)
  if (first !== null && first !== undefined) return first
  log(`${opts.phase}: no result (an overloaded or failed agent); one retry`)
  return agent(prompt, opts)
}

const roleModel = role => (args.models && args.models[role] ? { model: args.models[role] } : {})

const ouroborosAgent = agent => `ouroboros:${agent}`

const eagerPreamble = file =>
  args.eager_dir ? `Before anything else, read ${args.eager_dir}/${file} in full and follow the skills it holds.\n` : ''

const draftReference = relative => `\`<drafts_dir from .claude/ouroboros.json>/${relative}\` in the main checkout`

const TEST_NAMING =
  'Name test files, describe blocks and examples after the domain behaviour they check, never after milestone, phase or task ids or names. '

const phaseScope = () => (args.phase ? `, phase ${args.phase} only (earlier phases already ran)` : '')

const goalLine = () => (args.goal ? `Goal: ${args.goal}.\n` : '')

const SLICE_RULE =
  '`guidance` (where its code goes as file:line anchors, the spec file to extend, what to reuse, so the implementer reads only those lines) and `touches` (every repository-relative file it will create, change or delete). '

const designPrompt = () =>
  eagerPreamble('architect.md') +
  `Milestone ${args.milestone} kickoff${phaseScope()}. ${goalLine()}` +
  `Read the spec ${draftReference(args.spec)} and the plan ${draftReference(args.plan)} once, then do both parts below in this one pass.\n` +
  '1. The design brief. `brief.common`: what every task shares, the forbidden list, the review gates, the constraints and seams, what must not change. ' +
  'List every architectural decision the milestone commits to as `decisions`, each with its rationale.\n' +
  `2. The tasks. Append \`## Part C: ${args.milestone}${args.phase ? ` ${args.phase}` : ''} tasks\` to the plan, ` +
  (args.phase ? `every task in it belonging to phase ${args.phase} (tag each heading \`(${args.phase})\`; earlier parts and phases already exist), ` : '') +
  'in the same format as its Part B: every task heading `### Task <id>: <title> (PN)` ends with its phase tag, every step is a `- [ ]` box. ' +
  'No task is left untagged, the milestone acceptance-checks task included: tag it with the first phase and give it only check steps; any code a check needs (a script, a helper) is its own tagged task. ' +
  'Prefer fewer, larger tasks: one task is one coherent change an implementer finishes in one sitting, so merge steps that touch the same files. ' +
  'Read the highest `### Task <n>` number already in the plan and number your tasks from the next one up; never reuse an id. Keep the existing parts untouched. ' +
  TEST_NAMING +
  '`brief.tasks` holds one entry per task of this milestone, existing and added, keyed by its `### Task <id>` id, with its `title`, its `phase` tag, its `lane` (the lane in .claude/ouroboros.json whose owned_paths hold most of its touches), ' +
  SLICE_RULE +
  'Return the brief, the decisions, the phases you tagged in order and how many tasks you added. ' +
  PROCESS_FINDINGS_RULE

const contractText = designed =>
  [designed.brief.common, ...designed.brief.tasks.map(task => `Task ${task.id}: ${task.guidance} Touches: ${task.touches.join(', ')}`)].join('\n')

const checksPrompt = designed =>
  eagerPreamble('auditor.md') +
  `Milestone ${args.milestone}${phaseScope()}. ${goalLine()}From the spec ${draftReference(args.spec)} and the architect's brief below, ` +
  'write the milestone acceptance checks as the project\'s check commands, against the names, modules and commands the brief commits to (never invent other ones), and cover everything the goal names. ' +
  'Run them, confirm each one is red before any implementation, and commit them on the current branch with subject `test(<milestone>): acceptance checks, red`. ' +
  TEST_NAMING +
  'Return the check names (the committed file paths) and whether they are all red. ' +
  PROCESS_FINDINGS_RULE +
  `\nArchitect brief:\n${contractText(designed)}`

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
const designed = await withRetry(designPrompt(), {
  agentType: ouroborosAgent('architect'),
  schema: DESIGN_SCHEMA,
  phase: 'Brief',
  ...roleModel('architect'),
  effort: stageEffort(args.effort, 'brief'),
})
if (!designed) return { brief: { common: '', tasks: [] }, decisions: [], checks: [], red: false, error: 'architect returned nothing' }

phase('Checks')
const audited = await withRetry(checksPrompt(designed), {
  agentType: ouroborosAgent('auditor'),
  schema: CHECKS_SCHEMA,
  phase: 'Checks',
  ...roleModel('auditor'),
  effort: stageEffort(args.effort, 'audit'),
})

const checksLine = audited && audited.checks.length ? `\n\nAcceptance checks, committed red at kickoff; the tasks make them green and never treat them as stray drafts:\n${audited.checks.map(check => `- ${check}`).join('\n')}\n` : ''

return {
  brief: { ...designed.brief, common: `${designed.brief.common}${checksLine}` },
  decisions: designed.decisions,
  phases: designed.phases,
  checks: audited ? audited.checks : [],
  red: audited ? audited.red : false,
  findings: findingsOf(designed, audited),
}
