export const meta = {
  name: 'phase',
  description: 'One phase: start on a fresh branch when asked, implement every task outside-in, review the whole phase diff with the reviewer and the architect (up to 3 review rounds, 2 fix rounds), merge in the default branch, checkpoint, then open the phase PR for the user to merge',
  phases: [{ title: 'Branch' }, { title: 'Brief' }, { title: 'Implement' }, { title: 'Sync' }, { title: 'Review' }, { title: 'Checkpoint' }, { title: 'Pull request' }],
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
          source: { type: 'string', enum: ['suite'] },
        },
        required: ['summary', 'root_cause', 'blocking', 'task'],
      },
    },
  },
  required: ['findings'],
}

const HUNKS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: { file: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' } },
    required: ['file', 'start', 'end'],
  },
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
    failures: {
      type: 'array',
      items: {
        type: 'object',
        properties: { task: { type: 'string' }, file: { type: 'string' }, line: { type: 'number' }, summary: { type: 'string' } },
        required: ['file', 'summary'],
      },
    },
    manual_steps: { type: 'array', items: { type: 'string' } },
  },
  required: ['committed', 'sha', 'suite_green', 'evidence'],
}

const PR_SCHEMA = {
  type: 'object',
  properties: { pr_url: { type: 'string' } },
  required: ['pr_url'],
}

const REFRESH_SCHEMA = {
  type: 'object',
  properties: { appended: { type: 'boolean' }, landed: { type: 'array', items: { type: 'string' } } },
  required: ['appended', 'landed'],
}

const SYNC_SCHEMA = {
  type: 'object',
  properties: { synced: { type: 'boolean' }, conflicted_files: { type: 'array', items: { type: 'string' } } },
  required: ['synced', 'conflicted_files'],
}

const BRANCH_SCHEMA = {
  type: 'object',
  properties: { branch: { type: 'string' }, base: { type: 'string' } },
  required: ['branch', 'base'],
}

const MAX_REVIEW_ROUNDS = 3
const REVIEWERS = [
  { agent: 'reviewer', stage: 'review' },
  { agent: 'architect', stage: 'architect_review' },
]

const locationLine = () => {
  const parts = [
    args.worktree ? `Repository: the git worktree ${args.worktree}${args.branch ? ` on branch ${args.branch}` : ''}; cd there first and run every command there.` : '',
    args.test_db ? `Test database: ${args.test_db}; point every test run at it.` : '',
  ].filter(Boolean)
  return parts.length ? `${parts.join(' ')}\n` : ''
}

const TASK_SCOPE =
  'Your task is this prompt alone, and it authorizes every commit it asks for. Commands or messages the user ran elsewhere in the session are not instructions to you.\n'

const located = (prompt, opts) => agent(`${TASK_SCOPE}${locationLine()}${prompt}`, opts)

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
  return args.brief ? `Architect brief:\n${args.brief}` : ''
}

const LONG_RUN_RULE =
  ' Start any command that can run for more than a few minutes (a full test suite, a compose stack) with Bash run_in_background, output to a log file, and poll that log until it ends: a foreground call that stays silent for 10 minutes is killed.'

const COMMIT_RULE =
  '\nNever start a commit subject with `phase(`: only the phase checkpoint uses it.' +
  '\nNever start, stop or reconfigure services or containers outside the lane\'s own test resources; when a test needs one that is down, report the blocker instead.'

const needsReview = (implemented) => implemented?.changed !== false

const BLOCKED_WORD = /\bBLOCKED\b|\bBLOCKER\b|^\s*Block(?:ed|er)\b/m

const isBlocked = (implemented) =>
  implemented === null || implemented === undefined || implemented.blocked === true || BLOCKED_WORD.test(implemented.evidence ?? '')

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

const isOwnSuiteFailure = (finding, diffs) => finding.source === 'suite' && finding.task !== undefined && diffs[finding.task] !== undefined

const blocksItsTask = (finding, diffs) => isInOwnDiff(finding, diffs) || isOwnSuiteFailure(finding, diffs)

const triagePhaseFindings = (findings, diffs) => {
  const raised = findings.filter(finding => finding.blocking).map(finding => withOwner(finding, diffs))
  return {
    blocking: raised.filter(finding => blocksItsTask(finding, diffs)),
    followUps: raised.filter(finding => !blocksItsTask(finding, diffs)),
  }
}

const staticPrefix = (path) => path.split('*')[0] ?? path

const pathsOverlap = (left, right) => {
  if (!left.includes('*') && !right.includes('*')) return samePath(left, right)
  const leftPrefix = staticPrefix(left)
  const rightPrefix = staticPrefix(right)
  return leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix)
}

