import type { Finding } from './findings'

export type IncidentPlaces = {
  pluginName: string
  pluginRoot: string
  projectRoot: string
  pluginWritable: boolean
  pluginSkills: string[]
  pluginAgents: string[]
}

const PLUGIN_PREFIX = /^([\w-]+):/

const prefixOf = (name: string) => PLUGIN_PREFIX.exec(name)?.[1]

const bareName = (name: string) => name.slice(name.lastIndexOf(':') + 1)

const AGENT_PLAYING = { planner: 'architect', curator: 'skill-curator' } as Record<string, string>

const knownAgentIn = (part: string, pluginAgents: string[]) => pluginAgents.find(known => part === known || part.startsWith(`${known}-`))

const pluginAgentName = (agent: string, pluginAgents: string[]) => {
  const parts = agent.split(':').map(part => AGENT_PLAYING[part] ?? part)
  for (const part of parts) {
    const known = knownAgentIn(part, pluginAgents)
    if (known !== undefined) return known
  }
  return parts[parts.length - 1] ?? agent
}

const relativeTo = (projectRoot: string, path: string) => (path.startsWith(`${projectRoot}/`) ? path.slice(projectRoot.length + 1) : path)

const evidence = (finding: Finding, projectRoot: string) => (finding.file === undefined ? '' : `${relativeTo(projectRoot, finding.file)}:${finding.line ?? ''}`)

export const incidentRow = (finding: Finding, phase: string, dateIso: string, projectRoot = '') =>
  `| ${dateIso} | ${phase} | ${finding.agent ?? ''} | ${finding.root_cause} | | ${finding.summary} | ${evidence(finding, projectRoot)} | open | |\n`

const pluginIncidentsDir = (places: IncidentPlaces, plugin: string) => `${places.projectRoot}/.claude/ouroboros/plugin-incidents/${plugin}`

const ownPluginPath = (places: IncidentPlaces, kind: 'skills' | 'agents', name: string) => {
  if (!places.pluginWritable) return `${pluginIncidentsDir(places, places.pluginName)}/${kind}/${name}.md`
  return kind === 'skills' ? `${places.pluginRoot}/skills/${name}/incidents.md` : `${places.pluginRoot}/agents/incidents/${name}.md`
}

const skillIncidentPath = (skill: string, places: IncidentPlaces) => {
  const plugin = prefixOf(skill)
  const name = bareName(skill)
  if (plugin !== undefined && plugin !== places.pluginName) return `${pluginIncidentsDir(places, plugin)}/skills/${name}.md`
  if (plugin === places.pluginName || places.pluginSkills.includes(name)) return ownPluginPath(places, 'skills', name)
  return `${places.projectRoot}/.claude/skills/${name}/incidents.md`
}

const agentIncidentPath = (agent: string, places: IncidentPlaces) => {
  const name = pluginAgentName(agent, places.pluginAgents)
  if (!places.pluginAgents.includes(name)) return `${pluginIncidentsDir(places, places.pluginName)}/agents/${name}.md`
  return ownPluginPath(places, 'agents', name)
}

const unownedPath = (places: IncidentPlaces) => `${pluginIncidentsDir(places, places.pluginName)}/unowned.md`

export const incidentLogPath = (finding: Finding, places: IncidentPlaces) => {
  const byAgent = finding.agent === undefined ? undefined : agentIncidentPath(finding.agent, places)
  const bySkill = finding.skill === undefined ? undefined : skillIncidentPath(finding.skill, places)
  const owned = finding.root_cause === 'agent-behaviour' ? (byAgent ?? bySkill) : (bySkill ?? byAgent)
  return owned ?? unownedPath(places)
}

const isOpenSkillIncident = (row: string) => row.includes('| open |') && !row.includes('| plan-drift |')

export const openIncidentCount = (incidentRows: string) => incidentRows.split('\n').filter(isOpenSkillIncident).length
