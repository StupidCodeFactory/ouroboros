import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import { ACCEPT_MILESTONE_ADRS, FOLD_DRAFT_CHANGE, OPEN_PROPOSED_ADRS, adrScribePrompt, isDraftPath, parseDecisions, planDriftRow } from './adr'
import { GIT_COMMON_DIR, STATE_PATH, activeDraftsOf, assertUniqueTaskIds, checkoutRootOf, draftsPathOf, firstUncheckedBox } from './drafts'
import type { ActiveDrafts } from './drafts'
import { briefFiles } from './conductor/briefs'
import type { BriefSlices } from './conductor/briefs'
import { digestedResult, isOversized } from './conductor/digest'
import { bareName, embeddedJson, isLoopNotification, kickoffDecisionsOf, loopEventOf, outputFileOf, workflowResultOf } from './conductor/events'
import { COMPACT_INSTRUCTIONS, escalationsText, loopHeader, statusReport, workflowCall } from './conductor/header'
import { kickoffState, parseState, serializeState } from './conductor/state'
import { discoverDrafts, kickoffArgs, type Discovery, type DraftFile, type KickoffArgs } from './discover'
import type { Launch, LoopState, Run } from './conductor/state'
import { reconcilePending } from './conductor/reconcile'
import { adoptRun, positionLine, setPosition } from './conductor/repair'
import type { Repair } from './conductor/repair'
import type { Evidence } from './conductor/reconcile'
import { nextAction } from './conductor/transitions'
import type { Action, LoopEvent } from './conductor/transitions'
import { isProcessIncident, parseFindings } from './findings'
import type { Finding } from './findings'
import { incidentLogPath, incidentRow } from './incident_log'
import { phaseFollowUps } from './phase_review'
import { DEFAULT_EAGER_SKILLS_MAX_CHARS, eagerFileName, eagerSkillNames, laneOf, workflowSeats } from './eager_skills/config'
import type { OuroborosConfig, SkillRef } from './eager_skills/config'
import { checkBudget, eagerBlock } from './eager_skills/inline'
import type { InlinedSkill } from './eager_skills/inline'
import { fixedSkillRoots, indexSkills, pluginCacheDir, pluginSkillRoots, resolveSkill } from './eager_skills/resolve'
import type { SkillIndex, SkillListing } from './eager_skills/resolve'
import { candidateRow, isPlanningSkill, withPlanningLessons } from './planning_lessons'
import { IMPLEMENTER_AGENTS, RETRO_PROMPT, checkpointPhaseOf, isPhaseWorkflow, isPullRequestMerge, isRetroTrigger } from './retro'
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
const RESULTS_DIR = '.claude/ouroboros/results'
const EAGER_DIR = '.claude/ouroboros/eager'
const BRIEFS_DIR = '.claude/ouroboros/briefs'
const OUROBOROS_COMMAND = {
  name: 'ouroboros',
  description: 'Conductor: /ouroboros status | pause | resume | escalations | kickoff <milestone> [<spec> <plan>] [goal] | adopt <task-id> <workflow> [phase] | set phase <PN> | set status <status>',
  argumentHint: '<subcommand>',
}
const SKILL_INCIDENT_COMMAND = {
  name: 'skill-incident',
  description: 'Log a correction against a skill: /skill-incident <skill> <text>',
  argumentHint: '<skill> <text>',
}

const LOOP_WORKFLOWS = new Set(['milestone-kickoff', 'phase', 'milestone-exit'])

const agentRole = (subagentType: string) => subagentType.slice(subagentType.lastIndexOf(':') + 1)

const isLoopAgent = ($: EngineInterface, subagentType: string | undefined) => (subagentType ?? '').startsWith(`${$.plugin.name}:`)

const isLoopWorkflow = (name: string | undefined) => LOOP_WORKFLOWS.has(bareName(name ?? ''))

const withEagerDir = (args: unknown, eagerDir: string) => ({ ...(args as Record<string, unknown> | undefined), eager_dir: eagerDir })

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