const overlaps = (left, right) => {
  if (left.touches === undefined || right.touches === undefined) return true
  return left.touches.some(file => (right.touches ?? []).some(other => pathsOverlap(file, other)))
}

const touchesNothing = (task) => task.touches !== undefined && task.touches.length === 0

const isCheckpointTask = (task) => /^\s*(?:P\d+\s+checkpoint|checkpoint\s+P\d+)\b/i.test(task.title)

const inPlanOrderOf = (tasks, members) => [...members].sort((left, right) => tasks.indexOf(left) - tasks.indexOf(right))

const overlapGroups = (tasks) => {
  let groups = []
  for (const task of tasks) {
    const joined = groups.filter(group => group.some(member => overlaps(member, task)))
    groups = [...groups.filter(group => !joined.includes(group)), inPlanOrderOf(tasks, [...joined.flat(), task])]
  }
  return groups.sort((left, right) => tasks.indexOf(left[0]) - tasks.indexOf(right[0]))
}

const segmentsOf = (chain, perImplementer) =>
  Array.from({ length: Math.ceil(chain.length / perImplementer) }, (_, index) => chain.slice(index * perImplementer, (index + 1) * perImplementer))

const implementerChains = (tasks, slots, perImplementer) => {
  const chains = Array.from({ length: Math.max(1, slots) }, () => [])
  for (const group of overlapGroups(tasks.filter(task => !touchesNothing(task)))) {
    const lightest = chains.reduce((best, chain) => (chain.length < best.length ? chain : best))
    lightest.push(...group)
  }
  return {
    chains: chains.filter(chain => chain.length > 0).map(chain => segmentsOf(inPlanOrderOf(tasks, chain), Math.max(1, perImplementer))),
    finale: tasks.filter(touchesNothing),
  }
}

const tasksToRetry = (entries, merge) =>
  entries.filter(entry => entry.changed && !(merge?.merged ?? []).includes(entry.task.id))

const distinctFindings = (findings) => findings.filter((finding, position) => !isCoveredBy(finding, findings.slice(0, position)))

const fixRequests = (entries, blocking) =>
  entries.flatMap(entry => {
    const findings = distinctFindings(blocking.filter(finding => finding.task === entry.task.id))
    return findings.length === 0 ? [] : [{ entry, findings, handoff: entry.handoff ?? '' }]
  })

const checkpointVerdict = (checkpoint) => {
  if (!checkpoint) return { status: 'escalate', evidence: 'checkpoint agent returned nothing' }
  const status = checkpoint.committed && checkpoint.suite_green ? 'checkpointed' : 'escalate'
  return { status, evidence: checkpoint.evidence }
}

const ownerByFile = (file, diffs) => Object.keys(diffs).find(id => (diffs[id] ?? []).some(hunk => samePath(hunk.file, file)))

const checkpointRepairs = (checkpoint, diffs) => {
  if (!checkpoint || (checkpoint.committed && checkpoint.suite_green)) return []
  return (checkpoint.failures ?? []).flatMap(failure => {
    const task = failure.task !== undefined && diffs[failure.task] !== undefined ? failure.task : ownerByFile(failure.file, diffs)
    return task === undefined ? [] : [{ ...failure, task, reviewer: 'checkpoint', source: 'suite', root_cause: 'code-bug', blocking: true }]
  })
}

const IMPLEMENT_INSTRUCTION =
  'Implement it outside-in, red first; tick each plan box in the commit that verifies it. ' +
  'While you work run only the tests of the files you change; the full suite runs once at the checkpoint. ' +
  'Read code by the anchors the brief slice names: the project\'s code graph tools when it has them, else grep -n and line ranges; never print a whole file you only need a part of. ' +
  'Chain an edit\'s test run and commit into one command when you can. Your test setup is in your eager file\'s Test environment section; do not rediscover it.'

const ISOLATION_NOTE = '\nYou run in your own git worktree beside other tasks of this phase: commit on its branch and never merge.'

const handoffPath = task => (args.eager_dir ? args.eager_dir.replace(/\/eager$/, `/handoffs/${args.milestone}-${args.phase}/${task.id}.md`) : '')

const hunkLine = hunk => `- ${hunk.file}:${hunk.start}-${hunk.end}`

const LEAN_FIX_RULE =
  'Read only that plan section, the brief slice and the diff above; do not re-read the full brief, the whole plan or your skills, your agent memory carries the rest. Fix these findings and nothing else.'

const ADDRESS_EVERY_FINDING =
  'Address every finding: fix it, or reject it only by citing a test or a code line in `evidence`; the reviewer rechecks every rejection.'

