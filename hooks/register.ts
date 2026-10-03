import type { EngineInterface, Register } from 'claude-code'

import { isProcessIncident, parseFindings } from './findings'
import { incidentLogPath, incidentRow } from './incident_log'

const REVIEWING_AGENTS = new Set(['reviewer', 'architect', 'auditor'])
const INCIDENT_LOG_HEADER = '# Incidents\n\n'
const PHASE_CHECKPOINT_SUBJECT = /^phase\(P(\d+)\):/

const agentText = (result: unknown) => {
  const content = (result as { content?: Array<{ text?: string }> } | undefined)?.content ?? []
  return content.map(block => block.text ?? '').join('\n')
}

const nextPhaseAfter = (lastCheckpointSubject: string) => {
  const match = PHASE_CHECKPOINT_SUBJECT.exec(lastCheckpointSubject.trim())
  if (!match) return 'P0'
  return `P${Number(match[1]) + 1}`
}

const sumGrepCounts = (grepStdout: string) =>
  grepStdout
    .split('\n')
    .map(line => Number(line.slice(line.lastIndexOf(':') + 1)))
    .filter(Number.isFinite)
    .reduce((total, count) => total + count, 0)

async function currentPhase($: EngineInterface) {
  const { stdout } = await $.process.run(['git', 'log', '-1', '--grep=^phase(', '--format=%s'])
  return nextPhaseAfter(stdout)
}

async function countOpenIncidents($: EngineInterface) {
  const { stdout } = await $.process.run([
    'grep', '-rc', '| open |', '.claude/skills', `${$.plugin.root}/skills`, `${$.plugin.root}/agents/incidents`,
  ])
  return sumGrepCounts(stdout)
}

async function appendIncident($: EngineInterface, path: string, row: string) {
  const existing = (await $.fs.exists(path)) ? await $.fs.read(path) : INCIDENT_LOG_HEADER
  await $.fs.write(path, existing + row)
}

async function logIncidents($: EngineInterface, reviewText: string) {
  const findings = parseFindings(reviewText).filter(isProcessIncident)
  if (findings.length === 0) return
  const dateIso = new Date(await $.clock.now()).toISOString().slice(0, 10)
  const phase = await currentPhase($)
  for (const finding of findings) {
    await appendIncident($, incidentLogPath(finding, $.plugin.root), incidentRow(finding, phase, dateIso))
  }
}

async function showOpenIncidents($: EngineInterface) {
  $.ui.status(`skills: ${await countOpenIncidents($)} open`)
}

export const register: Register = on => {
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const answered = await next(e)
    if (!REVIEWING_AGENTS.has(e.subagent_type ?? '')) return answered
    if (answered.deny !== undefined || answered.isError) return answered

    await logIncidents($, agentText(answered.result))
    await showOpenIncidents($)
    return answered
  })
}
