import { firstUncheckedBox, phaseTasks, untaggedOpenTasks } from '../drafts'
import type { PhaseTask } from '../drafts'
import { touchesByTask } from './briefs'
import type { BriefSlices } from './briefs'
import { taskLane } from './lanes'
import type { LaneOwnership } from './lanes'
import type { Escalation, Launch, LoopState } from './state'

export type LoopEvent =
  | { type: 'kickoff-done'; brief: string; brief_path?: string; slices?: BriefSlices; brief_dir?: string; failed?: string }
  | { type: 'phase-result'; status: 'checkpointed' | 'escalate'; phase: string; result_path: string; failing_gate?: string; pr_url?: string; checkpoint_sha?: string; blocked?: string[] }
  | { type: 'retro-done' }
  | { type: 'exit-result'; merged: boolean; failing_gate?: string }

export type Action = { state: LoopState; launch?: Launch; notify?: string }

const RETRO_LAUNCH: Launch = { workflow: 'retro', args: {} }

const briefArg = (state: LoopState) => {
  if (state.brief_dir !== undefined) return { brief_dir: state.brief_dir }
  if (state.brief_path !== undefined) return { brief_path: state.brief_path }
  return { brief: state.brief ?? '' }
}

const withTouches = (task: PhaseTask, touches: LoopState['touches'], lanes: LaneOwnership) => {
  const files = touches?.[task.id] ?? (task.lane === undefined ? undefined : lanes[task.lane])
  return files === undefined ? task : { ...task, touches: files }
}

const withLane = <T extends PhaseTask & { touches?: string[] }>(task: T, lanes: LaneOwnership) => {
  const lane = taskLane(task, lanes)
  return lane === undefined ? task : { ...task, lane }
}

const phaseArgs = (state: LoopState, phase: string, planText: string | undefined, lanes: LaneOwnership) => {
  const base = { milestone: state.milestone, phase, ...briefArg(state) }
  if (planText === undefined) return base
  const open = phaseTasks(planText, phase).filter(task => task.unchecked > 0)
  return { ...base, tasks: open.map(task => withLane(withTouches(task, state.touches, lanes), lanes)) }
}

export const phaseLaunch = (state: LoopState, phase: string, planText: string | undefined, lanes: LaneOwnership = {}): Launch => ({
  workflow: 'phase',
  args: phaseArgs(state, phase, planText, lanes),
})

export const exitLaunch = (state: LoopState): Launch => ({ workflow: 'milestone-exit', args: { milestone: state.milestone } })

const successorOf = (phases: string[], current: string | null) => phases[phases.indexOf(current ?? '') + 1]

const firstOpenPhase = (phases: string[], planText: string) => phases.find(phase => firstUncheckedBox(planText, phase) !== null)

const nextPhase = (state: LoopState, planText: string | undefined) =>
  planText === undefined ? successorOf(state.phases, state.current) : firstOpenPhase(state.phases, planText)

const escalated = (state: LoopState, escalation: Escalation, notify: string): Action => ({
  state: { ...state, status: 'escalated', escalations: [...state.escalations, escalation] },
  notify,
})

const launchPhase = (state: LoopState, phase: string, planText: string | undefined, lanes: LaneOwnership): Action => ({
  state: { ...state, status: 'phase', current: phase },
  launch: phaseLaunch(state, phase, planText, lanes),
})

const withBrief = (state: LoopState, event: Extract<LoopEvent, { type: 'kickoff-done' }>): LoopState => {
  if (event.slices !== undefined && event.brief_dir !== undefined) return { ...state, brief_dir: event.brief_dir, touches: touchesByTask(event.slices) }
  if (event.brief_path !== undefined) return { ...state, brief_path: event.brief_path }
  return { ...state, brief: event.brief }
}

const onKickoffDone = (state: LoopState, event: Extract<LoopEvent, { type: 'kickoff-done' }>, planText: string | undefined, lanes: LaneOwnership): Action => {
  if (state.status !== 'kickoff') return { state }
  if (event.failed !== undefined) {
    return escalated(state, { kind: 'gate-refused', phase: 'kickoff', summary: event.failed, result_path: '' }, `${state.milestone} kickoff failed: ${event.failed}`)
  }
  const first = state.phases[0]
  if (first === undefined) return { state: { ...state, status: 'idle' }, notify: `${state.milestone}: the plan has no phases` }
  const launched = launchPhase(withBrief(state, event), first, planText, lanes)
  const untagged = planText === undefined ? [] : untaggedOpenTasks(planText)
  if (untagged.length === 0) return launched
  return { ...launched, notify: `${state.milestone}: task ${untagged.join(', ')} ${untagged.length === 1 ? 'has' : 'have'} open boxes but no phase tag, so no phase will run ${untagged.length === 1 ? 'it' : 'them'}; tag ${untagged.length === 1 ? 'it' : 'them'} (PN) in the plan` }
}

