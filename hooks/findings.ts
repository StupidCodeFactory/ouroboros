export type RootCause = 'code-bug' | 'skill-gap' | 'skill-misread' | 'skill-misuse' | 'agent-behaviour'

export type Finding = {
  file?: string
  line?: number
  summary: string
  root_cause: RootCause
  skill?: string
  agent?: string
}

const FINDINGS_BLOCK = /```json\s*(\{[\s\S]*?"findings"[\s\S]*?\})\s*```/

export const parseFindings = (agentText: string): Finding[] => {
  const match = FINDINGS_BLOCK.exec(agentText)
  if (!match) return []
  return JSON.parse(match[1] as string).findings
}

export const isProcessIncident = (finding: Finding) => finding.root_cause !== 'code-bug'

type RawFinding = { summary?: unknown; root_cause?: unknown; skill?: unknown; agent?: unknown; file?: unknown; line?: unknown }

const PROCESS_ROOT_CAUSES: RootCause[] = ['skill-gap', 'skill-misread', 'skill-misuse', 'agent-behaviour']

const textOr = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined)

const asIncident = (raw: RawFinding): Finding | undefined => {
  const rootCause = PROCESS_ROOT_CAUSES.find(cause => cause === raw.root_cause)
  const skill = textOr(raw.skill)
  const agent = textOr(raw.agent)
  if (rootCause === undefined || (skill === undefined && agent === undefined)) return undefined
  return {
    summary: String(raw.summary ?? ''),
    root_cause: rootCause,
    ...(skill === undefined ? {} : { skill }),
    ...(agent === undefined ? {} : { agent }),
    ...(textOr(raw.file) === undefined ? {} : { file: raw.file as string }),
    ...(typeof raw.line === 'number' ? { line: raw.line } : {}),
  }
}

const incidentKey = (finding: Finding) => `${finding.root_cause}|${finding.skill ?? ''}|${finding.agent ?? ''}|${finding.summary}`

const taskFindings = (json: Record<string, unknown> | undefined): RawFinding[] => {
  if (!Array.isArray(json?.tasks)) return []
  return (json.tasks as Array<{ findings?: unknown }>).flatMap(task => (Array.isArray(task.findings) ? (task.findings as RawFinding[]) : []))
}

export const phaseIncidents = (json: Record<string, unknown> | undefined): Finding[] => {
  const incidents = taskFindings(json).flatMap(raw => asIncident(raw) ?? [])
  return incidents.filter((finding, position) => incidents.findIndex(other => incidentKey(other) === incidentKey(finding)) === position)
}
