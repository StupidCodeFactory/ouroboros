import type { EngineInterface, Register } from 'claude-code'

import { milestoneGaps, renderMilestoneBody } from './github/contract'
import type { MilestoneBody } from './github/contract'
import {
  addLabelCommand,
  addToBoardCommand,
  boardIdsOf,
  commentCommand,
  createSubIssueCommand,
  creationOrder,
  dropCommand,
  editIssueCommand,
  githubConfigOf,
  issueOfPosition,
  linkSubIssueCommand,
  pullRequestCommand,
} from './github/gh_commands'
import type { BoardIds, Column, GhCommand, GithubConfig, GithubSettings } from './github/gh_commands'
import { setColumnCommand } from './github/gh_commands'
import { architectResult, kickoffAnswer, kickoffIssueNumber, milestoneColumn, prdSection } from './github/kickoff_issue'
import { kickoffChanges, plannedBody } from './github/kickoff_plan'
import type { KickoffChanges, PlannedTask } from './github/kickoff_plan'
import { MAX_REVIEW_ROUNDS, branchName, escalationComment, nextSubIssue, readinessComment, reviewOutcome } from './loop'
import type { BoardSubIssue, Review } from './loop'
import { answerJson, implementPrompt, kickoffPrompt, reviewPrompt } from './prompts'
import type { KickoffBrief, StageBrief } from './prompts'

type Stage = 'kickoff' | 'implement' | 'review'
type LoopState = {
  milestone?: number
  stage?: Stage
  agent?: string
  label?: string
  issue?: number
  title?: string
  branch?: string
  base?: string
  worktree?: string
  round: number
  defects?: string[]
  tip?: string
}
type Config = { prd?: string; branch_prefix?: string; github?: GithubSettings }
type StageResult = { status?: string; question?: string } & Partial<Review>

const CONFIG_PATH = '.claude/ouroboros.json'
const RUNTIME_DIR = '.claude/ouroboros'
const STATE_PATH = `${RUNTIME_DIR}/state.json`
const IDLE: LoopState = { round: 0 }
const AGENTS: Record<Stage, string> = { kickoff: 'architect', implement: 'implementer', review: 'reviewer' }

const OUROBOROS_COMMAND = {
  name: 'ouroboros',
  description: 'GitHub milestone loop: /ouroboros kickoff <milestone-issue> | start <milestone-issue> | status | stop',
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean)

const loudly = (error: unknown) => `ouroboros: ${error instanceof Error ? error.message : String(error)}`

async function run($: EngineInterface, argv: string[], stdin?: string) {
  const { exitCode, stdout, stderr } = await $.process.run(argv, stdin === undefined ? undefined : { stdin })
  if (exitCode !== 0) throw new Error(`${argv.slice(0, 3).join(' ')} failed: ${stderr.trim() || stdout.trim()}`)
  return stdout.trim()
}

const gh = ($: EngineInterface, command: GhCommand) => run($, command.argv, command.stdin)

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

async function writeState($: EngineInterface, state: LoopState) {
  const ignore = await projectPath($, `${RUNTIME_DIR}/.gitignore`)
  if (!(await $.fs.exists(ignore))) await $.fs.write(ignore, '*\n')
  await $.fs.write(await projectPath($, STATE_PATH), JSON.stringify(state, null, 2))
}

