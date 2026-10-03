export const meta = {
  name: 'phase',
  description: 'One phase: start on a fresh branch when asked, implement every task outside-in, review the whole phase diff in parallel, fix by task for up to three rounds, checkpoint, then open the phase PR for the user to merge',
  phases: [{ title: 'Branch' }, { title: 'Implement' }, { title: 'Review' }, { title: 'Checkpoint' }, { title: 'Pull request' }],
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
    branch: { type: 'string' },
  },
  required: ['changed', 'commits', 'hunks', 'evidence', 'branch'],
}

const MERGE_SCHEMA = {
  type: 'object',
  properties: {
    merged: { type: 'array', items: { type: 'string' } },
    conflicted: { type: 'array', items: { type: 'string' } },
  },
  required: ['merged', 'conflicted'],
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

const PR_SCHEMA = {
  type: 'object',
  properties: { pr_url: { type: 'string' } },
  required: ['pr_url'],
}

const BRANCH_SCHEMA = {
  type: 'object',
  properties: { branch: { type: 'string' }, base: { type: 'string' } },
  required: ['branch', 'base'],
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

const laneOf = task => (task && task.lane) || args.lane

const implementerFile = task => (laneOf(task) ? `implementer-${laneOf(task)}.md` : 'implementer.md')

const lanePrefix = task => (laneOf(task) ? `Lane ${laneOf(task)}. ` : '')

const taskHeading = task => `Milestone ${args.milestone} ${args.phase}, task ${task.id}: ${task.title}`

const planReference = task => (task.line ? `Plan section: the "### Task ${task.id}" heading at line ${task.line} of the active plan.` : `Plan section: task ${task.id}.`)

const briefText = task => {
  if (args.brief_dir) return `Architect brief: read ${args.brief_dir}/common.md and ${args.brief_dir}/${task.id}.md first.`
  if (args.brief_path) return `Architect brief: read ${args.brief_path} first.`
  return `Architect brief:\n${args.brief}`
}

const COMMIT_RULE =
  '\nNever start a commit subject with `phase(`: only the phase checkpoint uses it.' +
  '\nNever start, stop or reconfigure services or containers outside the lane\'s own test resources; when a test needs one that is down, report the blocker instead.'

const RESULT_INSTRUCTION =
  '\nReturn `changed` (false only when you committed no code change, e.g. a verification-only task), `commits` (the shas you made), ' +
  '`hunks` (every changed line range as { file, start, end }, file relative to the repository root, lines in the new file), `evidence` (commands run and their decisive output) and `branch` (the branch your commits are on).'

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

const overlaps = (left, right) => {
  if (left.touches === undefined || right.touches === undefined) return true
  return left.touches.some(file => (right.touches ?? []).some(other => samePath(file, other)))
}

const waveIndexes = (tasks) => {
  const indexes = []
  tasks.forEach((task, position) => {
    const after = tasks.slice(0, position).map((earlier, earlierPosition) => (overlaps(earlier, task) ? (indexes[earlierPosition] ?? 0) + 1 : 0))
    indexes.push(Math.max(0, ...after))
  })
  return indexes
}

const taskWaves = (tasks) => {
  const indexes = waveIndexes(tasks)
  const waveCount = Math.max(0, ...indexes.map(index => index + 1))
  return Array.from({ length: waveCount }, (_, wave) => tasks.filter((_, position) => indexes[position] === wave))
}

const tasksToRetry = (entries, merge) =>
  entries.filter(entry => entry.changed && !(merge?.merged ?? []).includes(entry.task.id))

const distinctFindings = (findings) => findings.filter((finding, position) => !isCoveredBy(finding, findings.slice(0, position)))

const checkpointVerdict = (checkpoint) => {
  if (!checkpoint) return { status: 'escalate', evidence: 'checkpoint agent returned nothing' }
  const status = checkpoint.committed && checkpoint.suite_green ? 'checkpointed' : 'escalate'
  return { status, evidence: checkpoint.evidence }
}

const IMPLEMENT_INSTRUCTION = 'Implement it outside-in, red first; tick each plan box in the commit that verifies it.'

const ISOLATION_NOTE = '\nYou run in your own git worktree beside other tasks of this phase: commit on its branch and never merge.'

const implementPrompt = (task, isolated) =>
  `${eagerPreamble(implementerFile(task))}${lanePrefix(task)}${taskHeading(task)}.\n${planReference(task)}\n${briefText(task)}\n${IMPLEMENT_INSTRUCTION}` +
  `${isolated ? ISOLATION_NOTE : ''}${COMMIT_RULE}${RESULT_INSTRUCTION}`

const sliceText = task => (args.brief_dir ? `Brief slice: ${args.brief_dir}/${task.id}.md.\n` : '')

const hunkLine = hunk => `- ${hunk.file}:${hunk.start}-${hunk.end}`

const LEAN_FIX_RULE =
  'Read only that plan section, the brief slice and the diff above; do not re-read the full brief, the whole plan or your skills, your agent memory carries the rest. Fix these findings and nothing else.'

const fixPrompt = (entry, blocking) =>
  `${lanePrefix(entry.task)}${taskHeading(entry.task)}: fix round.\n${planReference(entry.task)}\n${sliceText(entry.task)}` +
  `Task diff (commits ${entry.commits.join(', ') || 'none'}):\n${entry.hunks.map(hunkLine).join('\n')}\n${LEAN_FIX_RULE}\n` +
  `Blocking findings:\n${JSON.stringify(distinctFindings(blocking))}${COMMIT_RULE}${RESULT_INSTRUCTION}`

const isolationOf = isolated => (isolated ? { isolation: 'worktree' } : {})

const implement = (task, isolated) =>
  agent(implementPrompt(task, isolated), {
    agentType: ouroborosAgent('implementer'),
    schema: IMPLEMENT_SCHEMA,
    phase: 'Implement',
    label: `implement:${task.id}${isolated ? ':worktree' : ''}`,
    effort: stageEffort(args.effort, 'implement'),
    ...isolationOf(isolated),
  })

const mergePrompt = entries =>
  `${lanePrefix()}Merge these ${args.phase} task branches into the current branch in this order, one \`git merge --no-ff <branch>\` each:\n` +
  `${entries.map(entry => `- task ${entry.task.id}: ${entry.branch}`).join('\n')}\n` +
  'When a merge conflicts, run `git merge --abort`, never resolve it by hand, and go on with the next branch. ' +
  'Return the task ids you merged in `merged` and those that conflicted in `conflicted`.'

const mergeWave = entries =>
  agent(mergePrompt(entries), {
    agentType: ouroborosAgent('implementer'),
    schema: MERGE_SCHEMA,
    phase: 'Implement',
    label: `merge:${entries.map(entry => entry.task.id).join(',')}`,
    effort: stageEffort(args.effort, 'implement'),
  })

const NOTHING_MERGED = { merged: [], conflicted: [] }

const implementInPlace = async task => entryOf(task, await implement(task, false))

const runParallelWave = async wave => {
  const implemented = await parallel(wave.map(task => () => implement(task, true)))
  const isolated = implemented.map((result, position) => entryOf(wave[position], result))
  const branches = isolated.filter(entry => entry.changed && entry.branch)
  const merge = branches.length ? await mergeWave(branches) : NOTHING_MERGED
  const retried = []
  for (const entry of tasksToRetry(isolated, merge)) retried.push(await implementInPlace(entry.task))
  return isolated.map(entry => retried.find(retry => retry.task.id === entry.task.id) ?? entry)
}

const runWave = async wave => (wave.length === 1 ? [await implementInPlace(wave[0])] : runParallelWave(wave))

const inPlanOrder = (entries, tasks) => tasks.map(task => entries.find(entry => entry.task.id === task.id)).filter(Boolean)

const fix = (entry, blocking, round) =>
  agent(fixPrompt(entry, blocking), {
    agentType: ouroborosAgent('implementer'),
    schema: IMPLEMENT_SCHEMA,
    phase: 'Review',
    label: `fix:${entry.task.id}:r${round}`,
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
    fixHunks.push(...recordFix(entry, await fix(entry, blockingOf(entry, blocking), round)))
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
  branch: implemented?.branch ?? '',
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

const reviewSummary = summary =>
  `Review rounds: ${summary.review_rounds}. Tasks: ${summary.tasks.map(task => `${task.id} ${task.status}`).join(', ')}. ` +
  `Follow-ups added to the plan: ${summary.follow_ups.length}.`

const pullRequestPrompt = (summary, evidence) =>
  `${lanePrefix()}${args.milestone} ${args.phase} is checkpointed. Push the milestone branch and open a pull request from it into the default branch, ` +
  `titled "${args.milestone} ${args.phase}: <one-line summary>", following the repository's PR conventions. ` +
  `Put this in the description:\n${reviewSummary(summary)}\nCheckpoint evidence:\n${evidence}\n` +
  'When an open PR from this branch already exists, update its title and description instead. Never merge it: the user reviews and merges. Return its `pr_url`.'

const openPullRequest = (summary, evidence) =>
  agent(pullRequestPrompt(summary, evidence), {
    agentType: ouroborosAgent('implementer'),
    schema: PR_SCHEMA,
    phase: 'Pull request',
    effort: stageEffort(args.effort, 'merge'),
  })

const freshBranchPrompt = () =>
  `${args.milestone} ${args.phase} starts on a fresh branch: the previous phase PR was merged into the default branch. ` +
  `Run \`git fetch origin\`, then create and switch to \`${args.fresh_branch}\` from the default branch's origin tip. ` +
  'Never merge or rebase the old milestone branch. Return the `branch` you are on and its `base` commit.'

const startFreshBranch = () =>
  agent(freshBranchPrompt(), {
    agentType: ouroborosAgent('implementer'),
    schema: BRANCH_SCHEMA,
    phase: 'Branch',
    effort: stageEffort(args.effort, 'checkpoint'),
  })

const opensPullRequest = () => args.merge_policy !== 'architect'

if (args.fresh_branch) {
  phase('Branch')
  const branched = await startFreshBranch()
  if (!branched || branched.branch !== args.fresh_branch) return { status: 'escalate', phase: args.phase, tasks: [], follow_ups: [], evidence: '', failing_gate: `fresh branch ${args.fresh_branch} not created` }
}

phase('Implement')
const tasks = args.tasks ?? []
if (!tasks.length) log(`${args.phase}: no tasks passed in args; nothing to implement`)
const implementedEntries = []
for (const wave of taskWaves(tasks)) implementedEntries.push(...(await runWave(wave)))
const entries = inPlanOrder(implementedEntries, tasks)

phase('Review')
const reviewed = entries.filter(entry => entry.changed)
const outcome = reviewed.length ? await reviewPhase(reviewed) : NOT_REVIEWED
const summary = { phase: args.phase, tasks: entries.map(entry => taskResult(entry, outcome)), follow_ups: outcome.followUps, review_rounds: outcome.rounds }
if (outcome.blocking.length) return { status: 'escalate', ...summary, evidence: '' }

phase('Checkpoint')
const verdict = checkpointVerdict(await checkpoint())
if (verdict.status !== 'checkpointed') return { status: verdict.status, ...summary, evidence: verdict.evidence }

if (!opensPullRequest()) return { status: 'checkpointed', ...summary, evidence: verdict.evidence }

phase('Pull request')
const opened = await openPullRequest(summary, verdict.evidence)
if (!opened) return { status: 'escalate', ...summary, evidence: verdict.evidence, failing_gate: 'phase PR not opened' }
return { status: 'checkpointed', ...summary, evidence: verdict.evidence, pr_url: opened.pr_url, merged: false }