async function startRetro($: EngineInterface): Promise<Run> {
  const spawned = await $.agent.spawn({ subagentType: `${$.plugin.name}:skill-curator`, description: 'retro', prompt: RETRO_PROMPT })
  $.ui.toast('retro started')
  return { id: spawned.agentId ?? 'retro', workflow: 'retro' }
}

async function readLoopState($: EngineInterface) {
  return parseState((await $.fs.exists(STATE_PATH)) ? await $.fs.read(STATE_PATH) : undefined)
}

async function writeLoopState($: EngineInterface, state: LoopState) {
  await $.fs.write(STATE_PATH, serializeState(state))
}

async function activePlanText($: EngineInterface) {
  const drafts = await activeDrafts($)
  if (drafts === null) return undefined
  const path = await draftsPath($, drafts.plan)
  return (await $.fs.exists(path)) ? await $.fs.read(path) : undefined
}

const launchNote = (launch: Launch) => `launch now: ${workflowCall(launch)} (or later with /ouroboros resume)`

async function deliverPendingLaunch($: EngineInterface, state: LoopState) {
  if (state.pending === undefined || state.paused) return
  await $.session.send({ to: { sessionId: await $.session.id() }, text: launchNote(state.pending) })
}

const withEffort = (launch: Launch, effort: OuroborosConfig['effort']): Launch => {
  if (effort === undefined) return launch
  return { ...launch, args: { ...launch.args, effort } }
}

async function perform($: EngineInterface, state: LoopState, launch: Launch): Promise<{ state: LoopState; note?: string }> {
  if (launch.workflow === 'retro') return { state: { ...state, run: await startRetro($), pending: undefined } }
  const pending = withEffort(launch, (await readConfig($)).effort)
  return { state: { ...state, pending, run: undefined }, note: launchNote(pending) }
}

async function recordLaunchedWorkflow($: EngineInterface, name: string | undefined, taskId: string | undefined) {
  const state = await readLoopState($)
  if (state.pending === undefined || state.pending.workflow !== bareName(name ?? '')) return
  await writeLoopState($, { ...state, pending: undefined, run: { id: taskId ?? state.pending.workflow, workflow: state.pending.workflow } })
}

async function settle($: EngineInterface, action: Action): Promise<{ state: LoopState; note?: string }> {
  if (action.launch === undefined) {
    await writeLoopState($, action.state)
    return { state: action.state, note: action.notify }
  }
  const performed = await perform($, action.state, action.launch)
  await writeLoopState($, performed.state)
  return { state: performed.state, note: [action.notify, performed.note].filter(Boolean).join('; ') || undefined }
}

const laneOwnership = (config: OuroborosConfig) => Object.fromEntries(Object.entries(config.lanes ?? {}).map(([lane, settings]) => [lane, settings.owned_paths ?? []]))

const isAbsolutePath = (path: string) => path.startsWith('/')

async function existsInProject($: EngineInterface, path: string) {
  return $.fs.exists(isAbsolutePath(path) ? path : await projectPath($, path))
}

async function briefOnDisk($: EngineInterface, state: LoopState) {
  if (state.brief_dir !== undefined && (await existsInProject($, `${state.brief_dir}/common.md`))) return state.brief_dir
  const candidates = [state.brief_path, `${BRIEFS_DIR}/${state.milestone}.md`].filter((path): path is string => path !== undefined)
  for (const candidate of candidates) if (await existsInProject($, candidate)) return candidate
  return undefined
}

async function hasPhaseCommit($: EngineInterface, phase: string) {
  const { stdout } = await $.process.run(['git', 'log', '-1', `--grep=^phase(${phase}):`, '--format=%h'])
  return stdout.trim() !== ''
}

async function committedPhases($: EngineInterface, phases: string[]) {
  const committed: string[] = []
  for (const phase of phases) if (await hasPhaseCommit($, phase)) committed.push(phase)
  return committed
}

