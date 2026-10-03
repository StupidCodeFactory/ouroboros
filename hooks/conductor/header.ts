import type { Escalation, Launch, LoopState, LoopStatus } from './state'

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

const CURRENT_PHASE_STATE: Record<LoopStatus, string> = {
  idle: 'done',
  kickoff: 'queued',
  phase: 'running',
  retro: 'retro running',
  exit: 'done',
  paused: 'paused',
  escalated: 'escalated',
}

const lastCellOrPadded = (widths: number[]) => (cell: string, column: number) => (column === widths.length - 1 ? cell : cell.padEnd(widths[column] ?? 0))

const tableLine = (cells: string[], widths: number[]) => cells.map(lastCellOrPadded(widths)).join('  ')

const columnWidths = (rows: string[][]) => (rows[0] ?? []).map((_, column) => Math.max(...rows.map(row => (row[column] ?? '').length)))

const table = (header: string[], rows: string[][]) => {
  const widths = columnWidths([header, ...rows])
  return [header, widths.map(width => '-'.repeat(width)), ...rows].map(row => tableLine(row, widths)).join('\n')
}

const keyValues = (rows: string[][]) => {
  const widths = columnWidths(rows)
  return rows.map(row => tableLine(row, widths)).join('\n')
}

const phaseState = (state: LoopState, phase: string) => {
  const current = state.current === null ? -1 : state.phases.indexOf(state.current)
  const position = state.phases.indexOf(phase)
  if (current === -1 || position > current) return 'queued'
  if (position < current) return 'done'
  return CURRENT_PHASE_STATE[state.status]
}

const launchedPhase = (launch: Launch) => {
  const { phase } = launch.args as { phase?: unknown }
  return typeof phase === 'string' ? ` ${phase}` : ''
}

const pendingLaunch = (state: LoopState) => (state.pending === undefined ? 'none' : `${state.pending.workflow}${launchedPhase(state.pending)} (run /ouroboros resume)`)

const inFlight = (state: LoopState) => (state.run === undefined ? 'nothing' : `${state.run.workflow} (${state.run.id})`)

const escalationTable = (state: LoopState) =>
  state.escalations.length === 0
    ? []
    : ['', table(['escalation', 'phase', 'summary', 'result'], state.escalations.map(({ kind, phase, summary, result_path }) => [kind, phase, summary, result_path]))]

export const statusReport = (state: LoopState) =>
  [
    `ouroboros · ${state.milestone || 'no milestone'} · ${state.status}${state.paused ? ' (paused)' : ''}`,
    '',
    table(['phase', 'state'], state.phases.map(phase => [phase, phaseState(state, phase)])),
    '',
    keyValues([
      ['in flight', inFlight(state)],
      ['pending launch', pendingLaunch(state)],
      ['plan', state.drafts?.plan ?? 'none'],
    ]),
    ...escalationTable(state),
  ].join('\n')
