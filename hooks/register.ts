import type { EngineInterface, Register } from 'claude-code'

import { isProcessIncident, parseFindings } from './findings'
import { incidentLogPath, incidentRow } from './incident_log'
import { IMPLEMENTER_AGENTS, RETRO_PROMPT, isPhaseWorkflow, isRetroTrigger } from './retro'

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

async function retroPendingDenial($: EngineInterface) {
  const openIncidents = await countOpenIncidents($)
  if (openIncidents === 0) return undefined
  return { deny: `retro pending: ${openIncidents} open incidents` }
}

async function startRetro($: EngineInterface) {
  await $.agent.spawn({ subagentType: 'skill-curator', description: 'retro', prompt: RETRO_PROMPT })
  $.ui.toast('retro started')
}

export const register: Register = on => {
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const agentType = e.subagent_type ?? ''
    if (IMPLEMENTER_AGENTS.has(agentType)) return (await retroPendingDenial($)) ?? next(e)

    const answered = await next(e)
    if (!REVIEWING_AGENTS.has(agentType)) return answered
    if (answered.deny !== undefined || answered.isError) return answered

    await logIncidents($, agentText(answered.result))
    await showOpenIncidents($)
    return answered
  })

  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    if (!isPhaseWorkflow(e)) return next(e)
    return (await retroPendingDenial($)) ?? next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const hasSucceeded = ran.deny === undefined && ran.isError === undefined
    if (!isRetroTrigger(e.command, hasSucceeded)) return ran

    await startRetro($)
    return ran
  })
}
