import type { Escalation, Launch, LoopState } from './state'

export const COMPACT_INSTRUCTIONS = 'Keep only the ouroboros loop header and the open escalations; drop everything else.'

const escalationLine = ({ kind, phase, summary, result_path }: Escalation) => `${kind} ${phase}: ${summary} (${result_path})`

export const escalationsText = (state: LoopState) => (state.escalations.length === 0 ? 'no escalations' : state.escalations.map(escalationLine).join('\n'))

export const workflowCall = (launch: Launch) => `Workflow name=${launch.workflow} args=${JSON.stringify(launch.args)}`

const pendingText = (state: LoopState) => (state.pending === undefined ? 'none' : workflowCall(state.pending))

export const loopHeader = (state: LoopState) =>
  [
    `ouroboros ${state.milestone || 'no milestone'} · phase ${state.current ?? '-'} of ${state.phases.join(',') || '-'} · ${state.status}${state.paused ? ' (paused)' : ''}`,
    `escalations: ${state.escalations.length} open · pending launch: ${pendingText(state)}`,
    `drafts: ${state.drafts?.plan ?? 'none'} · in flight: ${state.run?.workflow ?? 'nothing'}`,
  ].join('\n')
