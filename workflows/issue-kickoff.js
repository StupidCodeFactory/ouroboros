export const meta = {
  name: 'issue-kickoff',
  description: 'Plan a milestone issue: one architect pass returns the milestone body and the task list; the ouroboros hook writes them to GitHub as sub-issues',
  phases: [{ title: 'Plan' }],
}

const COMMAND_ITEM = {
  type: 'object',
  properties: { text: { type: 'string' }, command: { type: 'string' } },
  required: ['text', 'command'],
}

const DEPENDENCY = {
  type: 'object',
  properties: { issue: { type: 'number' }, task: { type: 'number' } },
}

const TASK = {
  type: 'object',
  properties: {
    issue: { type: 'number' },
    title: { type: 'string' },
    goal: { type: 'string' },
    plan: { type: 'string' },
    checklist: { type: 'array', items: COMMAND_ITEM, minItems: 1 },
    completion: { type: 'array', items: { type: 'string' }, minItems: 1 },
    stop: { type: 'string' },
    must_not: { type: 'string' },
    depends_on: { type: 'array', items: DEPENDENCY },
  },
  required: ['title', 'goal', 'plan', 'checklist', 'completion', 'stop', 'must_not', 'depends_on'],
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    milestone: {
      type: 'object',
      properties: { goal: { type: 'string' }, brief: { type: 'string' }, acceptance: { type: 'array', items: COMMAND_ITEM, minItems: 1 } },
      required: ['goal', 'brief', 'acceptance'],
    },
    tasks: { type: 'array', items: TASK },
  },
  required: ['milestone', 'tasks'],
}

const roleModel = role => (args.models && args.models[role] ? { model: args.models[role] } : {})

const stageEffort = stage => (args.effort ? args.effort[stage] : undefined)

const eagerPreamble = file => (args.eager_dir ? `Before anything else, read ${args.eager_dir}/${file} in full and follow the skills it holds.\n` : '')

const subIssueText = subIssue => `### #${subIssue.number} (${subIssue.state}) ${subIssue.title}\n${subIssue.body}`

const CONTRACT_RULES =
  'Each task is one sub-issue: one run, one PR, one coherent change. Its fields are the seven contract sections. ' +
  '`plan`: outside-in steps and the PRD sections to read, ending with one line `Files: ` listing in backticks every path or glob it may change. ' +
  '`checklist`: items whose `command` fails before the task and passes once the item holds (prefer a test runner filtered to one named example). ' +
  '`completion`: commands that must pass when done, whatever they did before (the full suite, the linters). ' +
  '`stop`: when to stop and escalate. `must_not`: the forbidden list. ' +
  '`depends_on`: `{issue: n}` for an existing sub-issue, `{task: n}` for another task of this list by its 1-based place; never a cycle. '

const REVISION_RULES =
  'Revise rather than replace: a task that continues an open sub-issue names it in `issue`; an open sub-issue you leave out is closed as not planned. ' +
  'Never name a closed sub-issue in `issue`. You edit nothing yourself: return the plan, and the hook writes GitHub. '

const planPrompt = () =>
  eagerPreamble('architect.md') +
  `Plan milestone #${args.issue} "${args.title}".\n` +
  'Return the milestone body (`goal`, `brief`: what every task shares, the forbidden list, the constraints and seams; `acceptance`: items each with a command that proves the milestone) and the task list. ' +
  CONTRACT_RULES +
  REVISION_RULES +
  `\n\nPRD section:\n${args.prd_section}\n\nCurrent milestone body:\n${args.milestone_body || '(empty)'}\n\nSub-issues (${args.sub_issues.length}):\n${args.sub_issues.map(subIssueText).join('\n\n') || '(none)'}`

phase('Plan')
log(`planning #${args.issue} "${args.title}" against ${args.sub_issues.length} existing sub-issues`)
const planned = await agent(planPrompt(), {
  label: `plan:#${args.issue}`,
  phase: 'Plan',
  agentType: 'ouroboros:architect',
  schema: PLAN_SCHEMA,
  ...roleModel('architect'),
  effort: stageEffort('brief'),
})
if (!planned) return { error: 'architect returned nothing' }
log(`planned #${args.issue}: ${planned.tasks.length} tasks, ${planned.tasks.filter(task => task.issue).length} revising existing sub-issues`)
return planned
