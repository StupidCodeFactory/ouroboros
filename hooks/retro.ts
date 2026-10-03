import { bareName } from './conductor/events'

const PHASE_CHECKPOINT = /git commit[^\n]*phase\((P\d+)\):/
const PR_MERGE = /\bgh pr merge\b/

export const IMPLEMENTER_AGENTS = new Set(['implementer'])

export const RETRO_PROMPT =
  'Run the retro: process every open incident per your agent definition. Then check every .claude/agent-memory/*.md for file paths that no longer exist in the repository and rewrite or drop those lines. Report the fixed count and the memory lines changed.'

export const checkpointPhaseOf = (command: string) => PHASE_CHECKPOINT.exec(command)?.[1]

export const isPullRequestMerge = (command: string) => PR_MERGE.test(command)

const MERGE_OR_REBASE = /\b(git\s+(merge|rebase|pull)|gh\s+pr\s+merge)\b/

export const isMergeOrRebase = (command: string) => MERGE_OR_REBASE.test(command)

export const isRetroTrigger = (command: string, hasSucceeded: boolean) => {
  if (!hasSucceeded) return false
  return PHASE_CHECKPOINT.test(command) || isPullRequestMerge(command)
}

export const isPhaseWorkflow = (input: { name?: string; scriptPath?: string }) =>
  bareName(input.name ?? '') === 'phase' || (input.scriptPath ?? '').endsWith('workflows/phase.js')
