export type SkillRef = { name: string; level?: string }

type LaneConfig = { eager_skills?: string[] }
type AgentConfig = LaneConfig & { lanes?: Record<string, LaneConfig> }
export type OuroborosConfig = {
  agents?: Record<string, AgentConfig>
  eager_skills_max_chars?: number
}

export const DEFAULT_EAGER_SKILLS_MAX_CHARS = 60000
const FRONTMATTER_SKILLS = /^skills:\s*\[([^\]]*)\]/m
const LANE_PROMPT = /^Lane (\S+)\./

const toSkillRef = (entry: string): SkillRef => {
  const separator = entry.lastIndexOf(':')
  if (separator === -1) return { name: entry }
  return { name: entry.slice(0, separator), level: entry.slice(separator + 1) }
}

const dedupeByName = (refs: SkillRef[]) => {
  const seen = new Set<string>()
  return refs.filter(ref => !seen.has(ref.name) && seen.add(ref.name))
}

export const eagerSkillNames = (pluginDefaults: string[], config: OuroborosConfig, agent: string, lane: string | undefined): SkillRef[] => {
  const agentConfig = config.agents?.[agent]
  const laneConfig = lane === undefined ? undefined : agentConfig?.lanes?.[lane]
  const entries = [...pluginDefaults, ...(agentConfig?.eager_skills ?? []), ...(laneConfig?.eager_skills ?? [])]
  return dedupeByName(entries.map(toSkillRef))
}

export const frontmatterSkills = (agentDefinition: string) => {
  const match = FRONTMATTER_SKILLS.exec(agentDefinition)
  if (!match) return []
  return (match[1] as string).split(',').map(entry => entry.trim()).filter(entry => entry !== '')
}

export const laneOf = (prompt: string) => LANE_PROMPT.exec(prompt)?.[1]
