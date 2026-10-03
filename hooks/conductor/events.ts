import type { Run } from './state'
import { briefSlicesOf } from './briefs'
import type { LoopEvent } from './transitions'

const PLUGIN_PREFIX = /^[\w-]+:/
const OUTPUT_FILE = /<output-file>([^<]+)<\/output-file>/

export const bareName = (name: string) => name.replace(PLUGIN_PREFIX, '')

export const outputFileOf = (notificationText: string) => OUTPUT_FILE.exec(notificationText)?.[1]

export const workflowResultOf = (outputFileText: string): Record<string, unknown> | undefined => {
  try {
    const { result } = JSON.parse(outputFileText) as { result?: unknown }
    return result !== null && typeof result === 'object' ? (result as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

const escaped = (literal: string) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const isLoopNotification = (text: string, run: Run | undefined) =>
  run !== undefined && new RegExp(`(^|[^\\w-])${escaped(run.id)}([^\\w-]|$)`).test(text)

const parseFrom = (text: string, start: number, end: number) => {
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return undefined
  }
}

export const embeddedJson = (text: string): Record<string, unknown> | undefined => {
  const end = text.lastIndexOf('}')
  for (let start = text.indexOf('{'); start !== -1 && start < end; start = text.indexOf('{', start + 1)) {
    const parsed = parseFrom(text, start, end)
    if (parsed !== undefined) return parsed
  }
  return undefined
}

const phaseEvent = (json: Record<string, unknown> | undefined, phase: string | null, resultPath: string): LoopEvent => ({
  type: 'phase-result',
  status: json?.status === 'checkpointed' ? 'checkpointed' : 'escalate',
  phase: typeof json?.phase === 'string' ? json.phase : (phase ?? ''),
  result_path: resultPath,
  ...(typeof json?.failing_gate === 'string' && json.failing_gate !== '' ? { failing_gate: json.failing_gate } : {}),
  ...(typeof json?.pr_url === 'string' && json.pr_url !== '' && json.merged !== true ? { pr_url: json.pr_url } : {}),
  ...(typeof json?.checkpoint_sha === 'string' && json.checkpoint_sha !== '' ? { checkpoint_sha: json.checkpoint_sha } : {}),
})

const exitEvent = (json: Record<string, unknown> | undefined): LoopEvent => {
  if (json?.merged === true) return { type: 'exit-result', merged: true }
  return { type: 'exit-result', merged: false, failing_gate: typeof json?.failing_gate === 'string' ? json.failing_gate : 'result unreadable' }
}

export const kickoffDecisionsOf = (run: Run, json: Record<string, unknown> | undefined): object[] => {
  if (bareName(run.workflow) !== 'milestone-kickoff' || !Array.isArray(json?.decisions)) return []
  return json.decisions
}

const kickoffEvent = (json: Record<string, unknown> | undefined): LoopEvent => {
  const slices = briefSlicesOf(json)
  if (slices !== undefined) return { type: 'kickoff-done', brief: '', slices }
  return { type: 'kickoff-done', brief: typeof json?.brief === 'string' ? json.brief : '' }
}

export const loopEventOf = (text: string, resultPath: string, run: Run, currentPhase: string | null, json = embeddedJson(text)): LoopEvent => {
  const workflow = bareName(run.workflow)
  if (workflow === 'milestone-kickoff') return kickoffEvent(json)
  if (workflow === 'retro') return { type: 'retro-done' }
  if (workflow === 'milestone-exit') return exitEvent(json)
  return phaseEvent(json, currentPhase, resultPath)
}

export type CheckpointProof = { head: { sha: string; subject: string }; phaseCommitFound: boolean; openTasks: string[] }

type PhaseResult = Extract<LoopEvent, { type: 'phase-result' }>

const isSameCommit = (left: string, right: string) => left !== '' && right !== '' && (left.startsWith(right) || right.startsWith(left))

const commitGap = (event: PhaseResult, proof: CheckpointProof) => {
  if (event.checkpoint_sha === undefined) return proof.phaseCommitFound ? undefined : `the workflow reported checkpointed but no phase(${event.phase}) commit is on the branch`
  if (isSameCommit(event.checkpoint_sha, proof.head.sha) && proof.head.subject.startsWith(`phase(${event.phase}):`)) return undefined
  return `the workflow reported checkpoint ${event.checkpoint_sha} but HEAD is ${proof.head.sha.slice(0, 8)} "${proof.head.subject}"`
}

const boxGap = (proof: CheckpointProof) =>
  proof.openTasks.length === 0 ? undefined : `the workflow reported checkpointed with open plan boxes in tasks ${proof.openTasks.join(', ')}`

export const verifiedCheckpoint = (event: LoopEvent, proof: CheckpointProof): LoopEvent => {
  if (event.type !== 'phase-result' || event.status !== 'checkpointed') return event
  const gap = commitGap(event, proof) ?? boxGap(proof)
  return gap === undefined ? event : { ...event, status: 'escalate', failing_gate: gap }
}
