const PHASE_CHECKPOINT = /git commit[^\n]*phase\(P\d+\):/
const PR_MERGE = /\bgh pr merge\b/

export const IMPLEMENTER_AGENTS = new Set(['implementer'])

export const RETRO_PROMPT =
  'Run the retro: process every open incident per your agent definition, then report fixed count.'

export const isPullRequestMerge = (command: string) => PR_MERGE.test(command)

export const isRetroTrigger = (command: string, hasSucceeded: boolean) => {
  if (!hasSucceeded) return false
  return PHASE_CHECKPOINT.test(command) || isPullRequestMerge(command)
}

export const isPhaseWorkflow = (input: { name?: string; scriptPath?: string }) =>
  input.name === 'phase' || (input.scriptPath ?? '').endsWith('workflows/phase.js')
