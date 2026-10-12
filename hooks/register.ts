import type { EngineInterface, Register } from 'claude-code'

import { WORKFLOWS_QUERY, autoCloseProblems, boardProblems, doctorAnswer, labelProblems, loginOf, prdProblems, pushProblems, scopeProblems } from './github/doctor'
import { milestoneGaps, renderMilestoneBody } from './github/contract'
import type { MilestoneBody } from './github/contract'
import {
  addLabelCommand,
  addToBoardCommand,
  boardIdsOf,
  closePullRequestCommand,
  commentCommand,
  createSubIssueCommand,
  creationOrder,
  deleteBranchCommand,
  deleteCommentCommand,
  developCommand,
  dropCommand,
  editIssueCommand,
  githubConfigOf,
  issueOfPosition,
  linkSubIssueCommand,
  linkedBranchOf,
  linkedBranchesCommand,
  pullRequestCommand,
  removeLabelCommand,
  setColumnCommand,
  shellCommand,
} from './github/gh_commands'
import type { BoardIds, Column, GhCommand, GithubConfig, GithubSettings } from './github/gh_commands'
import { architectResult, kickoffAnswer, kickoffIssueNumber, milestoneColumn, prdSection } from './github/kickoff_issue'
import { kickoffChanges, plannedBody } from './github/kickoff_plan'
import type { KickoffChanges, PlannedTask } from './github/kickoff_plan'
import { MAX_REVIEW_ROUNDS, branchName, escalationComment, nextSubIssue, readinessComment, reviewOutcome, stageComment } from './loop'
import type { BoardSubIssue, Review } from './loop'
import { implementPrompt, kickoffPrompt, reviewPrompt } from './prompts'
import type { KickoffBrief, StageBrief } from './prompts'

type Stage = 'kickoff' | 'implement' | 'review'
type Launch = { agent: string; stage: Stage; label: string; brief: string }
type LoopState = {
  milestone?: number
  stage?: Stage
  label?: string
  pending?: Launch
  run?: string
  issue?: number
  title?: string
  branch?: string
  base?: string
  round: number
  defects?: string[]
  tip?: string
}
type Config = { prd?: string; branch_prefix?: string; github?: GithubSettings }
type StageResult = { status?: string; question?: string } & Partial<Review>

const CONFIG_PATH = '.claude/ouroboros.json'
const RUNTIME_DIR = '.claude/ouroboros'
const STATE_PATH = `${RUNTIME_DIR}/state.json`
const BRIEFS_DIR = `${RUNTIME_DIR}/briefs`
const STAGE_WORKFLOW = 'stage'
const OUTPUT_FILE = /<output-file>([^<]+)<\/output-file>/
const IDLE: LoopState = { round: 0 }
const AGENTS: Record<Stage, string> = { kickoff: 'architect', implement: 'implementer', review: 'reviewer' }

const OUROBOROS_COMMAND = {
  name: 'ouroboros',
  description: 'GitHub milestone loop: /ouroboros kickoff <milestone-issue> | start <milestone-issue> | status | stop | doctor',
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean)

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const loudly = (error: unknown) => `ouroboros: ${messageOf(error)}`

async function run($: EngineInterface, argv: string[], stdin?: string) {
  const { exitCode, stdout, stderr } = await $.process.run(argv, stdin === undefined ? undefined : { stdin })
  if (exitCode !== 0) throw new Error(`\`${shellCommand(argv)}\` failed: ${stderr.trim() || stdout.trim()}`)
  return stdout.trim()
}

const gh = ($: EngineInterface, command: GhCommand) => run($, command.argv, command.stdin)

let stageInverses: GhCommand[] = []

const undoWith = (inverse: GhCommand | undefined) => {
  if (inverse !== undefined) stageInverses.push(inverse)
}

async function rollBack($: EngineInterface, inverses: GhCommand[]) {
  const failures: string[] = []
  for (const inverse of [...inverses].reverse()) await gh($, inverse).catch(error => failures.push(messageOf(error)))
  return failures
}