const mergePrompt = entries =>
  `${lanePrefix()}Merge these ${args.phase} task branches into the current branch in this order, one \`git merge --no-ff <branch>\` each:\n` +
  `${entries.map(entry => `- task ${entry.task.id}: ${entry.branch}`).join('\n')}\n` +
  'When a merge conflicts, run `git merge --abort`, never resolve it by hand, and go on with the next branch. ' +
  'Return the task ids you merged in `merged` and those that conflicted in `conflicted`.'

const mergeWave = entries =>
  located(mergePrompt(entries), {
    agentType: ouroborosAgent('implementer'),
    schema: MERGE_SCHEMA,
    phase: 'Implement',
    label: `merge:${entries.map(entry => entry.task.id).join(',')}`,
    model: 'haiku',
    effort: stageEffort(args.effort, 'merge') ?? 'low',
  })

const NOTHING_MERGED = { merged: [], conflicted: [] }

const LANDED_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          commits: { type: 'array', items: { type: 'string' } },
          hunks: HUNKS_SCHEMA,
          handoff: { type: 'string' },
        },
        required: ['id', 'commits', 'hunks'],
      },
    },
  },
  required: ['tasks'],
}

const landedLine = task => `- task ${task.id} (${task.title})${handoffPath(task) ? `, handoff note ${handoffPath(task)}` : ''}`

const landedPrompt = tasks =>
  `These ${args.milestone} ${args.phase} tasks already landed on the current branch in an earlier run:\n${tasks.map(landedLine).join('\n')}\n` +
  'For each, read its handoff note when it exists, then find its commits on this branch since it left the default branch (git log subjects and bodies, the files the note names). Change nothing and make no commit. ' +
  'Return one entry per task: `id`, `commits`, every line range they changed as `hunks` ({ file, start, end }, lines in the current files, from git diff of those commits) and the note as `handoff`. A task with no commit gets empty `commits` and `hunks`.'

const landedEntryOf = (task, found) =>
  entryOf(task, found && found.commits.length ? { changed: true, blocked: false, commits: found.commits, hunks: found.hunks, evidence: 'landed in an earlier run', branch: '', handoff: found.handoff ?? '' } : { changed: false, blocked: false, commits: [], hunks: [], evidence: 'no commit found for this landed task', branch: '', handoff: '' })

const recoverLanded = async tasks => {
  if (!tasks.length) return []
  const found = await located(landedPrompt(tasks), {
    agentType: ouroborosAgent('implementer'),
    schema: LANDED_SCHEMA,
    phase: 'Implement',
    label: `landed:${tasks.map(task => task.id).join(',')}`,
    model: 'haiku',
    effort: 'low',
  })
  return tasks.map(task => landedEntryOf(task, found && found.tasks.find(entry => entry.id === task.id)))
}

const CHAIN_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          changed: { type: 'boolean' },
          blocked: { type: 'boolean' },
          commits: { type: 'array', items: { type: 'string' } },
          hunks: HUNKS_SCHEMA,
          evidence: { type: 'string' },
          handoff: { type: 'string' },
        },
        required: ['id', 'changed', 'blocked', 'commits', 'hunks', 'evidence', 'handoff'],
      },
    },
  },
  required: ['branch', 'tasks'],
}

const CHAIN_RESULT_INSTRUCTION =
  '\nReturn `branch` (the branch your commits are on) and one entry per task in `tasks`: `id`, `changed` (false only when you committed no code change for it), ' +
  '`blocked` (true when you could not do it, e.g. a tool refused or a dependency is missing; name the blocker in `evidence`), `commits` (its shas), ' +
  '`hunks` (every line range it changed as { file, start, end }, file relative to the repository root, lines in the new file), `evidence` (commands run and their decisive output) ' +
  'and `handoff` (at most 300 words for whoever works on it next: decisions and why, gotchas, the exact test commands that prove it, files left alone and why).'

const SEQUENCE_RULE =
  'Do the tasks one after another in this order, each fully (red, green, its plan boxes ticked, its own commits) before the next; reuse what you learnt in earlier tasks instead of re-reading code you already know. '

const lanePreambles = tasks => [...new Set(tasks.map(implementerFile))].map(eagerPreamble).join('')

const handoffFilesNote = tasks =>
  handoffPath(tasks[0]) ? `\nAlso write each task's handoff note to its file (${tasks.map(handoffPath).join(', ')}), replacing any older one, so it survives this session.` : ''

const taskBlock = task => `- ${lanePrefix(task)}task ${task.id}: ${task.title}. ${planReference(task)} ${briefText(task)}`

const takeOverText = previous =>
  previous.length ? `You take over from the implementer before you on this branch; its handoff notes:\n${previous.map(note => `- task ${note.id}: ${note.handoff || 'none left'}`).join('\n')}\n` : ''

