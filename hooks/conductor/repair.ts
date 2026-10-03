import { bareName } from './events'
import type { LoopState, LoopStatus } from './state'

export type Repair = { state: LoopState } | { error: string }

const ADOPTED_STATUS: Record<string, LoopStatus> = { 'milestone-kickoff': 'kickoff', phase: 'phase', retro: 'retro', 'milestone-exit': 'exit' }
const STATUSES: LoopStatus[] = ['idle', 'kickoff', 'phase', 'retro', 'exit', 'paused', 'escalated']
const ADOPT_USAGE = 'usage: /ouroboros adopt <task-id> <workflow> [phase]'
const SET_USAGE = 'usage: /ouroboros set phase <PN> | set status <status>'

const unknownPhase = (state: LoopState, phase: string) => `unknown phase ${phase}: one of ${state.phases.join(', ')}`

const isPendingFor = (state: LoopState, workflow: string) => state.pending !== undefined && bareName(state.pending.workflow) === workflow

const adoptionError = (state: LoopState, taskId: string, workflow: string, phase: string | undefined) => {
  if (taskId === '') return ADOPT_USAGE
  if (state.milestone === '') return 'no milestone in state.json: run /ouroboros kickoff first'
  if (ADOPTED_STATUS[workflow] === undefined) return `unknown workflow ${workflow}: one of ${Object.keys(ADOPTED_STATUS).join(', ')}`
  if (workflow === 'phase' && phase === undefined) return `adopting a phase run needs its phase: one of ${state.phases.join(', ')}`
  if (phase !== undefined && !state.phases.includes(phase)) return unknownPhase(state, phase)
  return undefined
}

export const adoptRun = (state: LoopState, taskId: string, workflowName: string, phase?: string): Repair => {
  const workflow = bareName(workflowName)
  const error = adoptionError(state, taskId, workflow, phase)
  if (error !== undefined) return { error }
  const adopted: LoopState = { ...state, status: ADOPTED_STATUS[workflow] ?? state.status, current: phase ?? state.current, run: { id: taskId, workflow } }
  return { state: isPendingFor(state, workflow) ? { ...adopted, pending: undefined } : adopted }
}

export const setPosition = (state: LoopState, field: string, value: string): Repair => {
  if (field === 'phase') return state.phases.includes(value) ? { state: { ...state, current: value } } : { error: unknownPhase(state, value) }
  if (field !== 'status') return { error: SET_USAGE }
  const status = STATUSES.find(candidate => candidate === value)
  return status === undefined ? { error: `unknown status ${value}: one of ${STATUSES.join(', ')}` } : { state: { ...state, status } }
}

const inFlight = (state: LoopState) => (state.run === undefined ? 'nothing' : `${state.run.workflow} (${state.run.id})`)

export const positionLine = (state: LoopState) =>
  `${state.milestone || 'no milestone'} · phase ${state.current ?? '-'} · ${state.status} · in flight ${inFlight(state)} · pending ${state.pending?.workflow ?? 'none'}`
