import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import { ACCEPT_MILESTONE_ADRS, FOLD_DRAFT_CHANGE, OPEN_PROPOSED_ADRS, adrScribePrompt, isDraftPath, parseDecisions, planDriftRow } from './adr'
import { GIT_COMMON_DIR, STATE_PATH, activeDraftsOf, checkoutRootOf, draftsPathOf } from './drafts'
import { isProcessIncident, parseFindings } from './findings'
import type { Finding } from './findings'
import { incidentLogPath, incidentRow } from './incident_log'
import { DEFAULT_EAGER_SKILLS_MAX_CHARS, eagerSkillNames, frontmatterSkills, laneOf } from './eager_skills/config'
import type { OuroborosConfig, SkillRef } from './eager_skills/config'
import { checkBudget, eagerBlock } from './eager_skills/inline'
import type { InlinedSkill } from './eager_skills/inline'
import { fixedSkillRoots, indexSkills, pluginCacheDir, resolveSkill } from './eager_skills/resolve'
import type { SkillIndex, SkillListing } from './eager_skills/resolve'
import { candidateRow, isPlanningSkill, withPlanningLessons } from './planning_lessons'
import { IMPLEMENTER_AGENTS, RETRO_PROMPT, isPhaseWorkflow, isPullRequestMerge, isRetroTrigger } from './retro'
import { SUBAGENT_COMPACTION_INSTRUCTIONS, contextShare, memoryDigestRequest, shouldRollOver } from './rollover'
import { stripFrontmatter } from './skill_text'

const REVIEWING_AGENTS = new Set(['reviewer', 'architect', 'auditor'])
const INCIDENT_LOG_HEADER = '# Incidents\n\n'
const PHASE_CHECKPOINT_SUBJECT = /^phase\(P(\d+)\):/
const MILESTONE_BRANCH = /^milestone\//
const RETIRING = { plugin: 'ouroboros', key: 'retiring' } as const
const PLANNING = { plugin: 'ouroboros', key: 'planning' } as const
const PLANNING_IDLE = { active: false, ranThisTurn: false }
const SKILL_INDEX = { plugin: 'ouroboros', key: 'skillIndex' } as const
const CONFIG_PATH = '.claude/ouroboros.json'
const SPAWNS_LOG = '.claude/ouroboros/spawns.jsonl'
const SKILL_INCIDENT_COMMAND = {
  name: 'skill-incident',
  description: 'Log a correction against a skill: /skill-incident <skill> <text>',
  argumentHint: '<skill> <text>',
}

const agentRole = (subagentType: string) => subagentType.slice(subagentType.lastIndexOf(':') + 1)

const agentText = (result: unknown) => {
  const content = (result as { content?: Array<{ text?: string }> } | undefined)?.content ?? []
  return content.map(block => block.text ?? '').join('\n')
}

const nextPhaseAfter = (checkpointSubject: string) => {
  const match = PHASE_CHECKPOINT_SUBJECT.exec(checkpointSubject.trim())
  if (!match) return 'P0'
  return `P${Number(match[1]) + 1}`
}

const sumGrepCounts = (grepStdout: string) =>
  grepStdout
    .split('\n')
    .map(line => Number(line.slice(line.lastIndexOf(':') + 1)))
    .filter(Number.isFinite)
    .reduce((total, count) => total + count, 0)

const hasSucceeded = (answered: { deny?: unknown; isError?: unknown }) => answered.deny === undefined && answered.isError === undefined

const splitFirstWord = (text: string) => {
  const trimmed = text.trim()
  const boundary = trimmed.search(/\s/)
  if (boundary === -1) return { head: trimmed, rest: '' }
  return { head: trimmed.slice(0, boundary), rest: trimmed.slice(boundary).trim() }
}

type EagerSpawn = { prompt: string; lane: string | undefined; skills: Array<{ name: string; sha: string }> }

const hex = (digest: ArrayBuffer) => [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')

const sha256 = async (text: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))