const branchStart = (branchFrom, key) =>
  branchFrom ? `First run \`git checkout -B ${args.milestone.toLowerCase()}-${args.phase.toLowerCase()}-${key} ${branchFrom}\` and work on that branch.\n` : ''

const chainPrompt = (segment, previous, isolated, branchFrom, key) =>
  `${lanePreambles(segment)}${args.milestone} ${args.phase}: implement these tasks.\n${segment.map(taskBlock).join('\n')}\n${takeOverText(previous)}${branchStart(branchFrom, key)}` +
  `${SEQUENCE_RULE}${IMPLEMENT_INSTRUCTION}${isolated ? ISOLATION_NOTE : ''}${COMMIT_RULE}${CHAIN_RESULT_INSTRUCTION}${handoffFilesNote(segment)}`

const isolationOf = isolated => (isolated ? { isolation: 'worktree' } : {})

const idsOf = tasks => tasks.map(task => task.id).join(',')

const implementSegment = (segment, previous, isolated, branchFrom, key) =>
  located(chainPrompt(segment, previous, isolated, branchFrom, key), {
    agentType: ouroborosAgent('implementer'),
    schema: CHAIN_SCHEMA,
    phase: 'Implement',
    label: `implement:${idsOf(segment)}${isolated ? ':worktree' : ''}`,
    effort: stageEffort(args.effort, 'implement'),
    ...isolationOf(isolated),
  })

const taskOutcome = (result, task) => {
  const found = result ? result.tasks.find(entry => entry.id === task.id) : undefined
  return found ? { ...found, branch: result.branch } : null
}

const entriesOf = (tasks, result) => tasks.map(task => entryOf(task, taskOutcome(result, task)))

const notesOf = entries => entries.map(entry => ({ id: entry.task.id, handoff: entry.handoff }))

const runChain = async (chain, isolated, key) => {
  const entries = []
  let previous = []
  let branch = ''
  for (const segment of chain) {
    const result = await implementSegment(segment, previous, isolated, isolated ? branch || args.branch || '' : '', key)
    const segmentEntries = entriesOf(segment, result)
    entries.push(...segmentEntries)
    previous = notesOf(segmentEntries)
    branch = (result && result.branch) || branch
  }
  return { key, entries, branch }
}

const runInPlace = async (tasks, previous) => {
  if (!tasks.length) return []
  const entries = []
  let notes = previous
  for (const segment of segmentsOf(tasks, perImplementer())) {
    const segmentEntries = entriesOf(segment, await implementSegment(segment, notes, false, '', 'in-place'))
    entries.push(...segmentEntries)
    notes = notesOf(segmentEntries)
  }
  return entries
}

const rebaseChainPrompt = ran =>
  `${lanePreambles(ran.entries.map(entry => entry.task))}${args.milestone} ${args.phase}: these tasks already exist on branch ${ran.branch} but merging it conflicted with another implementer's work:\n` +
  `${ran.entries.map(entry => `${taskBlock(entry.task)} Commits: ${entry.commits.join(', ') || 'none'}.`).join('\n')}\n${takeOverText(notesOf(ran.entries))}` +
  'Cherry-pick those commits onto the current branch in order and resolve each conflict by keeping both sides\' intent; run the tasks\' tests. ' +
  `Implement a task from scratch only when its cherry-pick cannot be resolved that way (\`git cherry-pick --abort\` first).${COMMIT_RULE}${CHAIN_RESULT_INSTRUCTION}`

const rebaseChain = async ran =>
  entriesOf(
    ran.entries.map(entry => entry.task),
    await located(rebaseChainPrompt(ran), {
      agentType: ouroborosAgent('implementer'),
      schema: CHAIN_SCHEMA,
      phase: 'Implement',
      label: `rebase:${idsOf(ran.entries.map(entry => entry.task))}`,
      effort: stageEffort(args.effort, 'implement'),
    }),
  )

const chainRecord = ran => ({ task: { id: ran.key }, changed: ran.entries.some(entry => entry.changed), branch: ran.branch })

const mergedChains = async ranChains => {
  const records = ranChains.map(chainRecord)
  const branches = records.filter(record => record.changed && record.branch)
  const merge = branches.length ? await mergeWave(branches) : NOTHING_MERGED
  const toRebase = tasksToRetry(records, merge).map(record => record.task.id)
  const entries = []
  for (const ran of ranChains) entries.push(...(toRebase.includes(ran.key) ? await rebaseChain(ran) : ran.entries))
  return entries
}

