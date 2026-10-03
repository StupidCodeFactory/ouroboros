export const meta = {
  name: 'phase',
  description: 'One phase: implement each task outside-in, review in parallel, fix up to three rounds, checkpoint',
  phases: [{ title: 'Implement' }, { title: 'Review' }, { title: 'Checkpoint' }],
}

const stageEffort = (effortByStage, stage) => {
  if (!effortByStage) return undefined
  return effortByStage[stage]
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
          root_cause: { type: 'string', enum: ['code-bug', 'skill-gap', 'skill-misread', 'skill-misuse', 'agent-behaviour'] },
          skill: { type: 'string' },
          agent: { type: 'string' },
          blocking: { type: 'boolean' },
        },
        required: ['summary', 'root_cause', 'blocking'],
      },
    },
  },
  required: ['findings'],
}

const MAX_FIX_ROUNDS = 3
const REVIEWERS = [
  { agent: 'reviewer', stage: 'review' },
  { agent: 'architect', stage: 'architect_review' },
  { agent: 'auditor', stage: 'audit' },
]

const ouroborosAgent = agent => `ouroboros:${agent}`

const lanePrefix = () => (args.lane ? `Lane ${args.lane}. ` : '')

const taskHeading = task => `Milestone ${args.milestone} ${args.phase}, task ${task.id}: ${task.title}`

const planReference = task => (task.line ? `Plan section: the "### Task ${task.id}" heading at line ${task.line} of the active plan.` : `Plan section: task ${task.id}.`)

const fixInstruction = blocking =>
  blocking.length ? `Fix these blocking findings:\n${JSON.stringify(blocking)}` : 'Implement it outside-in, red first; tick each plan box in the commit that verifies it.'

const implementPrompt = (task, blocking) =>
  `${lanePrefix()}${taskHeading(task)}.\n${planReference(task)}\nArchitect brief:\n${args.brief}\n${fixInstruction(blocking)}`

const reviewPrompt = (reviewer, task) =>
  `Review the diff for ${args.phase} task ${task.id} (${task.title}) on the current branch as the ${reviewer}. ` +
  'Return every finding with its root cause; mark blocking ones.'

const implementStage = blocking => (blocking.length ? 'fix' : 'implement')

const implement = (task, blocking, round) =>
  agent(implementPrompt(task, blocking), {
    agentType: ouroborosAgent('implementer'),
    phase: 'Implement',
    label: `implement:${task.id}:r${round}`,
    effort: stageEffort(args.effort, implementStage(blocking)),
  })

const review = (reviewer, task) =>
  agent(reviewPrompt(reviewer.agent, task), {
    agentType: ouroborosAgent(reviewer.agent),
    schema: FINDINGS_SCHEMA,
    phase: 'Review',
    label: `${reviewer.agent}:${task.id}`,
    effort: stageEffort(args.effort, reviewer.stage),
  })

const reviewTask = async task => {
  const reviews = await parallel(REVIEWERS.map(reviewer => () => review(reviewer, task)))
  return reviews.filter(Boolean).flatMap(result => result.findings)
}

const runTask = async task => {
  let blocking = []
  const allFindings = []
  for (let round = 1; round <= MAX_FIX_ROUNDS; round++) {
    await implement(task, blocking, round)
    const findings = await reviewTask(task)
    allFindings.push(...findings)
    blocking = findings.filter(finding => finding.blocking)
    if (!blocking.length) return { id: task.id, status: 'done', rounds: round, findings: allFindings }
  }
  return { id: task.id, status: 'escalate', rounds: MAX_FIX_ROUNDS, findings: allFindings }
}

const checkpointPrompt = () =>
  `${lanePrefix()}Run the ${args.milestone} checks that ${args.phase} touches and the full test and lint commands ` +
  `of every lane in .claude/ouroboros.json${args.lane ? ` (at least lane ${args.lane})` : ''}. ` +
  `Then commit with subject "phase(${args.phase}): <summary>". Return the evidence.`

const checkpoint = () =>
  agent(checkpointPrompt(), {
    agentType: ouroborosAgent('auditor'),
    phase: 'Checkpoint',
    effort: stageEffort(args.effort, 'checkpoint'),
  })

phase('Implement')
const tasks = args.tasks ?? []
if (!tasks.length) log(`${args.phase}: no tasks passed in args; nothing to implement`)
const taskResults = []
for (const task of tasks) taskResults.push(await runTask(task))

if (taskResults.some(result => result.status === 'escalate')) {
  return { status: 'escalate', phase: args.phase, tasks: taskResults, evidence: '' }
}

phase('Checkpoint')
const evidence = await checkpoint()
return { status: 'checkpointed', phase: args.phase, tasks: taskResults, evidence }