async function githubConfig($: EngineInterface, config: Config): Promise<GithubConfig> {
  const github = githubConfigOf(config.github)
  if (github.repo !== undefined) return github
  return { ...github, repo: await run($, ['gh', 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']) }
}

const ownerOf = (github: GithubConfig) => (github.repo ?? '').split('/')[0] ?? ''

async function boardIds($: EngineInterface, github: GithubConfig) {
  const owner = ownerOf(github)
  const projects = JSON.parse(await run($, ['gh', 'project', 'list', '--owner', owner, '--limit', '100', '--format', 'json']))
  const project = projects.projects.find((candidate: { title: string }) => candidate.title === github.project)
  const fields = project === undefined ? { fields: [] } : JSON.parse(await run($, ['gh', 'project', 'field-list', String(project.number), '--owner', owner, '--format', 'json']))
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

async function moveToColumn($: EngineInterface, { github, ids }: Board, number: number, column: Column) {
  const itemId = await gh($, addToBoardCommand(ownerOf(github), ids, issueUrl(github, number)))
  await gh($, setColumnCommand(ids, itemId, column))
}

const labelOf = (state: LoopState, stage: Stage) => (stage === 'kickoff' ? `kickoff:#${state.milestone}` : `${stage}:#${state.issue} round ${state.round + 1}`)

async function spawnStage($: EngineInterface, state: LoopState, stage: Stage, prompt: string, cwd?: string) {
  const label = labelOf(state, stage)
  await writeState($, { ...state, stage, label, agent: undefined })
  const spawned = await $.agent.spawn({ subagentType: `${$.plugin.name}:${AGENTS[stage]}`, description: label, prompt, ...(cwd === undefined ? {} : { cwd }) })
  if (spawned.deny !== undefined) {
    await writeState($, { ...state, stage: undefined, label: undefined })
    throw new Error(`could not start the ${AGENTS[stage]}: ${spawned.deny}`)
  }
  if (spawned.agentId !== undefined) await writeState($, { ...state, stage, label, agent: spawned.agentId })
}

async function isLoopAgent($: EngineInterface, state: LoopState, agentId: string) {
  if (state.stage === undefined) return false
  if (state.agent !== undefined) return state.agent === agentId
  return (await $.agent.list()).some(agent => agent.id === agentId && agent.description === state.label)
}

async function milestonePrdSection($: EngineInterface, config: Config, title: string) {
  const prd = config.prd ?? 'docs/prd.md'
  const path = await projectPath($, prd)
  if (!(await $.fs.exists(path))) return { refusal: `no PRD at ${prd}: set prd in ${CONFIG_PATH}` }
  const found = prdSection(await $.fs.read(path), title)
  return 'section' in found ? found : { refusal: `no heading of ${prd} matches "${title}"; headings: ${found.headings.join(', ')}` }
}

async function busy($: EngineInterface, state: LoopState) {
  if (state.stage === undefined) return undefined
  const running = (await $.agent.list()).some(agent => (agent.id === state.agent || agent.description === state.label) && agent.status === 'running')
  return running ? `ouroboros is running ${state.stage}${state.stage === 'kickoff' || state.issue === undefined ? '' : ` for #${state.issue}`}; wait for it, or /ouroboros stop` : undefined
}

async function kickoff($: EngineInterface, state: LoopState, argument: string) {
  const number = kickoffIssueNumber(argument)
  if (number === undefined) return 'usage: /ouroboros kickoff <milestone-issue>'
  const refusal = await busy($, state)
  if (refusal !== undefined) return refusal
  const found = await board($)
  if (typeof found === 'string') return found
  const milestone = await readIssue($, found.github, number)
  if ((await issueColumn($, found.github, number)) !== found.github.columns.milestones) return `#${number} is not in the "${found.github.columns.milestones}" column of "${found.github.project}"`
  const prd = await milestonePrdSection($, found.config, milestone.title)
  if ('refusal' in prd) return prd.refusal
  const sub_issues = (await readSubIssues($, found.github, number)).map(({ number, state, title, body }) => ({ number, state, title, body }))
  const brief: KickoffBrief = { issue: number, title: milestone.title, prd_section: prd.section, milestone_body: milestone.body, sub_issues }
  await spawnStage($, { ...(state.milestone === number ? state : IDLE), milestone: number }, 'kickoff', kickoffPrompt(brief))
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
    await gh($, editIssueCommand(github.repo ?? '', number, task.title, bodyOf(task)))
  }
  for (const number of changes.drop) await gh($, dropCommand(github.repo ?? '', number))
  for (const number of [...created.values(), ...changes.update, ...changes.unchanged]) await moveToColumn($, found, number, 'planned')
  return { created: [...created.values()], updated: changes.update, dropped: changes.drop, unchanged: changes.unchanged, closed: changes.closed }
}

async function writeMilestoneBody($: EngineInterface, github: GithubConfig, number: number, body: MilestoneBody) {
  const { title } = await readIssue($, github, number)
  await gh($, editIssueCommand(github.repo ?? '', number, title, renderMilestoneBody(body)))
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

async function escalate($: EngineInterface, found: Board, state: LoopState, number: number, comment: string) {
  await gh($, addLabelCommand(found.github.repo ?? '', number, found.github.labels.needs_owner))
  await gh($, commentCommand(found.github.repo ?? '', number, comment))
  await writeState($, { ...state, stage: undefined, agent: undefined, label: undefined, issue: number })
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

async function prepareWorktree($: EngineInterface, found: Board, state: LoopState, subIssue: BoardSubIssue) {
  const root = await repositoryRoot($)
  const branch = branchName(found.config.branch_prefix ?? 'work/', subIssue.number, subIssue.title)
  const worktree = `${root}/${RUNTIME_DIR}/worktrees/${subIssue.number}`
  if (state.issue === subIssue.number && state.worktree === worktree && state.base !== undefined && (await $.fs.exists(worktree))) return { branch, worktree, base: state.base }
  await run($, ['git', '-C', root, 'fetch', 'origin'])
  const main = await defaultBranch($, root)
  if (await refExists($, root, `refs/remotes/origin/${branch}`)) {
    if (!(await $.fs.exists(worktree))) await addWorktreeOnPushedBranch($, root, branch, worktree)
    return { branch, worktree, base: state.base ?? main }
  }
  const stacked = state.tip !== undefined && (await isOpenPullRequestHead($, found.github, state.tip))
  const base = stacked ? (state.tip as string) : main
  if (!(await $.fs.exists(worktree))) await run($, ['git', '-C', root, 'worktree', 'add', '-B', branch, worktree, stacked ? base : `origin/${main}`])
  return { branch, worktree, base }
}

async function refExists($: EngineInterface, root: string, ref: string) {
  return (await $.process.run(['git', '-C', root, 'rev-parse', '--verify', '--quiet', ref])).exitCode === 0
}

async function addWorktreeOnPushedBranch($: EngineInterface, root: string, branch: string, worktree: string) {
  if (await refExists($, root, `refs/heads/${branch}`)) return run($, ['git', '-C', root, 'worktree', 'add', worktree, branch])
  return run($, ['git', '-C', root, 'worktree', 'add', '--track', '-b', branch, worktree, `origin/${branch}`])
}

const stageBrief = (state: LoopState, body: string): StageBrief => ({
  issue: state.issue as number,
  title: state.title ?? '',
  body,
  worktree: state.worktree as string,
  branch: state.branch as string,
  base: state.base as string,
  round: state.round,
  defects: state.defects ?? [],
})

async function launchStage($: EngineInterface, state: LoopState, stage: 'implement' | 'review', body: string) {
  const brief = stageBrief(state, body)
  await spawnStage($, state, stage, stage === 'implement' ? implementPrompt(brief) : reviewPrompt(brief), brief.worktree)
}

async function startSubIssue($: EngineInterface, found: Board, state: LoopState, subIssue: BoardSubIssue) {
  if (subIssue.labels.includes(found.github.labels.needs_owner)) return `#${subIssue.number} still carries ${found.github.labels.needs_owner}: answer its comment, remove the label, then /ouroboros start ${state.milestone}`
  const unready = readinessComment(subIssue.body)
  if (unready !== undefined) return escalate($, found, state, subIssue.number, unready)
  if (isInFlight(state, subIssue, found.github)) return resumeSubIssue($, found, state, subIssue)
  const resuming = state.issue === subIssue.number
  const place = await prepareWorktree($, found, state, subIssue)
  await moveToColumn($, found, subIssue.number, 'in_progress')
  const next: LoopState = { ...state, issue: subIssue.number, title: subIssue.title, ...place, round: 0, defects: resuming ? state.defects : [] }
  await launchStage($, next, 'implement', subIssue.body)
  return `#${subIssue.number} "${subIssue.title}": In Progress on ${place.branch} (from ${place.base}); implementing`
}

const isInFlight = (state: LoopState, subIssue: BoardSubIssue, github: GithubConfig) =>
  state.stage !== undefined && state.issue === subIssue.number && subIssue.state === 'open' && (subIssue.column === github.columns.in_progress || subIssue.column === github.columns.qa)

async function resumeSubIssue($: EngineInterface, found: Board, state: LoopState, subIssue: BoardSubIssue) {
  const stage = state.stage === 'review' || subIssue.column === found.github.columns.qa ? 'review' : 'implement'
  const column = stage === 'review' ? 'qa' : 'in_progress'
  const place = await prepareWorktree($, found, state, subIssue)
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
  const cleared: LoopState = { ...state, issue: undefined, title: undefined, branch: undefined, base: undefined, worktree: undefined, round: 0, defects: [] }
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
  branch: branchName(found.config.branch_prefix ?? 'work/', subIssue.number, subIssue.title),
  round: 0,
})

async function start($: EngineInterface, state: LoopState, argument: string) {
  const number = kickoffIssueNumber(argument)
  if (number === undefined) return 'usage: /ouroboros start <milestone-issue>'
  const refusal = await busy($, state)
  if (refusal !== undefined) return refusal
  return advance($, state.milestone === number ? state : { ...IDLE, milestone: number })
}

const statusText = (state: LoopState) => {
  if (state.milestone === undefined) return 'ouroboros: idle'
  const doing = state.stage === undefined ? 'idle' : `${state.stage}${state.issue === undefined ? '' : ` #${state.issue}`}${state.stage === 'kickoff' ? '' : ` (review round ${state.round})`}`
  return `ouroboros milestone #${state.milestone} · ${doing}${state.tip === undefined ? '' : ` · stack tip ${state.tip}`}`
}

async function stop($: EngineInterface, state: LoopState) {
  await writeState($, { ...state, stage: undefined, agent: undefined, label: undefined })
  return 'stopped: a running agent keeps going but its answer is ignored; /ouroboros start <milestone> resumes'
}

async function runCommand($: EngineInterface, args: string) {
  const [head = '', ...rest] = words(args)
  const state = await readState($)
  if (head === 'kickoff') return kickoff($, state, rest.join(' '))
  if (head === 'start') return start($, state, rest.join(' '))
  if (head === 'status') return statusText(state)
  if (head === 'stop') return stop($, state)
  return OUROBOROS_COMMAND.description
}

async function finishSubIssue($: EngineInterface, found: Board, state: LoopState) {
  const branch = state.branch as string
  await run($, ['git', '-C', state.worktree as string, 'push', '-u', 'origin', branch])
  await gh($, pullRequestCommand(found.github.repo ?? '', { base: state.base as string, head: branch, title: state.title ?? branch, number: state.issue as number }))
  await moveToColumn($, found, state.issue as number, 'done')
  await run($, ['git', '-C', await repositoryRoot($), 'worktree', 'remove', '--force', state.worktree as string]).catch(() => '')
  return { ...state, tip: branch }
}

async function onImplemented($: EngineInterface, found: Board, state: LoopState, result: StageResult) {
  if (result.status !== 'done') return escalate($, found, state, state.issue as number, escalationComment(result.question || 'The implementer stopped without a question.'))
  await moveToColumn($, found, state.issue as number, 'qa')
  const { body } = await readIssue($, found.github, state.issue as number)
  await launchStage($, state, 'review', body)
  return `#${state.issue} in QA: reviewing (round ${state.round + 1})`
}

async function onReviewed($: EngineInterface, found: Board, state: LoopState, result: StageResult) {
  const number = state.issue as number
  const issue = await readIssue($, found.github, number)
  const outcome = reviewOutcome(issue.body, { items: result.items ?? [], defects: result.defects ?? [] })
  if (outcome.body !== issue.body) await gh($, editIssueCommand(found.github.repo ?? '', number, issue.title, outcome.body))
  const round = state.round + 1
  if (outcome.accepted) {
    const finished = await finishSubIssue($, found, { ...state, round })
    const next = await advance($, { ...finished, stage: undefined, agent: undefined, label: undefined })
    return `#${number} Done, PR opened from ${state.branch} into ${state.base}. ${next}`
  }
  await gh($, commentCommand(found.github.repo ?? '', number, outcome.comment))
  await moveToColumn($, found, number, 'in_progress')
  if (round >= MAX_REVIEW_ROUNDS) return escalate($, found, { ...state, round }, number, escalationComment(`${MAX_REVIEW_ROUNDS} review rounds ended without acceptance. Decide how to proceed: clarify the plan or checklist, or fix it by hand.`))
  const defects = outcome.comment.split('\n').filter(line => line.startsWith('- ') || line.startsWith('  '))
  await launchStage($, { ...state, round, defects }, 'implement', outcome.body)
  return `#${number} review round ${round} found defects: back to In Progress, implementing again`
}

async function conductAnswer($: EngineInterface, state: LoopState, answer: string) {
  const json = answerJson(answer)
  const settled: LoopState = { ...state, agent: undefined, label: undefined }
  if (state.stage === 'kickoff') {
    await writeState($, { ...settled, stage: undefined })
    return applyKickoff($, state.milestone as number, json)
  }
  const found = await board($)
  if (typeof found === 'string') {
    await writeState($, { ...settled, stage: undefined })
    return found
  }
  const result = (json ?? {}) as StageResult
  if (state.stage === 'implement') return onImplemented($, found, settled, json === undefined ? { status: 'blocked', question: 'The implementer ended without a readable answer.' } : result)
  return onReviewed($, found, settled, json === undefined ? { items: [], defects: ['The reviewer ended without a readable answer.'] } : result)
}

const STOPPING = /needs you|finished|no sub-issue|failed|rejected|kickoff #\d+:|^ouroboros|^no /

async function report($: EngineInterface, note: string) {
  $.ui.toast(`ouroboros: ${note}`)
  if (STOPPING.test(note)) await $.prompt.submit({ text: `ouroboros: ${note}` })
}

async function onAgentAnswer($: EngineInterface, agentId: string, answer: string) {
  const state = await readState($)
  if (!(await isLoopAgent($, state, agentId))) return
  await report($, await conductAnswer($, state, answer).catch(loudly))
}

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

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) await onAgentAnswer($, e.agentId, e.answer)
    return next(e)
  })

  on('prompt.context', async ($, e, next) => {
    const state = await readState($)
    if (state.milestone === undefined) return next(e)
    return next({ ...e, blocks: [...e.blocks, { name: 'ouroboros', text: statusText(state) }] })
  })
}
