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
