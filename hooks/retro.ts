import { bareName } from './conductor/events'

const PHASE_CHECKPOINT = /git commit[^\n]*phase\((P\d+)\):/
const PR_MERGE = /\bgh pr merge\b/

export const IMPLEMENTER_AGENTS = new Set(['implementer'])

export const RETRO_PROMPT =
  'Run the retro: process every open incident per your agent definition. Then check every .claude/agent-memory/*.md for file paths that no longer exist in the repository and rewrite or drop those lines. Report the fixed count and the memory lines changed.'

export type EagerFile = { name: string; size: number }

const EAGER_FILES_DIR = '.claude/ouroboros/eager'

const sizeLine = (file: EagerFile) => `${EAGER_FILES_DIR}/${file.name} (${file.size})`

export const retroPrompt = (eagerFiles: EagerFile[], limit: number) => {
  const oversized = eagerFiles.filter(file => file.size > limit).sort((left, right) => right.size - left.size)
  if (oversized.length === 0) return RETRO_PROMPT
  return `${RETRO_PROMPT}\nSlim these eager files (over ${limit} chars): ${oversized.map(sizeLine).join(', ')}. Follow the slimming steps of your agent definition.`
}

export const checkpointPhaseOf = (command: string) => PHASE_CHECKPOINT.exec(command)?.[1]

export const isPullRequestMerge = (command: string) => PR_MERGE.test(command)

const MERGE_OR_REBASE = /\b(git\s+(merge|rebase|pull)|gh\s+pr\s+merge)\b/

export const isMergeOrRebase = (command: string) => MERGE_OR_REBASE.test(command)

export const isGuardedMerge = (command: string, agentId: string | undefined) => agentId === undefined && isMergeOrRebase(command)

export const isRetroTrigger = (command: string, hasSucceeded: boolean) => {
  if (!hasSucceeded) return false
  return PHASE_CHECKPOINT.test(command) || isPullRequestMerge(command)
}

export const isPhaseWorkflow = (input: { name?: string; scriptPath?: string }) =>
  bareName(input.name ?? '') === 'phase' || (input.scriptPath ?? '').endsWith('workflows/phase.js')
