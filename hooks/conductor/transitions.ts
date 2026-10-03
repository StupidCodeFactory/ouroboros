import { firstUncheckedBox, phaseTasks } from '../drafts'
import type { PhaseTask } from '../drafts'
import { touchesByTask } from './briefs'
import type { BriefSlices } from './briefs'
import type { Escalation, Launch, LoopState } from './state'

export type LoopEvent =
  | { type: 'kickoff-done'; brief: string; brief_path?: string; slices?: BriefSlices; brief_dir?: string }
  | { type: 'phase-result'; status: 'checkpointed' | 'escalate'; phase: string; result_path: string; failing_gate?: string }
  | { type: 'retro-done' }
  | { type: 'exit-result'; merged: boolean; failing_gate?: string }

export type Action = { state: LoopState; launch?: Launch; notify?: string }

const briefArg = (state: LoopState) => {
  if (state.brief_dir !== undefined) return { brief_dir: state.brief_dir }
  if (state.brief_path !== undefined) return { brief_path: state.brief_path }
  return { brief: state.brief ?? '' }
}

const withTouches = (task: PhaseTask, touches: LoopState['touches']) => {
  const files = touches?.[task.id]
  return files === undefined ? task : { ...task, touches: files }
}

const phaseArgs = (state: LoopState, phase: string, planText: string | undefined) => {
  const base = { milestone: state.milestone, phase, ...briefArg(state) }
  if (planText === undefined) return base
  return { ...base, tasks: phaseTasks(planText, phase).map(task => withTouches(task, state.touches)) }
}

export const phaseLaunch = (state: LoopState, phase: string, planText: string | undefined): Launch => ({ workflow: 'phase', args: phaseArgs(state, phase, planText) })

export const exitLaunch = (state: LoopState): Launch => ({ workflow: 'milestone-exit', args: { milestone: state.milestone } })

const successorOf = (phases: string[], current: string | null) => phases[phases.indexOf(current ?? '') + 1]

const firstOpenPhase = (phases: string[], planText: string) => phases.find(phase => firstUncheckedBox(planText, phase) !== null)

const nextPhase = (state: LoopState, planText: string | undefined) =>
  planText === undefined ? successorOf(state.phases, state.current) : firstOpenPhase(state.phases, planText)

const escalated = (state: LoopState, escalation: Escalation, notify: string): Action => ({
  state: { ...state, status: 'escalated', escalations: [...state.escalations, escalation] },
  notify,
})

const launchPhase = (state: LoopState, phase: string, planText: string | undefined): Action => ({
  state: { ...state, status: 'phase', current: phase },
  launch: phaseLaunch(state, phase, planText),
})

const withBrief = (state: LoopState, event: Extract<LoopEvent, { type: 'kickoff-done' }>): LoopState => {
  if (event.slices !== undefined && event.brief_dir !== undefined) return { ...state, brief_dir: event.brief_dir, touches: touchesByTask(event.slices) }
  if (event.brief_path !== undefined) return { ...state, brief_path: event.brief_path }
  return { ...state, brief: event.brief }
}

const onKickoffDone = (state: LoopState, event: Extract<LoopEvent, { type: 'kickoff-done' }>, planText: string | undefined): Action => {
  if (state.status !== 'kickoff') return { state }
  const first = state.phases[0]
  if (first === undefined) return { state: { ...state, status: 'idle' }, notify: `${state.milestone}: the plan has no phases` }
  return launchPhase(withBrief(state, event), first, planText)
}

const onPhaseResult = (state: LoopState, event: Extract<LoopEvent, { type: 'phase-result' }>): Action => {
  if (state.status !== 'phase') return { state }
  const results = { ...state.results, [event.phase]: event.result_path }
  if (event.status === 'escalate') {
    const escalation: Escalation = { kind: 'task-red', phase: event.phase, summary: event.failing_gate ? `${event.phase}: ${event.failing_gate}` : `${event.phase} escalated after its fix rounds`, result_path: event.result_path }
    return escalated({ ...state, results }, escalation, `${state.milestone} ${event.phase} escalated: see ${event.result_path}`)
  }
  return { state: { ...state, status: 'retro', results }, launch: { workflow: 'retro', args: {} } }
}

const onRetroDone = (state: LoopState, planText: string | undefined): Action => {
  if (state.status !== 'retro') return { state }
  const phase = nextPhase(state, planText)
  if (phase === undefined) return { state: { ...state, status: 'exit' }, launch: exitLaunch(state) }
  return launchPhase(state, phase, planText)
}

const onExitResult = (state: LoopState, event: Extract<LoopEvent, { type: 'exit-result' }>): Action => {
  if (state.status !== 'exit') return { state }
  if (event.merged) return { state: { ...state, status: 'idle' }, notify: `${state.milestone} merged` }
  const gate = event.failing_gate ?? 'unknown gate'
  const escalation: Escalation = { kind: 'gate-refused', phase: state.current ?? '', summary: gate, result_path: state.results['exit'] ?? '' }
  return escalated(state, escalation, `${state.milestone} merge refused: ${gate}`)
}

const transition = (state: LoopState, event: LoopEvent, planText: string | undefined): Action => {
  if (event.type === 'kickoff-done') return onKickoffDone(state, event, planText)
  if (event.type === 'phase-result') return onPhaseResult(state, event)
  if (event.type === 'retro-done') return onRetroDone(state, planText)
  return onExitResult(state, event)
}

const heldWhilePaused = (before: LoopState, action: Action): Action => {
  if (!before.paused || action.launch === undefined) return action
  return { ...action, launch: undefined, state: { ...action.state, pending: action.launch } }
}

export const nextAction = (state: LoopState, event: LoopEvent, planText?: string): Action => heldWhilePaused(state, transition(state, event, planText))
