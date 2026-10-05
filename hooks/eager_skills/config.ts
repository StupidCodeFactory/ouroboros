export type SkillRef = { name: string; level?: string }

type LaneConfig = { eager_skills?: string[] }
type AgentConfig = LaneConfig & { lanes?: Record<string, LaneConfig> }
export type Stage = 'brief' | 'implement' | 'review' | 'architect_review' | 'audit' | 'fix' | 'planner' | 'checkpoint' | 'merge'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type OuroborosConfig = {
  lanes?: Record<string, { owned_paths?: string[]; env_notes?: string[] }>
  merge_policy?: 'ask' | 'architect'
  branch_prefix?: string
  agents?: Record<string, AgentConfig>
  planning_skills?: string[]
  eager_skills_max_chars?: number
  drafts_dir?: string
  effort?: Partial<Record<Stage, Effort>>
  models?: Partial<Record<'implementer' | 'reviewer' | 'architect' | 'auditor', string>>
}

export const DEFAULT_EAGER_SKILLS_MAX_CHARS = 60000
const PROCESS_SKILLS: Record<string, string[]> = {
  architect: ['checkbox-progress', 'code-style', 'phase-pr-workflow', 'findings-contract', 'adr-format'],
  implementer: ['checkbox-progress', 'code-style', 'phase-pr-workflow'],
  reviewer: ['checkbox-progress', 'code-style', 'findings-contract'],
  auditor: ['checkbox-progress', 'findings-contract'],
  'adr-scribe': ['checkbox-progress', 'adr-format'],
}
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

export const eagerSkillNames = (config: OuroborosConfig, agent: string, lane: string | undefined): SkillRef[] => {
  const agentConfig = config.agents?.[agent]
  const laneConfig = lane === undefined ? undefined : agentConfig?.lanes?.[lane]
  const agentSkills = agentConfig?.eager_skills ?? PROCESS_SKILLS[agent] ?? []
  return dedupeByName([...agentSkills, ...(laneConfig?.eager_skills ?? [])].map(toSkillRef))
}

export type Seat = { role: string; lane: string | undefined }

const WORKFLOW_ROLES = ['architect', 'auditor', 'reviewer', 'implementer']

export const workflowSeats = (config: OuroborosConfig): Seat[] => [
  ...WORKFLOW_ROLES.map(role => ({ role, lane: undefined })),
  ...Object.keys(config.agents?.implementer?.lanes ?? {}).map(lane => ({ role: 'implementer', lane })),
]

export const eagerFileName = ({ role, lane }: Seat) => (lane === undefined ? `${role}.md` : `${role}-${lane}.md`)

export const laneOf = (prompt: string) => LANE_PROMPT.exec(prompt)?.[1]

const ROLES_RUNNING_EVERY_LANE = new Set(['auditor'])

const notesBlock = (lane: string, notes: string[]) => `\n## Test environment: ${lane} lane\n${notes.map(note => `- ${note}`).join('\n')}\n`

export const laneEnvNotes = (config: Pick<OuroborosConfig, 'lanes'>, seat: Seat) => {
  const lanes = Object.entries(config.lanes ?? {}).filter(([lane, settings]) => (settings.env_notes ?? []).length > 0 && (ROLES_RUNNING_EVERY_LANE.has(seat.role) || (seat.role === 'implementer' && seat.lane === lane)))
  return lanes.map(([lane, settings]) => notesBlock(lane, settings.env_notes ?? [])).join('')
}
