export const meta = {
  name: 'phase',
  description: 'One phase: implement every task outside-in, review the whole phase diff in parallel, fix by task for up to three rounds, checkpoint',
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
          task: { type: 'string' },
          blocking: { type: 'boolean' },
        },
        required: ['summary', 'root_cause', 'blocking', 'task'],
      },
    },
  },
  required: ['findings'],
}

const IMPLEMENT_SCHEMA = {
  type: 'object',
  properties: {
    changed: { type: 'boolean' },
    commits: { type: 'array', items: { type: 'string' } },
    hunks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' } },
        required: ['file', 'start', 'end'],
      },
    },
    evidence: { type: 'string' },
  },
  required: ['changed', 'commits', 'hunks', 'evidence'],
}

const CHECKPOINT_SCHEMA = {
  type: 'object',
  properties: {
    committed: { type: 'boolean' },
    sha: { type: 'string' },
    suite_green: { type: 'boolean' },
    evidence: { type: 'string' },
  },
  required: ['committed', 'sha', 'suite_green', 'evidence'],
}

const MAX_FIX_ROUNDS = 3
const REVIEWERS = [
  { agent: 'reviewer', stage: 'review' },
  { agent: 'architect', stage: 'architect_review' },
  { agent: 'auditor', stage: 'audit' },
]

const ouroborosAgent = agent => `ouroboros:${agent}`

const eagerPreamble = file =>
  args.eager_dir ? `Before anything else, read ${args.eager_dir}/${file} in full and follow the skills it holds.\n` : ''

const implementerFile = () => (args.lane ? `implementer-${args.lane}.md` : 'implementer.md')

const lanePrefix = () => (args.lane ? `Lane ${args.lane}. ` : '')

const taskHeading = task => `Milestone ${args.milestone} ${args.phase}, task ${task.id}: ${task.title}`

const planReference = task => (task.line ? `Plan section: the "### Task ${task.id}" heading at line ${task.line} of the active plan.` : `Plan section: task ${task.id}.`)

const briefText = task => {
  if (args.brief_dir) return `Architect brief: read ${args.brief_dir}/common.md and ${args.brief_dir}/${task.id}.md first.`
  if (args.brief_path) return `Architect brief: read ${args.brief_path} first.`
  return `Architect brief:\n${args.brief}`
}

const COMMIT_RULE = '\nNever start a commit subject with `phase(`: only the phase checkpoint uses it.'

const RESULT_INSTRUCTION =
  '\nReturn `changed` (false only when you committed no code change, e.g. a verification-only task), `commits` (the shas you made), ' +
  '`hunks` (every changed line range as { file, start, end }, file relative to the repository root, lines in the new file) and `evidence` (commands run and their decisive output).'

const needsReview = (implemented) => implemented?.changed !== false

const samePath = (left, right) => left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)

const sameSpot = (left, right) => left.file !== undefined && right.file !== undefined && samePath(left.file, right.file) && left.line === right.line

const isCoveredBy = (finding, kept) => kept.some(keptFinding => sameSpot(finding, keptFinding))

const reviewersOwningEachFinding = (reviewers, blocking) => {
  const kept = []
  return reviewers.filter(reviewer => {
    const fresh = blocking.filter(finding => finding.reviewer === reviewer.agent && !isCoveredBy(finding, kept))
    kept.push(...fresh)
    return fresh.length > 0
  })
}

const touchesOtherFiles = (fix, blocking) => fix.some(hunk => !blocking.some(finding => finding.file !== undefined && samePath(hunk.file, finding.file)))

const reviewersForRound = (round, maxRounds, reviewers, previousBlocking, fix) => {
  if (round === 1 || round === maxRounds || previousBlocking.length === 0) return reviewers
  if (touchesOtherFiles(fix, previousBlocking)) return reviewers
  const owners = reviewersOwningEachFinding(reviewers, previousBlocking)
  return owners.length === 0 ? reviewers : owners
}

const isInDiff = (finding, diff) =>
  diff.some(hunk => finding.file !== undefined && finding.line !== undefined && samePath(hunk.file, finding.file) && finding.line >= hunk.start && finding.line <= hunk.end)

const ownerTask = (finding, diffs) => {
  if (finding.task !== undefined && diffs[finding.task] !== undefined) return finding.task
  return Object.keys(diffs).find(id => isInDiff(finding, diffs[id] ?? []))
}