async function loopEvidence($: EngineInterface, state: LoopState): Promise<Evidence> {
  return {
    briefPath: await briefOnDisk($, state),
    committedPhases: await committedPhases($, state.phases),
    planText: await activePlanText($),
    lanes: laneOwnership(await readConfig($)),
  }
}

async function offerPending($: EngineInterface, state: LoopState) {
  if (state.pending === undefined) {
    await writeLoopState($, state)
    return 'nothing queued'
  }
  const settled = await settle($, { state: { ...state, pending: undefined }, launch: state.pending })
  await deliverPendingLaunch($, settled.state)
  return settled.note ?? 'launched'
}

async function assertPlanReady($: EngineInterface) {
  const planText = await activePlanText($)
  if (planText !== undefined) assertUniqueTaskIds(planText)
}

const loudly = (error: unknown) => `ouroboros: ${error instanceof Error ? error.message : String(error)}`

async function resumeLoop($: EngineInterface, state: LoopState) {
  await assertPlanReady($)
  const resumed = { ...state, paused: false }
  const reconciled = reconcilePending(resumed, await loopEvidence($, resumed))
  return [...reconciled.dropped, `resumed: ${await offerPending($, reconciled.state)}`].join('\n')
}

const MISSING_CONFIG = 'no .claude/ouroboros.json in this directory: create one (plugin README, Project setup) or open the session in the checkout that has it'