const sizesOf = (skills: InlinedSkill[]) => Object.fromEntries(skills.map(({ ref, body }) => [ref.name, body.length]))

const shaOf = (skills: InlinedSkill[]) => Promise.all(skills.map(async ({ ref, body }) => ({ name: ref.name, sha: await sha256(body) })))

const userCorrection = (skill: string, summary: string): Finding => ({ summary, root_cause: 'skill-gap', skill, agent: 'user' })

async function lastCheckpointSubject($: EngineInterface) {
  const { stdout } = await $.process.run(['git', 'log', '-1', '--grep=^phase(', '--format=%s'])
  return stdout
}

async function currentPhase($: EngineInterface) {
  return nextPhaseAfter(await lastCheckpointSubject($))
}

async function isMilestoneKickedOff($: EngineInterface) {
  const { stdout: branch } = await $.process.run(['git', 'branch', '--show-current'])
  if (!MILESTONE_BRANCH.test(branch.trim())) return false
  return (await lastCheckpointSubject($)).trim() !== ''
}

async function todayIso($: EngineInterface) {
  return new Date(await $.clock.now()).toISOString().slice(0, 10)
}

async function countOpenIncidents($: EngineInterface) {
  const { stdout } = await $.process.run([
    'grep', '-rc', '| open |', '.claude/skills', `${$.plugin.root}/skills`, `${$.plugin.root}/agents/incidents`,
  ])
  return sumGrepCounts(stdout)
}

async function countProposedAdrs($: EngineInterface) {
  const { stdout } = await $.process.run(['grep', '-rc', 'Status: Proposed', 'docs/adr'])
  return sumGrepCounts(stdout)
}

async function appendIncident($: EngineInterface, path: string, row: string) {
  const existing = (await $.fs.exists(path)) ? await $.fs.read(path) : INCIDENT_LOG_HEADER
  await $.fs.write(path, existing + row)
}

async function logIncidents($: EngineInterface, reviewText: string) {
  const findings = parseFindings(reviewText).filter(isProcessIncident)
  if (findings.length === 0) return
  const dateIso = await todayIso($)
  const phase = await currentPhase($)
  for (const finding of findings) {
    await appendIncident($, incidentLogPath(finding, $.plugin.root), incidentRow(finding, phase, dateIso))
  }
}

async function logUserCorrection($: EngineInterface, skill: string, text: string) {
  const finding = userCorrection(skill, text)
  await appendIncident($, incidentLogPath(finding, $.plugin.root), incidentRow(finding, await currentPhase($), await todayIso($)))
}

