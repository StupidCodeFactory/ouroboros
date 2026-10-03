import { firstUncheckedBox, phaseTasks } from '../drafts'
import { bareName } from './events'
import type { LaneOwnership } from './lanes'
import type { LoopState } from './state'
import { exitLaunch, phaseLaunch } from './transitions'

export type Evidence = { briefPath?: string; committedPhases: string[]; planText?: string; lanes?: LaneOwnership }

const everyPhaseCarriesTasks = (phases: string[], planText: string | undefined) =>
  planText !== undefined && phases.every(phase => phaseTasks(planText, phase).length > 0)

const kickoffRunReason = (state: LoopState, evidence: Evidence) => {
  const recorded = state.results['kickoff']
  if (recorded !== undefined) return `its result was recorded at ${recorded}`
  if (evidence.briefPath === undefined || !everyPhaseCarriesTasks(state.phases, evidence.planText)) return undefined
  return `its brief exists at ${evidence.briefPath} and every plan phase (${state.phases.join(', ')}) already carries tasks`
}

const phaseRunReason = (phase: string, evidence: Evidence) => {
  if (!evidence.committedPhases.includes(phase) || evidence.planText === undefined) return undefined
  if (firstUncheckedBox(evidence.planText, phase) !== null) return undefined
  return `a phase(${phase}) commit is on the branch and none of its plan boxes is open`
}

const pendingPhase = (state: LoopState) => {
  const { phase } = (state.pending?.args ?? {}) as { phase?: unknown }
  return typeof phase === 'string' ? phase : undefined
}

const staleness = (state: LoopState, evidence: Evidence) => {
  const workflow = bareName(state.pending?.workflow ?? '')
  if (workflow === 'milestone-kickoff') return { label: 'milestone-kickoff', reason: kickoffRunReason(state, evidence), next: state.phases[0] }
  const phase = pendingPhase(state)
  if (workflow !== 'phase' || phase === undefined) return undefined
  return { label: `phase ${phase}`, reason: phaseRunReason(phase, evidence), next: state.phases[state.phases.indexOf(phase) + 1] }
}

const withKnownBrief = (state: LoopState, evidence: Evidence): LoopState => {
  if (state.brief_dir !== undefined || state.brief_path !== undefined || evidence.briefPath === undefined) return state
  return { ...state, brief_path: evidence.briefPath }
}

const offering = (state: LoopState, phase: string | undefined, evidence: Evidence): LoopState => {
  if (phase === undefined) return { ...state, status: 'exit', pending: exitLaunch(state) }
  return { ...state, status: 'phase', current: phase, pending: phaseLaunch(state, phase, evidence.planText, evidence.lanes) }
}

export const reconcilePending = (state: LoopState, evidence: Evidence) => {
  const dropped: string[] = []
  let reconciled = state
  for (let step = 0; step <= state.phases.length; step++) {
    const stale = staleness(reconciled, evidence)
    if (stale?.reason === undefined) break
    dropped.push(`dropped ${stale.label}: ${stale.reason}`)
    reconciled = offering(withKnownBrief(reconciled, evidence), stale.next, evidence)
  }
  return { state: reconciled, dropped }
}