async function draftFiles($: EngineInterface, draftsRoot: string): Promise<DraftFile[]> {
  const { stdout } = await $.process.run(['sh', '-c', 'cd "$1" && find . -name "*.md" -type f -print0 | xargs -0 -r ls -t', 'sh', draftsRoot])
  const paths = stdout.split('\n').filter(Boolean).map(path => path.replace(/^\.\//, ''))
  return Promise.all(paths.map(async path => ({ path, text: await $.fs.read(`${draftsRoot}/${path}`) })))
}

async function resolveDrafts($: EngineInterface, milestone: string, parsed: KickoffArgs): Promise<Discovery> {
  if (parsed.spec !== undefined && parsed.plan !== undefined) return { drafts: { spec: parsed.spec, plan: parsed.plan } }
  const draftsDir = (await readConfig($)).drafts_dir ?? ''
  const draftsRoot = (await draftsPath($, '')).replace(/\/$/, '')
  return discoverDrafts(await draftFiles($, draftsRoot), milestone, draftsDir)
}

async function kickoff($: EngineInterface, args: string) {
  const parsed = kickoffArgs(args)
  if (parsed.milestone === undefined) return 'usage: /ouroboros kickoff <milestone> [<spec> <plan>] [goal]'
  if (!(await $.fs.exists(CONFIG_PATH))) return MISSING_CONFIG
  const discovery = await resolveDrafts($, parsed.milestone, parsed)
  if ('error' in discovery) return discovery.error
  const { spec, plan } = discovery.drafts
  const planPath = await draftsPath($, plan)
  if (!(await $.fs.exists(planPath))) return `plan not found: ${planPath}`
  const launch: Launch = { workflow: 'milestone-kickoff', args: { milestone: parsed.milestone, goal: parsed.goal, spec, plan } }
  assertUniqueTaskIds(await $.fs.read(planPath))
  const state = { ...kickoffState(parsed.milestone, discovery.drafts, await $.fs.read(planPath)), pending: launch }
  const reconciled = reconcilePending(state, await loopEvidence($, state))
  return [`spec: ${spec}`, `plan: ${plan}`, ...reconciled.dropped, await offerPending($, reconciled.state)].join('\n')
}

async function repaired($: EngineInterface, before: LoopState, repair: Repair) {
  if ('error' in repair) return repair.error
  await writeLoopState($, repair.state)
  return `before: ${positionLine(before)}\nafter:  ${positionLine(repair.state)}`
}

const words = (text: string) => text.split(/\s+/).filter(Boolean)

async function adopt($: EngineInterface, state: LoopState, args: string) {
  const [taskId = '', workflow = '', phase] = words(args)
  return repaired($, state, adoptRun(state, taskId, workflow, phase))
}

async function setField($: EngineInterface, state: LoopState, args: string) {
  const [field = '', value = ''] = words(args)
  return repaired($, state, setPosition(state, field, value))
}

async function runConductorCommand($: EngineInterface, args: string) {
  const { head, rest } = splitFirstWord(args)
  const state = await readLoopState($)
  if (head === 'status') return statusReport(state)
  if (head === 'escalations') return escalationsText(state)
  if (head === 'resume') return resumeLoop($, state)
  if (head === 'kickoff') return kickoff($, rest)
  if (head === 'adopt') return adopt($, state, rest)
  if (head === 'set') return setField($, state, rest)
  if (head !== 'pause') return OUROBOROS_COMMAND.description
  await writeLoopState($, { ...state, paused: true })
  return 'paused: results are still recorded, launches are queued until /ouroboros resume'
}

async function fileBriefSlices($: EngineInterface, milestone: string, slices: BriefSlices) {
  const dir = await projectPath($, `${BRIEFS_DIR}/${milestone}`)
  for (const file of briefFiles(slices)) await $.fs.write(`${dir}/${file.name}`, file.text)
  return dir
}

async function withFiledBrief($: EngineInterface, milestone: string, event: LoopEvent): Promise<LoopEvent> {
  if (event.type !== 'kickoff-done') return event
  if (event.slices !== undefined) return { ...event, brief_dir: await fileBriefSlices($, milestone, event.slices) }
  if (event.brief === '') return event
  const briefPath = await projectPath($, `${BRIEFS_DIR}/${milestone}.md`)
  await $.fs.write(briefPath, event.brief)
  return { ...event, brief_path: briefPath }
}

async function isPrematureCheckpoint($: EngineInterface, command: string) {
  const phase = checkpointPhaseOf(command)
  if (phase === undefined) return false
  const planText = await activePlanText($)
  return planText !== undefined && firstUncheckedBox(planText, phase) !== null
}

async function appendToPlan($: EngineInterface, section: string) {
  const drafts = await activeDrafts($)
  if (section === '' || drafts === null) return
  const path = await draftsPath($, drafts.plan)
  if (!(await $.fs.exists(path))) return
  await $.fs.write(path, (await $.fs.read(path)) + section)
}

async function workflowOutputText($: EngineInterface, notificationText: string) {
  const outputFile = outputFileOf(notificationText)
  if (outputFile === undefined || !(await $.fs.exists(outputFile))) return undefined
  return $.fs.read(outputFile)
}

async function conductLoopResult($: EngineInterface, state: LoopState, run: Run, text: string) {
  const resultPath = `${RESULTS_DIR}/${run.id}.json`
  const outputText = await workflowOutputText($, text)
  await $.fs.write(await projectPath($, resultPath), outputText ?? text)
  const json = (outputText === undefined ? undefined : workflowResultOf(outputText)) ?? embeddedJson(text)
  await openKickoffAdrs($, kickoffDecisionsOf(run, json))
  if (bareName(run.workflow) === 'phase') await appendToPlan($, phaseFollowUps(json))
  const event = await withFiledBrief($, state.milestone, loopEventOf(text, resultPath, run, state.current, json))
  return settle($, nextAction({ ...state, run: undefined }, event, await activePlanText($), laneOwnership(await readConfig($))))
}

async function repositoryRoot($: EngineInterface) {
  const { stdout } = await $.process.run(['git', 'rev-parse', '--show-toplevel'])
  return stdout.trim() || (await $.session.cwd())
}

async function projectPath($: EngineInterface, relative: string) {
  return `${await repositoryRoot($)}/${relative}`
}

async function filedResult<T extends { result?: unknown }>($: EngineInterface, tool: string, toolUseId: string | undefined, answered: T): Promise<T> {
  if (answered.result === undefined || !isOversized(answered.result)) return answered
  const path = await projectPath($, `${RESULTS_DIR}/${toolUseId ?? 'result'}.json`)
  await $.fs.write(path, JSON.stringify(answered.result))
  return { ...answered, result: digestedResult(tool, answered.result, path) }
}

async function askAdrScribe($: EngineInterface, prompt: string) {
  await $.agent.spawn({ subagentType: `${$.plugin.name}:adr-scribe`, description: 'adr', prompt })
}

async function openKickoffAdrs($: EngineInterface, decisions: readonly object[]) {
  if (decisions.length === 0) return
  await askAdrScribe($, adrScribePrompt(OPEN_PROPOSED_ADRS, decisions))
}

async function openProposedAdrs($: EngineInterface, architectText: string) {
  const decisions = parseDecisions(architectText)
  if (decisions.length === 0) return
  await askAdrScribe($, adrScribePrompt(OPEN_PROPOSED_ADRS, decisions))
}

const planningLessonsPath = ($: EngineInterface, file: string) => `${$.plugin.root}/skills/planning-lessons/${file}`

async function isDraft($: EngineInterface, path: string) {
  return isDraftPath((await readConfig($)).drafts_dir, path)
}

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

async function manifestSkills($: EngineInterface, versionDir: string): Promise<string | string[] | undefined> {
  const manifestPath = `${versionDir}/.claude-plugin/plugin.json`
  if (!(await $.fs.exists(manifestPath))) return undefined
  return JSON.parse(await $.fs.read(manifestPath)).skills
}

async function installedPluginSkillRoots($: EngineInterface, home: string) {
  const roots: Array<[string, string[] | undefined, string]> = []
  for (const marketplace of await subdirectories($, pluginCacheDir(home))) {
    for (const plugin of await subdirectories($, marketplace)) {
      for (const version of await subdirectories($, plugin)) {
        for (const [root, names] of pluginSkillRoots(version, await manifestSkills($, version))) roots.push([root, names, baseName(plugin)])
      }
    }
  }
  return roots
}

async function skillNamesUnder($: EngineInterface, root: string, names: string[] | undefined, pluginPrefix: string | undefined): Promise<SkillListing[number]> {
  return [root, names ?? (await subdirectories($, root)).map(baseName), pluginPrefix]
}

async function buildSkillIndex($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? ''
  const [projectRoot, pluginRoot, userRoot] = fixedSkillRoots(await repositoryRoot($), $.plugin.root, home)
  const roots: Array<[string, string[] | undefined, string | undefined]> = [
    [projectRoot as string, undefined, undefined],
    [pluginRoot as string, undefined, $.plugin.name],
    [userRoot as string, undefined, undefined],
  ]
  const listing = await Promise.all([...roots, ...(await installedPluginSkillRoots($, home))].map(([root, names, prefix]) => skillNamesUnder($, root, names, prefix)))
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

async function inlineSkills($: EngineInterface, refs: SkillRef[]): Promise<InlinedSkill[] | { deny: string }> {
  const index = await skillIndex($)
  const missing = refs.find(ref => resolveSkill(index, ref) === undefined)
  if (missing !== undefined) return { deny: `eager skill not found: ${missing.name}` }
  const resolved = refs.flatMap(ref => resolveSkill(index, ref) ?? [])
  return Promise.all(resolved.map(async skill => ({ ref: skill.ref, body: stripFrontmatter(await $.fs.read(skill.path)) })))
}

async function eagerSkillsFor($: EngineInterface, config: OuroborosConfig, agent: string, lane: string | undefined) {
  const skills = await inlineSkills($, eagerSkillNames(config, agent, lane))
  if ('deny' in skills) return skills
  const block = eagerBlock(skills)
  const budget = checkBudget(block, config.eager_skills_max_chars ?? DEFAULT_EAGER_SKILLS_MAX_CHARS, sizesOf(skills))
  if (!budget.ok) return { deny: budget.reason }
  return { block, skills }
}

async function prepareEagerSpawn($: EngineInterface, agent: string, prompt: string): Promise<{ deny: string } | EagerSpawn> {
  const lane = laneOf(prompt)
  const eager = await eagerSkillsFor($, await readConfig($), agent, lane)
  if ('deny' in eager) return eager
  return { prompt: eager.block + prompt, lane, skills: await shaOf(eager.skills) }
}

async function writeEagerFiles($: EngineInterface): Promise<{ deny: string } | { dir: string }> {
  const config = await readConfig($)
  const dir = await projectPath($, EAGER_DIR)
  for (const seat of workflowSeats(config)) {
    const eager = await eagerSkillsFor($, config, seat.role, seat.lane)
    if ('deny' in eager) return eager
    await $.fs.write(`${dir}/${eagerFileName(seat)}`, eager.block)
  }
  return { dir }
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
    await $.command.register(OUROBOROS_COMMAND)
    await buildSkillIndex($)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    if (e.subagentType === undefined) return next(e)
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

  on('command.run', { command: OUROBOROS_COMMAND.name }, async ($, e) => {
    try {
      return { text: await runConductorCommand($, e.args) }
    } catch (error) {
      return { text: loudly(error) }
    }
  })

  on('session.receive', { origin: { kind: 'task-notification' } }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const state = await readLoopState($)
    if (state.run === undefined || !isLoopNotification(e.text, state.run)) return next(e)
    try {
      const { note } = await conductLoopResult($, state, state.run, e.text)
      if (note === undefined) return { consumed: 'ouroboros conductor filed the result' }
      return next({ ...e, text: note })
    } catch (error) {
      return next({ ...e, text: `${e.text}\n\n${loudly(error)}` })
    }
  })

  on('prompt.context', async ($, e, next) => {
    if (!(await $.fs.exists(STATE_PATH))) return next(e)
    return next({ ...e, blocks: [...e.blocks, { name: 'ouroboros', text: loopHeader(await readLoopState($)) }] })
  })

  on('skill.prompt', async ($, e, next) => {
    if (!isPlanningSkill((await readConfig($)).planning_skills, e.skill)) return next(e)
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
    const filed = isLoopAgent($, e.subagent_type) ? await filedResult($, 'Agent', e.tool_use_id, answered) : answered
    if (!REVIEWING_AGENTS.has(agentType) || !hasSucceeded(answered)) return filed

    await logIncidents($, agentText(answered.result))
    if (agentType === 'architect') await openProposedAdrs($, agentText(answered.result))
    await showStatus($)
    return filed
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const written = await next(e)
    if (!hasSucceeded(written) || !(await isDraft($, e.file_path))) return written
    await foldDraftChange($, e.file_path)
    return written
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const edited = await next(e)
    if (!hasSucceeded(edited) || !(await isDraft($, e.file_path))) return edited
    await foldDraftChange($, e.file_path)
    return edited
  })

  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const denial = isPhaseWorkflow(e) ? await retroPendingDenial($) : undefined
    if (denial !== undefined) return denial
    if (!isLoopWorkflow(e.name)) return next(e)
    const eager = await writeEagerFiles($)
    if ('deny' in eager) return { deny: eager.deny }
    const launched = await next({ ...e, args: withEagerDir(e.args, eager.dir) })
    if (hasSucceeded(launched)) await recordLaunchedWorkflow($, e.name, (launched.result as { taskId?: string } | undefined)?.taskId)
    return filedResult($, 'Workflow', e.tool_use_id, launched)
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

  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next({ ...e, instructions: SUBAGENT_COMPACTION_INSTRUCTIONS })
    if (!(await $.fs.exists(STATE_PATH))) return next(e)
    return next({ ...e, instructions: COMPACT_INSTRUCTIONS })
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (!isRetroTrigger(e.command, hasSucceeded(ran))) return ran
    if (await isPrematureCheckpoint($, e.command)) return ran
    if (isPullRequestMerge(e.command) && (await readLoopState($)).status === 'phase') return ran

    await startRetro($)
    if (isPullRequestMerge(e.command)) await askAdrScribe($, ACCEPT_MILESTONE_ADRS)
    return ran
  })
}