const withBlockedRedone = async entries => {
  const blocked = entries.filter(entry => entry.blocked)
  if (!blocked.length) return entries
  log(`${args.phase}: task ${idsOf(blocked.map(entry => entry.task))} blocked in a worktree; running in place`)
  const redone = await runInPlace(blocked.map(entry => entry.task), notesOf(entries.filter(entry => !entry.blocked)))
  return entries.map(entry => redone.find(retry => retry.task.id === entry.task.id) ?? entry)
}

const perImplementer = () => args.tasks_per_implementer ?? 4

const canIsolate = () => !args.worktree

const implementerSlots = () => (canIsolate() ? (args.implementer_slots ?? 3) : 1)

const CHAIN_OF = {}

const implementAll = async tasks => {
  const plan = implementerChains(tasks, implementerSlots(), perImplementer())
  plan.chains.forEach((chain, index) => chain.flat().forEach(task => (CHAIN_OF[task.id] = `c${index + 1}`)))
  log(`${args.phase}: ${plan.chains.length} implementer chain(s): ${plan.chains.map(chain => chain.map(idsOf).join(' then ')).join(' | ')}${plan.finale.length ? `; then ${idsOf(plan.finale)}` : ''}`)
  const parallelRun = plan.chains.length > 1
  const ranChains = parallelRun
    ? (await parallel(plan.chains.map((chain, index) => () => runChain(chain, true, `c${index + 1}`)))).filter(Boolean)
    : [await runChain(plan.chains[0] ?? [], false, 'c1')]
  const chained = parallelRun ? await withBlockedRedone(await mergedChains(ranChains)) : ranChains.flatMap(ran => ran.entries)
  return [...chained, ...(await runInPlace(plan.finale, notesOf(chained)))]
}

const inPlanOrder = (entries, tasks) => tasks.map(task => entries.find(entry => entry.task.id === task.id)).filter(Boolean)

const commonBrief = () => (args.brief_dir ? `Common brief: ${args.brief_dir}/common.md; each task's slice is ${args.brief_dir}/<task id>.md.\n` : '')

const taskLine = entry => `- task ${entry.task.id} (${entry.task.title}): commits ${entry.commits.join(', ') || 'none'}`

const REVIEW_RULES =
  'Name the task each finding belongs to in `task`. A finding blocks only when its file and line fall inside that task\'s diff; ' +
  'anything about code outside it is recorded as a follow-up in the plan and never blocks. Return every finding with its root cause; mark blocking ones. ' +
  'Return findings only in the structured result; print no fenced findings block.'

const reviewPrompt = (reviewer, entries) =>
  eagerPreamble(`${reviewer}.md`) +
  commonBrief() +
  `Review the whole ${args.phase} diff on the current branch as the ${reviewer}. Tasks:\n${entries.map(taskLine).join('\n')}\n${REVIEW_RULES}`

const recheckPrompt = (reviewer, entries, blocking) =>
  `As the ${reviewer}, re-check these blocking findings on the ${args.phase} diff after the fixes:\n${JSON.stringify(blocking)}\n` +
  `Read only these findings and the fix commits; do not re-read the brief, the plan or your skills. Report each one still open (keep its \`source\`; rerun the failing test of a suite failure) and anything the fixes broke; do not review the rest again. Tasks:\n${entries.map(taskLine).join('\n')}\n${REVIEW_RULES}`

const roundPrompt = (reviewer, round, entries, blocking) => (round === 1 ? reviewPrompt(reviewer, entries) : recheckPrompt(reviewer, entries, blocking))

