import type { ActiveDrafts } from '../drafts'
import { planPhases } from '../drafts'

export type LoopStatus = 'idle' | 'kickoff' | 'phase' | 'retro' | 'exit' | 'paused' | 'escalated'
export type Launch = { workflow: string; args: object }
export type Run = { id: string; workflow: string }
export type Escalation = { kind: 'task-red' | 'check-red' | 'gate-refused'; phase: string; summary: string; result_path: string }
export type LoopState = {
  milestone: string
  phases: string[]
  current: string | null
  status: LoopStatus
  escalations: Escalation[]
  results: Record<string, string>
  drafts?: ActiveDrafts
  brief?: string
  brief_path?: string
  brief_dir?: string
  touches?: Record<string, string[]>
  awaiting_merge?: { phase: string; pr_url: string }
  run?: Run
  pending?: Launch
  paused?: boolean
}

export const IDLE_STATE: LoopState = { milestone: '', phases: [], current: null, status: 'idle', escalations: [], results: {} }

export const parseState = (json: string | undefined): LoopState => {
  if (json === undefined) return IDLE_STATE
  return { ...IDLE_STATE, ...JSON.parse(json) }
}

export const serializeState = (state: LoopState) => JSON.stringify(state, null, 2)

export const kickoffState = (milestone: string, drafts: ActiveDrafts, planText: string): LoopState => ({
  ...IDLE_STATE,
  milestone,
  phases: planPhases(planText),
  status: 'kickoff',
  drafts,
})