async function undoingOnFailure($: EngineInterface, stage: () => Promise<string>) {
  stageInverses = []
  try {
    return await stage()
  } catch (error) {
    const failures = await rollBack($, stageInverses)
    await writeState($, withoutStage(await readState($)))
    const restored = failures.length === 0 ? 'GitHub is back as it was before the stage' : `undoing the stage also failed: ${failures.join('; ')}`
    throw new Error(`stopped: ${messageOf(error)}; ${restored}`)
  } finally {
    stageInverses = []
  }
}

async function editIssue($: EngineInterface, repo: string, previous: { number: number; title: string; body: string }, title: string, body: string) {
  undoWith(editIssueCommand(repo, previous.number, previous.title, previous.body))
  await gh($, editIssueCommand(repo, previous.number, title, body))
}

async function comment($: EngineInterface, repo: string, number: number, text: string) {
  undoWith(deleteCommentCommand(repo, await gh($, commentCommand(repo, number, text))))
}

async function repositoryRoot($: EngineInterface) {
  const { stdout } = await $.process.run(['git', 'rev-parse', '--show-toplevel'])
  return stdout.trim() || (await $.session.cwd())
}

async function projectPath($: EngineInterface, relative: string) {
  return `${await repositoryRoot($)}/${relative}`
}

async function readConfig($: EngineInterface): Promise<Config | undefined> {
  const path = await projectPath($, CONFIG_PATH)
  return (await $.fs.exists(path)) ? JSON.parse(await $.fs.read(path)) : undefined
}

async function readState($: EngineInterface): Promise<LoopState> {
  const path = await projectPath($, STATE_PATH)
  return (await $.fs.exists(path)) ? { ...IDLE, ...JSON.parse(await $.fs.read(path)) } : IDLE
}

async function writeRuntimeFile($: EngineInterface, relative: string, text: string) {
  const ignore = await projectPath($, `${RUNTIME_DIR}/.gitignore`)
  if (!(await $.fs.exists(ignore))) await $.fs.write(ignore, '*\n')
  const path = await projectPath($, relative)
  await $.fs.write(path, text)
  return path
}

const writeState = ($: EngineInterface, state: LoopState) => writeRuntimeFile($, STATE_PATH, JSON.stringify(state, null, 2))

const withoutStage = (state: LoopState): LoopState => ({ ...state, stage: undefined, label: undefined, pending: undefined, run: undefined })

