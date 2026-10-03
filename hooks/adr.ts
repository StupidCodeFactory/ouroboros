export type Decision = { title: string; context: string; decision: string; alternatives: string; consequences: string }

const DECISIONS_BLOCK = /```json\s*(\{[\s\S]*?"decisions"[\s\S]*?\})\s*```/

export const OPEN_PROPOSED_ADRS = 'open Proposed ADRs'
export const FOLD_DRAFT_CHANGE = 'fold this draft change into its Proposed ADR'
export const ACCEPT_MILESTONE_ADRS =
  'fill Outcome and Verification, set Accepted, run the coverage check with the auditor, prune covered drafts'

export const parseDecisions = (architectText: string): Decision[] => {
  const match = DECISIONS_BLOCK.exec(architectText)
  if (!match) return []
  return JSON.parse(match[1] as string).decisions
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const isDraftPath = (draftsDir: string | undefined, path: string) => {
  if (draftsDir === undefined) return false
  return new RegExp(`(^|/)${escapeRegExp(draftsDir)}/(specs|plans)/`).test(path)
}

export const adrScribePrompt = (instruction: string, decisions: Decision[]) =>
  `${instruction}\n\n\`\`\`json\n${JSON.stringify({ decisions })}\n\`\`\``

export const planDriftRow = (dateIso: string, phase: string, draftPath: string) =>
  `| ${dateIso} | ${phase} | main | plan-drift | | draft edited after kickoff | ${draftPath} | open | |\n`