const withOwner = (finding, diffs) => {
  const task = ownerTask(finding, diffs)
  return task === undefined ? finding : { ...finding, task }
}

const isInOwnDiff = (finding, diffs) => finding.task !== undefined && isInDiff(finding, diffs[finding.task] ?? [])

const triagePhaseFindings = (findings, diffs) => {
  const raised = findings.filter(finding => finding.blocking).map(finding => withOwner(finding, diffs))
  return {
    blocking: raised.filter(finding => isInOwnDiff(finding, diffs)),
    followUps: raised.filter(finding => !isInOwnDiff(finding, diffs)),
  }
}

const checkpointVerdict = (checkpoint) => {
  if (!checkpoint) return { status: 'escalate', evidence: 'checkpoint agent returned nothing' }
  const status = checkpoint.committed && checkpoint.suite_green ? 'checkpointed' : 'escalate'
  return { status, evidence: checkpoint.evidence }
}

const IMPLEMENT_INSTRUCTION = 'Implement it outside-in, red first; tick each plan box in the commit that verifies it.'

const implementPrompt = task =>
  `${eagerPreamble(implementerFile())}${lanePrefix()}${taskHeading(task)}.\n${planReference(task)}\n${briefText(task)}\n${IMPLEMENT_INSTRUCTION}${COMMIT_RULE}${RESULT_INSTRUCTION}`

const fixPrompt = (task, blocking) =>
  `${eagerPreamble(implementerFile())}${lanePrefix()}${taskHeading(task)}.\n${planReference(task)}\n${briefText(task)}\n` +
  `Fix these blocking findings:\n${JSON.stringify(blocking)}${COMMIT_RULE}${RESULT_INSTRUCTION}`

const implement = task =>
  agent(implementPrompt(task), {
    agentType: ouroborosAgent('implementer'),
    schema: IMPLEMENT_SCHEMA,
    phase: 'Implement',
    label: `implement:${task.id}`,
    effort: stageEffort(args.effort, 'implement'),
  })

const fix = (task, blocking, round) =>
  agent(fixPrompt(task, blocking), {
    agentType: ouroborosAgent('implementer'),
    schema: IMPLEMENT_SCHEMA,
    phase: 'Review',
    label: `fix:${task.id}:r${round}`,
    effort: stageEffort(args.effort, 'fix'),
  })

const commonBrief = () => (args.brief_dir ? `Common brief: ${args.brief_dir}/common.md; each task's slice is ${args.brief_dir}/<task id>.md.\n` : '')

const taskLine = entry => `- task ${entry.task.id} (${entry.task.title}): commits ${entry.commits.join(', ') || 'none'}`

const REVIEW_RULES =
  'Name the task each finding belongs to in `task`. A finding blocks only when its file and line fall inside that task\'s diff; ' +
  'anything about code outside it is recorded as a follow-up in the plan and never blocks. Return every finding with its root cause; mark blocking ones.'

const reviewPrompt = (reviewer, entries) =>
  eagerPreamble(`${reviewer}.md`) +
  commonBrief() +
  `Review the whole ${args.phase} diff on the current branch as the ${reviewer}. Tasks:\n${entries.map(taskLine).join('\n')}\n${REVIEW_RULES}`

const recheckPrompt = (reviewer, entries, blocking) =>
  eagerPreamble(`${reviewer}.md`) +
  commonBrief() +
  `As the ${reviewer}, re-check these blocking findings on the ${args.phase} diff after the fixes:\n${JSON.stringify(blocking)}\n` +
  `Report each one still open and anything the fixes broke; do not review the rest again. Tasks:\n${entries.map(taskLine).join('\n')}\n${REVIEW_RULES}`

const roundPrompt = (reviewer, round, entries, blocking) => (round === 1 ? reviewPrompt(reviewer, entries) : recheckPrompt(reviewer, entries, blocking))

const review = (reviewer, round, entries, blocking) =>
  agent(roundPrompt(reviewer.agent, round, entries, blocking), {
    agentType: ouroborosAgent(reviewer.agent),
    schema: FINDINGS_SCHEMA,
    phase: 'Review',
    label: `${reviewer.agent}:r${round}`,
    effort: stageEffort(args.effort, reviewer.stage),
  })