async function githubConfig($: EngineInterface, config: Config): Promise<GithubConfig> {
  const github = githubConfigOf(config.github)
  if (github.repo !== undefined) return github
  return { ...github, repo: await run($, ['gh', 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']) }
}

const ownerOf = (github: GithubConfig) => (github.repo ?? '').split('/')[0] ?? ''

async function boardAnswers($: EngineInterface, github: GithubConfig) {
  const owner = ownerOf(github)
  const projects = JSON.parse(await run($, ['gh', 'project', 'list', '--owner', owner, '--limit', '100', '--format', 'json']))
  const project = projects.projects.find((candidate: { title: string }) => candidate.title === github.project)
  const fields = project === undefined ? { fields: [] } : JSON.parse(await run($, ['gh', 'project', 'field-list', String(project.number), '--owner', owner, '--format', 'json']))
  return { projects, fields }
}

async function boardIds($: EngineInterface, github: GithubConfig) {
  const { projects, fields } = await boardAnswers($, github)
  return boardIdsOf(projects, fields, github)
}

type Board = { github: GithubConfig; ids: BoardIds; config: Config }

async function board($: EngineInterface): Promise<Board | string> {
  const config = await readConfig($)
  if (config === undefined) return `no ${CONFIG_PATH} at the checkout root: create one (README, Setup)`
  const github = await githubConfig($, config)
  if (github.project === undefined) return `ouroboros needs github.project in ${CONFIG_PATH}`
  const ids = await boardIds($, github)
  return 'missing' in ids ? `ouroboros needs ${ids.missing}` : { github, ids, config }
}

async function readIssue($: EngineInterface, github: GithubConfig, number: number) {
  return JSON.parse(await run($, ['gh', 'issue', 'view', String(number), '-R', github.repo ?? '', '--json', 'number,title,body'])) as { number: number; title: string; body: string }
}

async function issueColumn($: EngineInterface, github: GithubConfig, number: number) {
  const items = JSON.parse(await run($, ['gh', 'issue', 'view', String(number), '-R', github.repo ?? '', '--json', 'projectItems', '--jq', '.projectItems']))
  return milestoneColumn(items, github.project ?? '')
}

async function readSubIssues($: EngineInterface, github: GithubConfig, milestone: number): Promise<BoardSubIssue[]> {
  const lines = await run($, ['gh', 'api', `repos/${github.repo}/issues/${milestone}/sub_issues`, '--paginate', '--jq', '.[] | {number, state, title, body, labels: [.labels[].name]}'])
  const subIssues = lines.split('\n').filter(Boolean).map(line => JSON.parse(line) as BoardSubIssue)
  return Promise.all(subIssues.map(async subIssue => ({ ...subIssue, labels: subIssue.labels ?? [], column: await issueColumn($, github, subIssue.number) })))
}

const issueUrl = (github: GithubConfig, number: number) => `https://github.com/${github.repo}/issues/${number}`

const columnNamed = (github: GithubConfig, name: string | undefined) => (Object.entries(github.columns) as Array<[Column, string]>).find(([, each]) => each === name)?.[0]

async function moveToColumn($: EngineInterface, { github, ids }: Board, number: number, column: Column, note?: string) {
  const previous = columnNamed(github, await issueColumn($, github, number))
  const itemId = await gh($, addToBoardCommand(ownerOf(github), ids, issueUrl(github, number)))
  if (previous !== undefined) undoWith(setColumnCommand(ids, itemId, previous))
  await gh($, setColumnCommand(ids, itemId, column))
  if (note !== undefined) await comment($, github.repo ?? '', number, note)
}

const stageDetail = (state: LoopState, round: number, pullRequest?: string) => ({ branch: state.branch as string, base: state.base as string, round, pullRequest })

const labelOf = (state: LoopState, stage: Stage) => (stage === 'kickoff' ? `kickoff:#${state.milestone}` : `${stage}:#${state.issue} round ${state.round + 1}`)

const spokenLabel = (label: string) => label.replace(':', ' ')

const workflowCall = (launch: Launch) => `Workflow name=${launch.agent.split(':')[0]}:${STAGE_WORKFLOW}`

const launchNote = (launch: Launch) => `ouroboros: next, ${spokenLabel(launch.label)}. Launch it: ${workflowCall(launch)}`

const submitWhenIdle = ($: EngineInterface, text: string) =>
  $.clock.after(0, () => {
    $.prompt.submit({ text }).catch(error => $.ui.toast(loudly(error)))
  })

async function offerStage($: EngineInterface, state: LoopState, stage: Stage, prompt: string) {
  const label = labelOf(state, stage)
  const brief = await writeRuntimeFile($, `${BRIEFS_DIR}/${label.replace(/\W+/g, '-')}.md`, prompt)
  const pending: Launch = { agent: `${$.plugin.name}:${AGENTS[stage]}`, stage, label, brief }
  await writeState($, { ...state, stage, label, pending, run: undefined })
  submitWhenIdle($, launchNote(pending))
}

const isStageWorkflow = (name: string | undefined) => (name ?? '').split(':').pop() === STAGE_WORKFLOW

async function milestonePrdSection($: EngineInterface, config: Config, title: string) {
  const prd = config.prd ?? 'docs/prd.md'
  const path = await projectPath($, prd)
  if (!(await $.fs.exists(path))) return { refusal: `no PRD at ${prd}: set prd in ${CONFIG_PATH}` }
  const found = prdSection(await $.fs.read(path), title)
  return 'section' in found ? found : { refusal: `no heading of ${prd} matches "${title}"; headings: ${found.headings.join(', ')}` }
}

const busy = (state: LoopState) => (state.run === undefined ? undefined : `ouroboros is running ${state.label}; wait for its result, or /ouroboros stop`)

async function kickoff($: EngineInterface, state: LoopState, argument: string) {
  const number = kickoffIssueNumber(argument)
  if (number === undefined) return 'usage: /ouroboros kickoff <milestone-issue>'
  const refusal = busy(state)
  if (refusal !== undefined) return refusal
  const found = await board($)
  if (typeof found === 'string') return found
  const milestone = await readIssue($, found.github, number)
  if ((await issueColumn($, found.github, number)) !== found.github.columns.milestones) return `#${number} is not in the "${found.github.columns.milestones}" column of "${found.github.project}"`
  const prd = await milestonePrdSection($, found.config, milestone.title)
  if ('refusal' in prd) return prd.refusal
  const sub_issues = (await readSubIssues($, found.github, number)).map(({ number, state, title, body }) => ({ number, state, title, body }))
  const brief: KickoffBrief = { issue: number, title: milestone.title, prd_section: prd.section, milestone_body: milestone.body, sub_issues }
  await offerStage($, { ...(state.milestone === number ? state : IDLE), milestone: number }, 'kickoff', kickoffPrompt(brief))
  return `kickoff #${number}: the architect is planning ${sub_issues.length === 0 ? 'its sub-issues' : `against ${sub_issues.length} existing sub-issues`}`
}

async function createSubIssue($: EngineInterface, github: GithubConfig, milestone: number, title: string, body: string) {
  const number = Number((await gh($, createSubIssueCommand(github.repo ?? '', title, body))).split('/').pop())
  const id = Number(await run($, ['gh', 'api', `repos/${github.repo}/issues/${number}`, '--jq', '.id']))
  await gh($, linkSubIssueCommand(github.repo ?? '', milestone, id))
  return number
}

async function applyKickoffChanges($: EngineInterface, found: Board, milestone: number, tasks: PlannedTask[], changes: KickoffChanges) {
  const { github } = found
  const created = new Map<number, number>()
  const bodyOf = (task: PlannedTask) => plannedBody(task, issueOfPosition(tasks, created))
  for (const position of creationOrder(tasks, changes.create)) {
    const task = tasks[position - 1] as PlannedTask
    created.set(position, await createSubIssue($, github, milestone, task.title, bodyOf(task)))
  }
  for (const number of changes.update) {
    const task = tasks.find(candidate => candidate.issue === number) as PlannedTask
    await editIssue($, github.repo ?? '', await readIssue($, github, number), task.title, bodyOf(task))
  }
  for (const number of changes.drop) await gh($, dropCommand(github.repo ?? '', number))
  for (const number of [...created.values(), ...changes.update, ...changes.unchanged]) await moveToColumn($, found, number, 'planned')
  return { created: [...created.values()], updated: changes.update, dropped: changes.drop, unchanged: changes.unchanged, closed: changes.closed }
}

async function writeMilestoneBody($: EngineInterface, github: GithubConfig, number: number, body: MilestoneBody) {
  const previous = await readIssue($, github, number)
  await editIssue($, github.repo ?? '', previous, previous.title, renderMilestoneBody(body))
}

async function applyKickoff($: EngineInterface, milestone: number, result: Record<string, unknown> | undefined) {
  const planned = architectResult(result)
  if ('error' in planned) return `kickoff #${milestone} failed: ${planned.error}`
  const bodyGaps = milestoneGaps(renderMilestoneBody(planned.milestone))
  if (bodyGaps.length > 0) return `kickoff #${milestone} rejected, nothing applied: the milestone body misses ${bodyGaps.join(', ')}`
  const found = await board($)
  if (typeof found === 'string') return `kickoff #${milestone} failed: ${found}`
  const changes = kickoffChanges(await readSubIssues($, found.github, milestone), planned.tasks)
  if ('rejected' in changes) return `kickoff #${milestone} rejected, nothing applied: ${changes.rejected}`
  const applied = await applyKickoffChanges($, found, milestone, planned.tasks, changes)
  await writeMilestoneBody($, found.github, milestone, planned.milestone)
  return `${kickoffAnswer(milestone, applied)}. Next: /ouroboros start ${milestone}`
}

async function escalate($: EngineInterface, found: Board, state: LoopState, number: number, text: string) {
  undoWith(removeLabelCommand(found.github.repo ?? '', number, found.github.labels.needs_owner))
  await gh($, addLabelCommand(found.github.repo ?? '', number, found.github.labels.needs_owner))
  await comment($, found.github.repo ?? '', number, text)
  await writeState($, { ...withoutStage(state), issue: number })
  return `#${number} needs you: see its comment, then remove ${found.github.labels.needs_owner} and run /ouroboros start ${state.milestone}`
}

async function defaultBranch($: EngineInterface, root: string) {
  const ref = await run($, ['git', '-C', root, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => 'origin/main')
  return ref.replace(/^origin\//, '')
}

async function isOpenPullRequestHead($: EngineInterface, github: GithubConfig, branch: string) {
  const state = await run($, ['gh', 'pr', 'view', branch, '-R', github.repo ?? '', '--json', 'state', '--jq', '.state']).catch(() => '')
  return state === 'OPEN'
}

async function stackBase($: EngineInterface, found: Board, state: LoopState, subIssue: BoardSubIssue, root: string) {
  if (state.issue === subIssue.number && state.base !== undefined) return state.base
  const stacked = state.tip !== undefined && (await isOpenPullRequestHead($, found.github, state.tip))
  return stacked ? (state.tip as string) : defaultBranch($, root)
}

async function uncommittedRefusal($: EngineInterface, root: string, branch: string, milestone: number) {
  const current = await run($, ['git', '-C', root, 'branch', '--show-current'])
  if (current === branch || (await run($, ['git', '-C', root, 'status', '--porcelain'])) === '') return undefined
  return `the session checkout has uncommitted changes on ${current}: commit or stash them, then /ouroboros start ${milestone}`
}

async function checkOutSubIssueBranch($: EngineInterface, found: Board, state: LoopState, subIssue: BoardSubIssue) {
  const repo = found.github.repo ?? ''
  const root = await repositoryRoot($)
  const linked = linkedBranchOf(await gh($, linkedBranchesCommand(repo, subIssue.number)))
  const branch = linked ?? branchName(found.config.branch_prefix ?? 'work/', subIssue.number, subIssue.title)
  const refusal = await uncommittedRefusal($, root, branch, state.milestone as number)
  if (refusal !== undefined) return { refusal }
  const base = await stackBase($, found, state, subIssue, root)
  if (linked === undefined) {
    undoWith(deleteBranchCommand(repo, branch))
    await gh($, developCommand(repo, subIssue.number, branch, base))
  }
  await run($, ['git', '-C', root, 'fetch', 'origin'])
  await run($, ['git', '-C', root, 'switch', branch])
  return { branch, base }
}

const stageBrief = (state: LoopState, body: string): StageBrief => ({
  issue: state.issue as number,
  title: state.title ?? '',
  body,
  branch: state.branch as string,
  base: state.base as string,
  round: state.round,
  defects: state.defects ?? [],
})

async function launchStage($: EngineInterface, state: LoopState, stage: 'implement' | 'review', body: string) {
  const brief = stageBrief(state, body)
  await offerStage($, state, stage, stage === 'implement' ? implementPrompt(brief) : reviewPrompt(brief))
}

async function startSubIssue($: EngineInterface, found: Board, state: LoopState, subIssue: BoardSubIssue) {
  if (subIssue.labels.includes(found.github.labels.needs_owner)) return `#${subIssue.number} still carries ${found.github.labels.needs_owner}: answer its comment, remove the label, then /ouroboros start ${state.milestone}`
  const unready = readinessComment(subIssue.body)
  if (unready !== undefined) return escalate($, found, state, subIssue.number, unready)
  if (isInFlight(state, subIssue, found.github)) return resumeSubIssue($, found, state, subIssue)
  const resuming = state.issue === subIssue.number
  const place = await checkOutSubIssueBranch($, found, state, subIssue)
  if ('refusal' in place) return place.refusal
  const next: LoopState = { ...state, issue: subIssue.number, title: subIssue.title, ...place, round: 0, defects: resuming ? state.defects : [] }
  await moveToColumn($, found, subIssue.number, 'in_progress', stageComment('in_progress', stageDetail(next, next.round + 1)))
  await launchStage($, next, 'implement', subIssue.body)
  return `#${subIssue.number} "${subIssue.title}": In Progress on ${place.branch} (from ${place.base}); implementing`
}

const isInFlight = (state: LoopState, subIssue: BoardSubIssue, github: GithubConfig) =>
  state.stage !== undefined && state.issue === subIssue.number && subIssue.state === 'open' && (subIssue.column === github.columns.in_progress || subIssue.column === github.columns.qa)

async function resumeSubIssue($: EngineInterface, found: Board, state: LoopState, subIssue: BoardSubIssue) {
  const stage = state.stage === 'review' || subIssue.column === found.github.columns.qa ? 'review' : 'implement'
  const column = stage === 'review' ? 'qa' : 'in_progress'
  const place = await checkOutSubIssueBranch($, found, state, subIssue)
  if ('refusal' in place) return place.refusal
  if (subIssue.column !== found.github.columns[column]) await moveToColumn($, found, subIssue.number, column)
  await launchStage($, { ...state, title: subIssue.title, ...place }, stage, subIssue.body)
  return `#${subIssue.number} "${subIssue.title}": resumed ${stage} round ${state.round + 1} on ${place.branch}`
}

const isActive = (subIssue: BoardSubIssue, github: GithubConfig) => subIssue.state === 'open' && (subIssue.column === github.columns.in_progress || subIssue.column === github.columns.qa || subIssue.column === github.columns.planned)

async function advance($: EngineInterface, state: LoopState) {
  const found = await board($)
  if (typeof found === 'string') return found
  const subIssues = await readSubIssues($, found.github, state.milestone as number)
  const current = subIssues.find(subIssue => subIssue.number === state.issue)
  if (current !== undefined && isActive(current, found.github)) return startSubIssue($, found, state, current)
  const next = nextSubIssue(subIssues, found.github.columns)
  const cleared: LoopState = { ...state, issue: undefined, title: undefined, branch: undefined, base: undefined, round: 0, defects: [] }
  if ('finished' in next) {
    await writeState($, cleared)
    return `milestone #${state.milestone} finished: every sub-issue is Done`
  }
  if ('none' in next) {
    await writeState($, cleared)
    return next.none
  }
  return startSubIssue($, found, isStarted(next.issue, found.github) ? rebuiltState(found, cleared, next.issue) : cleared, next.issue)
}

const isStarted = (subIssue: BoardSubIssue, github: GithubConfig) => subIssue.column === github.columns.in_progress || subIssue.column === github.columns.qa

const rebuiltState = (found: Board, cleared: LoopState, subIssue: BoardSubIssue): LoopState => ({
  ...cleared,
  issue: subIssue.number,
  title: subIssue.title,
  stage: subIssue.column === found.github.columns.qa ? 'review' : 'implement',
  round: 0,
})

async function start($: EngineInterface, state: LoopState, argument: string) {
  const number = kickoffIssueNumber(argument)
  if (number === undefined) return 'usage: /ouroboros start <milestone-issue>'
  const refusal = busy(state)
  if (refusal !== undefined) return refusal
  return advance($, state.milestone === number ? state : { ...IDLE, milestone: number })
}

const statusText = (state: LoopState) => {
  if (state.milestone === undefined) return 'ouroboros: idle'
  const doing = state.stage === undefined ? 'idle' : `${state.stage}${state.issue === undefined ? '' : ` #${state.issue}`}${state.stage === 'kickoff' ? '' : ` (review round ${state.round})`}`
  return `ouroboros milestone #${state.milestone} · ${doing}${state.tip === undefined ? '' : ` · stack tip ${state.tip}`}`
}

async function stop($: EngineInterface, state: LoopState) {
  await writeState($, withoutStage(state))
  return 'stopped: a running stage workflow keeps going but its result is ignored; /ouroboros start <milestone> resumes'
}

const problemsOf = (check: Promise<string[]>) => check.catch(error => [error instanceof Error ? error.message : String(error)])

async function boardCheck($: EngineInterface, github: GithubConfig) {
  if (github.project === undefined) return [`ouroboros needs github.project in ${CONFIG_PATH}`]
  const { projects, fields } = await boardAnswers($, github)
  const project = projects.projects.find((candidate: { title: string }) => candidate.title === github.project)
  if (project === undefined) return boardProblems(projects, fields, github)
  const workflows = run($, ['gh', 'api', 'graphql', '-f', `query=${WORKFLOWS_QUERY}`, '-F', `id=${project.id}`])
  return [...boardProblems(projects, fields, github), ...(await problemsOf(workflows.then(answer => autoCloseProblems(github.project as string, answer))))]
}

async function prdCheck($: EngineInterface, config: Config) {
  const prd = config.prd ?? 'docs/prd.md'
  const path = await projectPath($, prd)
  return prdProblems(prd, (await $.fs.exists(path)) ? await $.fs.read(path) : undefined)
}

async function repoChecks($: EngineInterface, github: GithubConfig, login: Promise<string>) {
  const repo = github.repo ?? ''
  const checks = [
    login.then(name => run($, ['gh', 'api', `repos/${repo}`, '--jq', '.permissions.push']).then(answer => pushProblems(name, repo, answer))),
    boardCheck($, github),
    run($, ['gh', 'label', 'list', '-R', repo, '--limit', '500', '--json', 'name']).then(answer => labelProblems(repo, github.labels.needs_owner, answer)),
  ]
  return (await Promise.all(checks.map(problemsOf))).flat()
}

async function doctor($: EngineInterface) {
  const config = await readConfig($)
  if (config === undefined) return doctorAnswer([`no ${CONFIG_PATH} at the checkout root: create one (README, Setup)`])
  const user = run($, ['gh', 'api', '-i', 'user'])
  const login = user.then(loginOf, () => loginOf(''))
  const checks = [
    user.then(scopeProblems),
    githubConfig($, config).then(github => repoChecks($, github, login)),
    prdCheck($, config),
  ]
  return doctorAnswer((await Promise.all(checks.map(problemsOf))).flat())
}

async function runCommand($: EngineInterface, args: string) {
  const [head = '', ...rest] = words(args)
  const state = await readState($)
  if (head === 'kickoff') return undoingOnFailure($, () => kickoff($, state, rest.join(' ')))
  if (head === 'start') return undoingOnFailure($, () => start($, state, rest.join(' ')))
  if (head === 'status') return statusText(state)
  if (head === 'stop') return stop($, state)
  if (head === 'doctor') return doctor($)
  return OUROBOROS_COMMAND.description
}

async function finishSubIssue($: EngineInterface, found: Board, state: LoopState) {
  const branch = state.branch as string
  await run($, ['git', '-C', await repositoryRoot($), 'push', '-u', 'origin', branch])
  const pullRequest = await gh($, pullRequestCommand(found.github.repo ?? '', { base: state.base as string, head: branch, title: state.title ?? branch, number: state.issue as number }))
  undoWith(closePullRequestCommand(found.github.repo ?? '', pullRequest))
  await moveToColumn($, found, state.issue as number, 'done', stageComment('done', stageDetail(state, state.round, pullRequest)))
  return { ...state, tip: branch }
}

async function onImplemented($: EngineInterface, found: Board, state: LoopState, result: StageResult) {
  if (result.status !== 'done') return escalate($, found, state, state.issue as number, escalationComment(result.question || 'The implementer stopped without a question.'))
  await moveToColumn($, found, state.issue as number, 'qa', stageComment('qa', stageDetail(state, state.round + 1)))
  const { body } = await readIssue($, found.github, state.issue as number)
  await launchStage($, state, 'review', body)
  return `#${state.issue} in QA: reviewing (round ${state.round + 1})`
}

async function onReviewed($: EngineInterface, found: Board, state: LoopState, result: StageResult) {
  const number = state.issue as number
  const issue = await readIssue($, found.github, number)
  const outcome = reviewOutcome(issue.body, { items: result.items ?? [], defects: result.defects ?? [] })
  if (outcome.body !== issue.body) await editIssue($, found.github.repo ?? '', issue, issue.title, outcome.body)
  const round = state.round + 1
  if (outcome.accepted) {
    const finished = await finishSubIssue($, found, { ...state, round })
    const next = await advance($, withoutStage(finished))
    return `#${number} Done, PR opened from ${state.branch} into ${state.base}. ${next}`
  }
  await comment($, found.github.repo ?? '', number, outcome.comment)
  if (round >= MAX_REVIEW_ROUNDS) {
    await moveToColumn($, found, number, 'in_progress')
    return escalate($, found, { ...state, round }, number, escalationComment(`${MAX_REVIEW_ROUNDS} review rounds ended without acceptance. Decide how to proceed: clarify the plan or checklist, or fix it by hand.`))
  }
  await moveToColumn($, found, number, 'in_progress', stageComment('in_progress', stageDetail(state, round + 1)))
  const defects = outcome.comment.split('\n').filter(line => line.startsWith('- ') || line.startsWith('  '))
  await launchStage($, { ...state, round, defects }, 'implement', outcome.body)
  return `#${number} review round ${round} found defects: back to In Progress, implementing again`
}

async function conductResult($: EngineInterface, state: LoopState, result: Record<string, unknown> | undefined) {
  const settled = withoutStage(state)
  if (state.stage === 'kickoff') {
    await writeState($, settled)
    return applyKickoff($, state.milestone as number, result)
  }
  const found = await board($)
  if (typeof found === 'string') {
    await writeState($, settled)
    return found
  }
  if (state.stage === 'implement') return onImplemented($, found, settled, result === undefined ? { status: 'blocked', question: 'The implementer ended without a readable answer.' } : (result as StageResult))
  return onReviewed($, found, settled, result === undefined ? { items: [], defects: ['The reviewer ended without a readable answer.'] } : (result as StageResult))
}

const STOPPING = /needs you|finished|no sub-issue|failed|rejected|kickoff #\d+:|^ouroboros|^no |^the session/

async function report($: EngineInterface, note: string) {
  $.ui.toast(`ouroboros: ${note}`)
  if (STOPPING.test(note)) submitWhenIdle($, `ouroboros: ${note}`)
}

const resultOf = (outputFileText: string): Record<string, unknown> | undefined => {
  try {
    const { result } = JSON.parse(outputFileText) as { result?: unknown }
    return result !== null && typeof result === 'object' ? (result as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

async function stageResult($: EngineInterface, notification: string) {
  const outputFile = OUTPUT_FILE.exec(notification)?.[1]
  return outputFile !== undefined && (await $.fs.exists(outputFile)) ? resultOf(await $.fs.read(outputFile)) : undefined
}

const mentionsTask = (text: string, taskId: string) => new RegExp(`(^|[^\\w-])${taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`).test(text)

async function onStageNotification($: EngineInterface, notification: string) {
  const state = await readState($)
  if (state.run === undefined || !mentionsTask(notification, state.run)) return undefined
  const result = await stageResult($, notification)
  const note = await undoingOnFailure($, () => conductResult($, state, result)).catch(messageOf)
  await report($, note)
  return `ouroboros: ${note}`
}

async function launchPendingStage($: EngineInterface, call: () => Promise<unknown>) {
  const state = await readState($)
  const refusal = busy(state)
  if (refusal !== undefined) return { deny: refusal }
  if (state.pending === undefined) return { deny: 'no ouroboros stage is waiting to launch: /ouroboros start <milestone-issue>' }
  const launched = (await call()) as { result?: { taskId?: string } }
  const taskId = launched.result?.taskId
  if (taskId !== undefined) await writeState($, { ...state, pending: undefined, run: taskId })
  return launched
}

const contextText = (state: LoopState) =>
  state.pending === undefined ? statusText(state) : `${statusText(state)}\npending launch: ${spokenLabel(state.pending.label)} with ${workflowCall(state.pending)}`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register(OUROBOROS_COMMAND)
    return next(e)
  })

  on('command.run', { command: OUROBOROS_COMMAND.name }, async ($, e) => {
    try {
      return { text: await runCommand($, e.args) }
    } catch (error) {
      return { text: loudly(error) }
    }
  })

  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    if (e.agentId !== undefined || !isStageWorkflow(e.name)) return next(e)
    return launchPendingStage($, async () => next({ ...e, args: (await readState($)).pending }))
  })

  on('session.receive', { origin: { kind: 'task-notification' } }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const note = await onStageNotification($, e.text)
    return note === undefined ? next(e) : { consumed: note }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind !== 'task-notification') return next(e)
    const note = await onStageNotification($, e.text)
    return note === undefined ? next(e) : { drop: note }
  })

  on('prompt.context', async ($, e, next) => {
    const state = await readState($)
    if (state.milestone === undefined) return next(e)
    return next({ ...e, blocks: [...e.blocks, { name: 'ouroboros', text: contextText(state) }] })
  })
}
