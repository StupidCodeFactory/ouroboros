import { firstUncheckedBox } from '../drafts'
import type { Escalation, Launch, LoopState } from './state'

export type LoopEvent =
  | { type: 'kickoff-done'; brief: string }
  | { type: 'phase-result'; status: 'checkpointed' | 'escalate'; phase: string; result_path: string }
  | { type: 'retro-done' }
  | { type: 'exit-result'; merged: boolean; failing_gate?: string }

export type Action = { state: LoopState; launch?: Launch; notify?: string }

const phaseLaunch = (state: LoopState, phase: string): Launch => ({ workflow: 'phase', args: { milestone: state.milestone, phase, brief: state.brief ?? '' } })

const exitLaunch = (state: LoopState): Launch => ({ workflow: 'milestone-exit', args: { milestone: state.milestone } })

const successorOf = (phases: string[], current: string | null) => phases[phases.indexOf(current ?? '') + 1]

const firstOpenPhase = (phases: string[], planText: string) => phases.find(phase => firstUncheckedBox(planText, phase) !== null)

const nextPhase = (state: LoopState, planText: string | undefined) =>
  planText === undefined ? successorOf(state.phases, state.current) : firstOpenPhase(state.phases, planText)

const escalated = (state: LoopState, escalation: Escalation, notify: string): Action => ({
  state: { ...state, status: 'escalated', escalations: [...state.escalations, escalation] },
  notify,
})

const launchPhase = (state: LoopState, phase: string): Action => ({ state: { ...state, status: 'phase', current: phase }, launch: phaseLaunch(state, phase) })

const onKickoffDone = (state: LoopState, brief: string): Action => {
  if (state.status !== 'kickoff') return { state }
  const first = state.phases[0]
  if (first === undefined) return { state: { ...state, status: 'idle' }, notify: `${state.milestone}: the plan has no phases` }
  return launchPhase({ ...state, brief }, first)
}

const onPhaseResult = (state: LoopState, event: Extract<LoopEvent, { type: 'phase-result' }>): Action => {
  if (state.status !== 'phase') return { state }
  const results = { ...state.results, [event.phase]: event.result_path }
  if (event.status === 'escalate') {
    const escalation: Escalation = { kind: 'task-red', phase: event.phase, summary: `${event.phase} escalated after its fix rounds`, result_path: event.result_path }
    return escalated({ ...state, results }, escalation, `${state.milestone} ${event.phase} escalated: see ${event.result_path}`)
  }
  return { state: { ...state, status: 'retro', results }, launch: { workflow: 'retro', args: {} } }
}

const onRetroDone = (state: LoopState, planText: string | undefined): Action => {
  if (state.status !== 'retro') return { state }
  const phase = nextPhase(state, planText)
  if (phase === undefined) return { state: { ...state, status: 'exit' }, launch: exitLaunch(state) }
  return launchPhase(state, phase)
}

const onExitResult = (state: LoopState, event: Extract<LoopEvent, { type: 'exit-result' }>): Action => {
  if (state.status !== 'exit') return { state }
  if (event.merged) return { state: { ...state, status: 'idle' }, notify: `${state.milestone} merged` }
  const gate = event.failing_gate ?? 'unknown gate'
  const escalation: Escalation = { kind: 'gate-refused', phase: state.current ?? '', summary: gate, result_path: state.results['exit'] ?? '' }
  return escalated(state, escalation, `${state.milestone} merge refused: ${gate}`)
}

const transition = (state: LoopState, event: LoopEvent, planText: string | undefined): Action => {
  if (event.type === 'kickoff-done') return onKickoffDone(state, event.brief)
  if (event.type === 'phase-result') return onPhaseResult(state, event)
  if (event.type === 'retro-done') return onRetroDone(state, planText)
  return onExitResult(state, event)
}

const heldWhilePaused = (before: LoopState, action: Action): Action => {
  if (!before.paused || action.launch === undefined) return action
  return { ...action, launch: undefined, state: { ...action.state, pending: action.launch } }
}

export const nextAction = (state: LoopState, event: LoopEvent, planText?: string): Action => heldWhilePaused(state, transition(state, event, planText))