async function showStatus($: EngineInterface) {
  $.ui.status(`skills: ${await countOpenIncidents($)} open · ADR ${await countProposedAdrs($)} proposed`)
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

async function askAdrScribe($: EngineInterface, prompt: string) {
  await $.agent.spawn({ subagentType: `${$.plugin.name}:adr-scribe`, description: 'adr', prompt })
}

async function openProposedAdrs($: EngineInterface, architectText: string) {
  const decisions = parseDecisions(architectText)
  if (decisions.length === 0) return
  await askAdrScribe($, adrScribePrompt(OPEN_PROPOSED_ADRS, decisions))
}

const planningLessonsPath = ($: EngineInterface, file: string) => `${$.plugin.root}/skills/planning-lessons/${file}`

async function foldDraftChange($: EngineInterface, draftPath: string) {
  await askAdrScribe($, `${FOLD_DRAFT_CHANGE}: ${draftPath}`)
  if (!(await isMilestoneKickedOff($))) return
  await appendIncident($, planningLessonsPath($, 'incidents.md'), planDriftRow(await todayIso($), await currentPhase($), draftPath))
}

async function planningLessonsText($: EngineInterface) {
  return stripFrontmatter(await $.fs.read(planningLessonsPath($, 'SKILL.md')))
}

async function planningState($: EngineInterface) {
  const { value = PLANNING_IDLE } = await $.state.get(PLANNING)
  return value
}

async function markPlanningSkillRan($: EngineInterface) {
  await $.state.set(PLANNING, { active: true, ranThisTurn: true })
}

async function settlePlanningAfterTurn($: EngineInterface) {
  const planning = await planningState($)
  await $.state.set(PLANNING, { active: planning.active && planning.ranThisTurn, ranThisTurn: false })
}

async function logCandidateLesson($: EngineInterface, promptText: string) {
  if (!(await planningState($)).active) return
  await appendIncident($, planningLessonsPath($, 'incidents.md'), candidateRow(await todayIso($), await currentPhase($), promptText))
}

async function subdirectories($: EngineInterface, path: string) {
  if (!(await $.fs.exists(path))) return []
  return (await $.fs.list(path)).filter(entry => entry.kind === 'dir').map(entry => `${path}/${entry.name}`)
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

async function installedPluginSkillRoots($: EngineInterface, home: string) {
  const roots: Array<[string, string]> = []
  for (const marketplace of await subdirectories($, pluginCacheDir(home))) {
    for (const plugin of await subdirectories($, marketplace)) {
      for (const version of await subdirectories($, plugin)) roots.push([`${version}/skills`, baseName(plugin)])
    }
  }
  return roots
}

async function skillNamesUnder($: EngineInterface, root: string, pluginPrefix: string | undefined): Promise<SkillListing[number]> {
  const names = (await subdirectories($, root)).map(baseName)
  return [root, names, pluginPrefix]
}

async function buildSkillIndex($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? ''
  const [projectRoot, pluginRoot, userRoot] = fixedSkillRoots(await $.session.cwd(), $.plugin.root, home)
  const roots: Array<[string, string | undefined]> = [[projectRoot as string, undefined], [pluginRoot as string, $.plugin.name], [userRoot as string, undefined]]
  const listing = await Promise.all([...roots, ...(await installedPluginSkillRoots($, home))].map(([root, prefix]) => skillNamesUnder($, root, prefix)))
  const index = indexSkills(listing)
  await $.state.set(SKILL_INDEX, index)
  return index
}

async function skillIndex($: EngineInterface): Promise<SkillIndex> {
  const { value } = await $.state.get(SKILL_INDEX)
  return value ?? buildSkillIndex($)
}

async function readConfig($: EngineInterface): Promise<OuroborosConfig> {
  if (!(await $.fs.exists(CONFIG_PATH))) return {}
  return JSON.parse(await $.fs.read(CONFIG_PATH))
}

export async function mainCheckoutRoot($: EngineInterface) {
  const { stdout } = await $.process.run(GIT_COMMON_DIR)
  return checkoutRootOf(stdout)
}

export async function draftsPath($: EngineInterface, relative: string) {
  return draftsPathOf(await mainCheckoutRoot($), (await readConfig($)).drafts_dir, relative)
}

export async function activeDrafts($: EngineInterface) {
  return activeDraftsOf((await $.fs.exists(STATE_PATH)) ? await $.fs.read(STATE_PATH) : undefined)
}

const agentDefinitionPath = ($: EngineInterface, agent: string) => `${$.plugin.root}/agents/${agent}.md`

async function pluginDefaultSkills($: EngineInterface, agent: string) {
  return frontmatterSkills(await $.fs.read(agentDefinitionPath($, agent)))
}

async function inlineSkills($: EngineInterface, refs: SkillRef[]): Promise<InlinedSkill[] | { deny: string }> {
  const index = await skillIndex($)
  const missing = refs.find(ref => resolveSkill(index, ref) === undefined)
  if (missing !== undefined) return { deny: `eager skill not found: ${missing.name}` }
  const resolved = refs.flatMap(ref => resolveSkill(index, ref) ?? [])
  return Promise.all(resolved.map(async skill => ({ ref: skill.ref, body: stripFrontmatter(await $.fs.read(skill.path)) })))
}

async function prepareEagerSpawn($: EngineInterface, agent: string, prompt: string): Promise<{ deny: string } | EagerSpawn> {
  const config = await readConfig($)
  const lane = laneOf(prompt)
  const refs = eagerSkillNames(await pluginDefaultSkills($, agent), config, agent, lane)
  const skills = await inlineSkills($, refs)
  if ('deny' in skills) return skills
  const block = eagerBlock(skills)
  const budget = checkBudget(block, config.eager_skills_max_chars ?? DEFAULT_EAGER_SKILLS_MAX_CHARS, sizesOf(skills))
  if (!budget.ok) return { deny: budget.reason }
  return { prompt: block + prompt, lane, skills: await shaOf(skills) }
}

async function recordSpawn($: EngineInterface, agent: string, spawn: EagerSpawn) {
  const existing = (await $.fs.exists(SPAWNS_LOG)) ? await $.fs.read(SPAWNS_LOG) : ''
  await $.fs.write(SPAWNS_LOG, `${existing}${JSON.stringify({ agent, lane: spawn.lane, skills: spawn.skills })}\n`)
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
  on('session.start', async ($, e, next) => {
    await $.command.register(SKILL_INCIDENT_COMMAND)
    await buildSkillIndex($)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const agent = agentRole(e.subagentType)
    if (!(await $.fs.exists(agentDefinitionPath($, agent)))) return next(e)
    const prepared = await prepareEagerSpawn($, agent, e.prompt)
    if ('deny' in prepared) return { deny: prepared.deny }
    const spawned = await next({ ...e, prompt: prepared.prompt })
    if (spawned.deny === undefined) await recordSpawn($, agent, prepared)
    return spawned
  })

  on('command.run', { command: SKILL_INCIDENT_COMMAND.name }, async ($, e) => {
    const { head: skill, rest: text } = splitFirstWord(e.args)
    await logUserCorrection($, skill, text)
    await showStatus($)
    return { text: `logged against ${skill}` }
  })

  on('skill.prompt', async ($, e, next) => {
    if (!isPlanningSkill(e.skill)) return next(e)
    const shown = await next(e)
    await markPlanningSkillRan($)
    return { text: withPlanningLessons(shown.text, await planningLessonsText($)) }
  })

  on('prompt.submit', async ($, e, next) => {
    await logCandidateLesson($, e.text)
    return next(e)
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const agentType = agentRole(e.subagent_type ?? '')
    if (IMPLEMENTER_AGENTS.has(agentType)) return (await retroPendingDenial($)) ?? next(e)

    const answered = await next(e)
    if (!REVIEWING_AGENTS.has(agentType)) return answered
    if (!hasSucceeded(answered)) return answered

    await logIncidents($, agentText(answered.result))
    if (agentType === 'architect') await openProposedAdrs($, agentText(answered.result))
    await showStatus($)
    return answered
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const written = await next(e)
    if (!hasSucceeded(written) || !isDraftPath(e.file_path)) return written
    await foldDraftChange($, e.file_path)
    return written
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const edited = await next(e)
    if (!hasSucceeded(edited) || !isDraftPath(e.file_path)) return edited
    await foldDraftChange($, e.file_path)
    return edited
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
    if (e.agentId === undefined) await settlePlanningAfterTurn($)
    if (e.agentId !== undefined && e.usage !== undefined) await rollOverIfPast($, e.agentId, e.usage)
    return next(e)
  })

  on('session.compact', ($, e, next) => {
    if (e.agentId === undefined) return next(e)
    return next({ ...e, instructions: SUBAGENT_COMPACTION_INSTRUCTIONS })
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (!isRetroTrigger(e.command, hasSucceeded(ran))) return ran

    await startRetro($)
    if (isPullRequestMerge(e.command)) await askAdrScribe($, ACCEPT_MILESTONE_ADRS)
    return ran
  })
}