const blockedNote = (blocked: string[] | undefined) => (blocked === undefined || blocked.length === 0 ? '' : `; still blocked, listed on the PR: ${blocked.join('; ')}`)

const onPhaseResult = (state: LoopState, event: Extract<LoopEvent, { type: 'phase-result' }>): Action => {
  if (state.status !== 'phase') return { state }
  const results = { ...state.results, [event.phase]: event.result_path }
  if (event.status === 'escalate') {
    const escalation: Escalation = { kind: 'task-red', phase: event.phase, summary: event.failing_gate ? `${event.phase}: ${event.failing_gate}` : `${event.phase} escalated after its fix rounds`, result_path: event.result_path }
    return { ...escalated({ ...state, results }, escalation, `${state.milestone} ${event.phase} escalated: see ${event.result_path}`), launch: RETRO_LAUNCH }
  }
  if (event.pr_url === undefined) return { state: { ...state, status: 'retro', results }, launch: RETRO_LAUNCH }
  return {
    state: { ...state, status: 'retro', results, awaiting_merge: { phase: event.phase, pr_url: event.pr_url } },
    launch: RETRO_LAUNCH,
    notify: `${state.milestone} ${event.phase}: pull request ${event.pr_url} is open for your review and merge${blockedNote(event.blocked)}`,
  }
}

const onRetroDone = (state: LoopState, planText: string | undefined, lanes: LaneOwnership): Action => {
  if (state.status !== 'retro') return { state }
  const phase = nextPhase(state, planText)
  if (phase === undefined) return { state: { ...state, status: 'exit' }, launch: exitLaunch(state) }
  return launchPhase(state, phase, planText, lanes)
}

const onExitResult = (state: LoopState, event: Extract<LoopEvent, { type: 'exit-result' }>): Action => {
  if (state.status !== 'exit') return { state }
  if (event.merged) return { state: { ...state, status: 'idle' }, notify: `${state.milestone} merged` }
  const gate = event.failing_gate ?? 'unknown gate'
  const escalation: Escalation = { kind: 'gate-refused', phase: state.current ?? '', summary: gate, result_path: state.results['exit'] ?? '' }
  return escalated(state, escalation, `${state.milestone} merge refused: ${gate}`)
}

const transition = (state: LoopState, event: LoopEvent, planText: string | undefined, lanes: LaneOwnership): Action => {
  if (event.type === 'kickoff-done') return onKickoffDone(state, event, planText, lanes)
  if (event.type === 'phase-result') return onPhaseResult(state, event)
  if (event.type === 'retro-done') return onRetroDone(state, planText, lanes)
  return onExitResult(state, event)
}

const heldForMerge = (before: LoopState, action: Action): Action => {
  const waiting = before.awaiting_merge
  if (waiting === undefined || action.launch === undefined || before.status !== 'retro') return action
  const next = (action.launch.args as { phase?: unknown }).phase
  const nextName = typeof next === 'string' ? next : 'the milestone exit'
  return {
    state: { ...action.state, pending: action.launch },
    notify: `${before.milestone}: merge ${waiting.pr_url} (${waiting.phase}), then /ouroboros resume starts ${nextName} on a fresh branch`,
  }
}

export const freshBranchName = (prefix: string, milestone: string, phase: string) => `${prefix}${milestone}-${phase}`.toLowerCase()

export const mergeAccepted = (state: LoopState, branchPrefix: string): LoopState => {
  const { awaiting_merge: _merged, merge_checked_at: _checked, ...released } = state
  const pending = released.pending
  const phase = (pending?.args as { phase?: unknown } | undefined)?.phase
  if (pending === undefined || typeof phase !== 'string') return released
  return { ...released, pending: { ...pending, args: { ...pending.args, fresh_branch: freshBranchName(branchPrefix, state.milestone, phase) } } }
}

const heldWhilePaused = (before: LoopState, action: Action): Action => {
  if (!before.paused || action.launch === undefined) return action
  return { ...action, launch: undefined, state: { ...action.state, pending: action.launch } }
}

export const nextAction = (state: LoopState, event: LoopEvent, planText?: string, lanes: LaneOwnership = {}): Action =>
  heldWhilePaused(state, heldForMerge(state, transition(state, event, planText, lanes)))