const tagged = (reviewer, result) => (result ? result.findings.map(finding => ({ ...finding, reviewer: reviewer.agent })) : [])

const reviewRound = async (reviewers, round, entries, blocking) => {
  const reviews = await parallel(reviewers.map(reviewer => () => review(reviewer, round, entries, blocking)))
  return reviews.flatMap((result, index) => tagged(reviewers[index], result))
}

const diffsOf = entries => Object.fromEntries(entries.map(entry => [entry.task.id, entry.hunks]))

const blockingOf = (entry, blocking) => blocking.filter(finding => finding.task === entry.task.id)

const recordFix = (entry, fixed) => {
  if (!fixed) return []
  entry.commits.push(...(fixed.commits ?? []))
  entry.hunks.push(...(fixed.hunks ?? []))
  return fixed.hunks ?? []
}

const fixRound = async (entries, blocking, round) => {
  const fixHunks = []
  for (const entry of entries.filter(candidate => blockingOf(candidate, blocking).length)) {
    fixHunks.push(...recordFix(entry, await fix(entry.task, blockingOf(entry, blocking), round)))
  }
  return fixHunks
}

const reviewPhase = async entries => {
  const findings = []
  const followUps = []
  let blocking = []
  let fixHunks = []
  for (let round = 1; round <= MAX_FIX_ROUNDS; round++) {
    if (round > 1) fixHunks = await fixRound(entries, blocking, round)
    const raised = await reviewRound(reviewersForRound(round, MAX_FIX_ROUNDS, REVIEWERS, blocking, fixHunks), round, entries, blocking)
    findings.push(...raised)
    const triaged = triagePhaseFindings(raised, diffsOf(entries))
    followUps.push(...triaged.followUps)
    blocking = triaged.blocking
    if (!blocking.length) return { blocking, findings, followUps, rounds: round }
  }
  return { blocking, findings, followUps, rounds: MAX_FIX_ROUNDS }
}

const NOT_REVIEWED = { blocking: [], findings: [], followUps: [], rounds: 0 }

const entryOf = (task, implemented) => ({
  task,
  changed: needsReview(implemented),
  commits: implemented?.commits ?? [],
  hunks: implemented?.hunks ?? [],
  evidence: implemented?.evidence ?? 'implementer returned nothing',
})

const taskResult = (entry, outcome) => {
  if (!entry.changed) return { id: entry.task.id, status: 'verified', commits: [], evidence: entry.evidence, findings: [] }
  const escalated = blockingOf(entry, outcome.blocking).length > 0
  const findings = outcome.findings.filter(finding => finding.task === entry.task.id)
  return { id: entry.task.id, status: escalated ? 'escalate' : 'done', commits: entry.commits, evidence: entry.evidence, findings }
}

const checkpointPrompt = () =>
  `${eagerPreamble('auditor.md')}${lanePrefix()}Run the ${args.milestone} checks that ${args.phase} touches and the full test and lint commands ` +
  `of every lane in .claude/ouroboros.json${args.lane ? ` (at least lane ${args.lane})` : ''}. ` +
  `Only when every one is green, commit with subject "phase(${args.phase}): <summary>"; otherwise make no commit. ` +
  'Return `committed`, the commit `sha` (empty when none), `suite_green` and the `evidence` (commands, exit codes, decisive output).'

const checkpoint = () =>
  agent(checkpointPrompt(), {
    agentType: ouroborosAgent('auditor'),
    schema: CHECKPOINT_SCHEMA,
    phase: 'Checkpoint',
    effort: stageEffort(args.effort, 'checkpoint'),
  })

phase('Implement')
const tasks = args.tasks ?? []
if (!tasks.length) log(`${args.phase}: no tasks passed in args; nothing to implement`)
const entries = []
for (const task of tasks) entries.push(entryOf(task, await implement(task)))

phase('Review')
const reviewed = entries.filter(entry => entry.changed)
const outcome = reviewed.length ? await reviewPhase(reviewed) : NOT_REVIEWED
const summary = { phase: args.phase, tasks: entries.map(entry => taskResult(entry, outcome)), follow_ups: outcome.followUps, review_rounds: outcome.rounds }
if (outcome.blocking.length) return { status: 'escalate', ...summary, evidence: '' }

phase('Checkpoint')
const verdict = checkpointVerdict(await checkpoint())
return { status: verdict.status, ...summary, evidence: verdict.evidence }