const review = (reviewer, round, entries, blocking) =>
  located(roundPrompt(reviewer.agent, round, entries, blocking), {
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

const FIX_LOG = []

const fixOutcome = fixed => {
  if (isBlocked(fixed)) return 'blocked'
  return (fixed.commits ?? []).length ? 'fixed' : 'unchanged'
}

const NO_RESUME_REASON = 'a workflow cannot continue an agent it started yet (docs/upstream-requests.md)'

const logFix = (entry, round, fixed) => FIX_LOG.push({ task: entry.task.id, round, mode: 'handoff', reason: NO_RESUME_REASON, outcome: fixOutcome(fixed) })

const recordFix = (entry, fixed) => {
  if (!fixed) return []
  if (fixed.handoff) entry.handoff = fixed.handoff
  entry.commits.push(...(fixed.commits ?? []))
  entry.hunks.push(...(fixed.hunks ?? []))
  return fixed.hunks ?? []
}

const fixUnitBlock = request =>
  `${taskBlock(request.entry.task)}\n  Diff (commits ${request.entry.commits.join(', ') || 'none'}):\n${request.entry.hunks.map(hunk => `  ${hunkLine(hunk)}`).join('\n')}\n` +
  `  Handoff note: ${request.handoff || 'none was left; rebuild what you need from the diff.'}\n  Blocking findings: ${JSON.stringify(request.findings)}`

const fixPrompt = (unit, isolated) =>
  `${args.milestone} ${args.phase}: fix round for these tasks.\n${unit.requests.map(fixUnitBlock).join('\n')}\n${LEAN_FIX_RULE}\n${ADDRESS_EVERY_FINDING}` +
  `${isolated ? ISOLATION_NOTE : ''}${COMMIT_RULE}${CHAIN_RESULT_INSTRUCTION}${handoffFilesNote(unit.requests.map(request => request.entry.task))}`

const fix = (unit, round, isolated) =>
  located(fixPrompt(unit, isolated), {
    agentType: ouroborosAgent('implementer'),
    schema: CHAIN_SCHEMA,
    phase: 'Review',
    label: `fix:${idsOf(unit.requests.map(request => request.entry.task))}:r${round}${isolated ? ':worktree' : ''}`,
    effort: stageEffort(args.effort, 'fix'),
    ...isolationOf(isolated),
  })

const applyFix = (unit, round, result) =>
  unit.requests.flatMap(request => {
    const fixed = taskOutcome(result, request.entry.task)
    logFix(request.entry, round, fixed)
    return recordFix(request.entry, fixed)
  })

const fixInPlace = async (unit, round) => applyFix(unit, round, await fix(unit, round, false))

const fixUnits = requests => {
  const units = new Map()
  for (const request of requests) {
    const key = CHAIN_OF[request.entry.task.id] ?? 'rest'
    units.set(key, [...(units.get(key) ?? []), request])
  }
  return [...units].map(([key, grouped]) => ({ key, requests: grouped }))
}

const fixParallel = async (units, round) => {
  const results = await parallel(units.map(unit => () => fix(unit, round, true)))
  const records = units.map((unit, position) => ({ task: { id: unit.key }, changed: Boolean(results[position]), branch: (results[position] && results[position].branch) || '' }))
  const branches = records.filter(record => record.changed && record.branch)
  const merge = branches.length ? await mergeWave(branches) : NOTHING_MERGED
  const redo = tasksToRetry(records, merge).map(record => record.task.id)
  const hunks = units.filter(unit => merge.merged.includes(unit.key)).flatMap(unit => applyFix(unit, round, results[units.indexOf(unit)]))
  for (const unit of units.filter(candidate => redo.includes(candidate.key))) hunks.push(...(await fixInPlace(unit, round)))
  return hunks
}

const fixRound = async (entries, blocking, round) => {
  const units = fixUnits(fixRequests(entries, blocking))
  if (units.length > 1 && canIsolate()) return fixParallel(units, round)
  const hunks = []
  for (const unit of units) hunks.push(...(await fixInPlace(unit, round)))
  return hunks
}

const reviewPhase = async entries => {
  const findings = []
  const followUps = []
  let blocking = []
  let fixHunks = []
  for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
    if (round > 1) fixHunks = await fixRound(entries, blocking, round)
    const raised = await reviewRound(reviewersForRound(round, MAX_REVIEW_ROUNDS, REVIEWERS, blocking, fixHunks), round, entries, blocking)
    findings.push(...raised)
    const triaged = triagePhaseFindings(raised, diffsOf(entries))
    followUps.push(...triaged.followUps)
    blocking = triaged.blocking
    if (!blocking.length) return { blocking, findings, followUps, rounds: round }
  }
  return { blocking, findings, followUps, rounds: MAX_REVIEW_ROUNDS }
}

const NOT_REVIEWED = { blocking: [], findings: [], followUps: [], rounds: 0 }

const entryOf = (task, implemented) => ({
  task,
  changed: needsReview(implemented),
  blocked: isBlocked(implemented),
  commits: implemented?.commits ?? [],
  hunks: implemented?.hunks ?? [],
  evidence: implemented?.evidence ?? 'implementer returned nothing',
  branch: implemented?.branch ?? '',
  handoff: implemented?.handoff ?? '',
})

const taskResult = (entry, outcome) => {
  if (entry.blocked) return { id: entry.task.id, status: 'escalate', commits: entry.commits, evidence: entry.evidence, findings: [] }
  if (!entry.changed) return { id: entry.task.id, status: 'verified', commits: [], evidence: entry.evidence, findings: [] }
  const escalated = blockingOf(entry, outcome.blocking).length > 0
  const findings = outcome.findings.filter(finding => finding.task === entry.task.id)
  return { id: entry.task.id, status: escalated ? 'escalate' : 'done', commits: entry.commits, evidence: entry.evidence, findings }
}

const touchedLanes = () => [...new Set((args.tasks ?? []).map(laneOf).filter(Boolean))]

const laneScope = () => {
  const lanes = touchedLanes()
  return lanes.length ? `of lane${lanes.length > 1 ? 's' : ''} ${lanes.join(', ')} (the lanes this phase touched)` : 'of every lane'
}

const checkpointPrompt = () =>
  `${eagerPreamble('auditor.md')}${lanePrefix()}Run the ${args.milestone} checks that ${args.phase} touches and the full test and lint commands ` +
  `${laneScope()} in .claude/ouroboros.json. ` +
  `Only when every one is green, commit with subject "phase(${args.phase}): <summary>"; otherwise make no commit. ` +
  'Return `committed`, the commit `sha` (empty when none), `suite_green` and the `evidence` (commands, exit codes, decisive output). ' +
  'When anything is red, list each failing example in `failures` (file, line, one-sentence summary, and `task` when git blame shows whose commits broke it). ' +
  'Skip every plan step marked `(needs: <resource>)`: it needs something only a person has (credentials, production data). List each in `manual_steps` as "<task>: <step> (needs: <resource>)"; it never makes the checkpoint red.' +
  LONG_RUN_RULE

const checkpoint = () =>
  located(checkpointPrompt(), {
    agentType: ouroborosAgent('auditor'),
    schema: CHECKPOINT_SCHEMA,
    phase: 'Checkpoint',
    effort: stageEffort(args.effort, 'checkpoint'),
  })

const manualChecklist = steps => (steps.length ? `\nBefore merging, a person must do these (put them in the description as unchecked boxes):\n${steps.map(step => `- [ ] ${step}`).join('\n')}` : '')

const reviewSummary = summary =>
  `Review rounds: ${summary.review_rounds}. Tasks: ${summary.tasks.map(task => `${task.id} ${task.status}`).join(', ')}. ` +
  `Follow-ups added to the plan: ${summary.follow_ups.length}.${manualChecklist(summary.manual_steps ?? [])}`

const pullRequestPrompt = (summary, evidence) =>
  `${lanePrefix()}${args.milestone} ${args.phase} is checkpointed. Push the milestone branch and open a pull request from it into the default branch, ` +
  `titled "${args.milestone} ${args.phase}: <one-line summary>", following the repository's PR conventions. ` +
  `Put this in the description:\n${reviewSummary(summary)}\nCheckpoint evidence:\n${evidence}\n` +
  'When an open PR from this branch already exists, update its title and description instead. Never merge it: the user reviews and merges. Return its `pr_url`.'

const openPullRequest = (summary, evidence) =>
  located(pullRequestPrompt(summary, evidence), {
    agentType: ouroborosAgent('implementer'),
    schema: PR_SCHEMA,
    phase: 'Pull request',
    model: 'haiku',
    effort: stageEffort(args.effort, 'merge') ?? 'low',
  })

const freshBranchPrompt = () =>
  `${args.milestone} ${args.phase} starts on a fresh branch: the previous phase PR was merged into the default branch. ` +
  `Run \`git fetch origin\`, then create and switch to \`${args.fresh_branch}\` from the default branch's origin tip. ` +
  'Never merge or rebase the old milestone branch. Return the `branch` you are on and its `base` commit.'

const startFreshBranch = () =>
  located(freshBranchPrompt(), {
    agentType: ouroborosAgent('implementer'),
    schema: BRANCH_SCHEMA,
    phase: 'Branch',
    model: 'haiku',
    effort: stageEffort(args.effort, 'merge') ?? 'low',
  })

const opensPullRequest = () => args.merge_policy !== 'architect'

const syncPrompt = () =>
  `${args.milestone} ${args.phase} is implemented. Run \`git fetch origin\` and merge the default branch's origin tip into the current branch with \`git merge --no-edit\`. ` +
  'When it conflicts, run `git merge --abort`, never resolve it by hand, and return `synced` false with the `conflicted_files`. Otherwise return `synced` true and no files.'

const syncDefaultBranch = () =>
  located(syncPrompt(), {
    agentType: ouroborosAgent('implementer'),
    schema: SYNC_SCHEMA,
    phase: 'Sync',
    model: 'haiku',
    effort: 'low',
  })

const syncGap = synced => {
  if (!synced) return 'default branch sync returned nothing'
  return synced.synced ? undefined : `the default branch conflicts with ${args.phase} in ${synced.conflicted_files.join(', ') || 'unnamed files'}`
}

if (args.fresh_branch) {
  phase('Branch')
  const branched = await startFreshBranch()
  if (!branched || branched.branch !== args.fresh_branch) return { status: 'escalate', phase: args.phase, tasks: [], follow_ups: [], evidence: '', failing_gate: `fresh branch ${args.fresh_branch} not created` }
}

const refreshPrompt = () =>
  `${args.milestone} ${args.phase} is about to start from the brief in ${args.brief_dir}. Run \`git fetch origin\`, then list what merged into the default branch's origin tip since ${args.brief_dir}/common.md last changed ` +
  '(git log of the origin tip after that file\'s modification time; merge subjects, PR titles, and the names their diffs add or rename). ' +
  `When any of it changes names, APIs or tables the tasks of ${args.phase} will use (${(args.tasks ?? []).map(task => task.id).join(', ') || 'see the task slices'}), append a \`## Landed since this brief\` section to common.md with one line per change; otherwise change nothing. ` +
  'Make no commit: the brief is runtime state. Return `appended` and the `landed` lines.'

const refreshBrief = () =>
  located(refreshPrompt(), {
    agentType: ouroborosAgent('architect'),
    schema: REFRESH_SCHEMA,
    phase: 'Brief',
    model: 'haiku',
    effort: 'low',
  })

if (args.brief_dir && (args.tasks ?? []).length) {
  phase('Brief')
  const refreshed = await refreshBrief()
  if (refreshed && refreshed.appended) log(`${args.phase}: brief refreshed with ${refreshed.landed.length} change(s) landed since it was written`)
}

phase('Implement')
const checkpointTasks = (args.tasks ?? []).filter(isCheckpointTask)
if (checkpointTasks.length) log(`${args.phase}: skipping ${checkpointTasks.map(task => task.id).join(', ')}, the checkpoint stage does that work`)
const tasks = (args.tasks ?? []).filter(task => !isCheckpointTask(task))
const landed = (args.landed ?? []).filter(task => !isCheckpointTask(task))
if (!tasks.length && !landed.length) log(`${args.phase}: no tasks passed in args; nothing to implement`)
const landedEntries = await recoverLanded(landed)
const implementedEntries = tasks.length ? await implementAll(tasks) : []
const entries = inPlanOrder([...landedEntries.filter(Boolean), ...implementedEntries], [...landed, ...tasks])

const blockedEntries = entries.filter(entry => entry.blocked)
if (blockedEntries.length) {
  const unreviewed = { phase: args.phase, tasks: entries.map(entry => taskResult(entry, NOT_REVIEWED)), follow_ups: [], review_rounds: 0 }
  return { status: 'escalate', ...unreviewed, evidence: '', failing_gate: `blocked: ${blockedEntries.map(entry => `task ${entry.task.id} (${entry.evidence.slice(0, 160)})`).join('; ')}` }
}

const reviewed = entries.filter(entry => entry.changed)
if (opensPullRequest()) {
  phase('Sync')
  const gap = syncGap(await syncDefaultBranch())
  if (gap) return { status: 'escalate', phase: args.phase, tasks: entries.map(entry => taskResult(entry, NOT_REVIEWED)), follow_ups: [], review_rounds: 0, evidence: '', failing_gate: gap }
}

phase('Review')
const outcome = reviewed.length ? await reviewPhase(reviewed) : NOT_REVIEWED
const summary = { phase: args.phase, tasks: entries.map(entry => taskResult(entry, outcome)), follow_ups: outcome.followUps, review_rounds: outcome.rounds, fixes: FIX_LOG }
if (outcome.blocking.length) return { status: 'escalate', ...summary, evidence: '' }

phase('Checkpoint')
const repairedCheckpoint = async first => {
  const repairs = checkpointRepairs(first, diffsOf(reviewed))
  if (!repairs.length) return first
  log(`${args.phase}: checkpoint red; one fix round for task ${[...new Set(repairs.map(repair => repair.task))].join(', ')}, then the checkpoint again`)
  await fixRound(reviewed, repairs, 'checkpoint')
  return checkpoint()
}
const checkpointed = await repairedCheckpoint(await checkpoint())
const verdict = checkpointVerdict(checkpointed)
const checkpointSha = checkpointed ? checkpointed.sha : ''
if (verdict.status !== 'checkpointed') return { status: verdict.status, ...summary, evidence: verdict.evidence }

summary.manual_steps = (checkpointed && checkpointed.manual_steps) || []
if (!opensPullRequest()) return { status: 'checkpointed', ...summary, evidence: verdict.evidence, checkpoint_sha: checkpointSha }

phase('Pull request')
const opened = await openPullRequest(summary, verdict.evidence)
if (!opened) return { status: 'escalate', ...summary, evidence: verdict.evidence, failing_gate: 'phase PR not opened' }
return { status: 'checkpointed', ...summary, evidence: verdict.evidence, checkpoint_sha: checkpointSha, pr_url: opened.pr_url, merged: false }
