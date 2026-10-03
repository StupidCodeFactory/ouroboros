import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import { isProcessIncident, parseFindings } from './findings'
import { incidentLogPath, incidentRow } from './incident_log'
import { IMPLEMENTER_AGENTS, RETRO_PROMPT, isPhaseWorkflow, isRetroTrigger } from './retro'
import { SUBAGENT_COMPACTION_INSTRUCTIONS, contextShare, memoryDigestRequest, shouldRollOver } from './rollover'

const REVIEWING_AGENTS = new Set(['reviewer', 'architect', 'auditor'])
const INCIDENT_LOG_HEADER = '# Incidents\n\n'
const PHASE_CHECKPOINT_SUBJECT = /^phase\(P(\d+)\):/
const RETIRING = { plugin: 'ouroboros', key: 'retiring' } as const

const agentRole = (subagentType: string) => subagentType.slice(subagentType.lastIndexOf(':') + 1)

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
  await $.agent.spawn({ subagentType: `${$.plugin.name}:skill-curator`, description: 'retro', prompt: RETRO_PROMPT })
  $.ui.toast('retro started')
}

async function addressableAgentName($: EngineInterface, agentId: string) {
  const agents = await $.agent.list()
  return agents.find(agent => agent.id === agentId)?.name
}

async function isPastRollover($: EngineInterface, usage: TurnUsage) {
  const { context } = await $.session.usage()
  return shouldRollOver(contextShare(usage, context.window))
}

async function retiringAgents($: EngineInterface) {
  const { value = [] } = await $.state.get(RETIRING)
  return value
}

async function retire($: EngineInterface, agentId: string, agentName: string) {
  await $.session.send({ to: { agentId }, text: memoryDigestRequest(agentName) })
  await $.state.set(RETIRING, [...new Set([...(await retiringAgents($)), agentName])])
}

async function rollOverIfPast($: EngineInterface, agentId: string, usage: TurnUsage) {
  const agentName = await addressableAgentName($, agentId)
  if (agentName === undefined) return
  if (!(await isPastRollover($, usage))) return
  await retire($, agentId, agentName)
}

async function spawnFresh($: EngineInterface, agentName: string, prompt: string) {
  await $.state.set(RETIRING, (await retiringAgents($)).filter(name => name !== agentName))
  const spawned = await $.agent.spawn({
    subagentType: `${$.plugin.name}:${agentName}`,
    description: `fresh ${agentName}`,
    prompt,
    name: agentName,
  })
  if (spawned.deny !== undefined) return { deny: spawned.deny }
  return { result: { success: true, message: `${agentName} rolled over to a fresh instance ${spawned.agentId ?? ''}` } }
}

export const register: Register = on => {
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const agentType = agentRole(e.subagent_type ?? '')
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

  on('tool.call', { tool: 'SendMessage' }, async ($, e, next) => {
    const recipient = String(e.to)
    if (typeof e.message !== 'string') return next(e)
    if (!(await retiringAgents($)).includes(recipient)) return next(e)
    return spawnFresh($, recipient, e.message)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined && e.usage !== undefined) await rollOverIfPast($, e.agentId, e.usage)
    return next(e)
  })

  on('session.compact', ($, e, next) => {
    if (e.agentId === undefined) return next(e)
    return next({ ...e, instructions: SUBAGENT_COMPACTION_INSTRUCTIONS })
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const hasSucceeded = ran.deny === undefined && ran.isError === undefined
    if (!isRetroTrigger(e.command, hasSucceeded)) return ran

    await startRetro($)
    return ran
  })
}
