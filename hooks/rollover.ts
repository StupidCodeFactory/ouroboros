import type { ModelUsage } from 'claude-code'

const ROLLOVER_CONTEXT_SHARE = 0.55

export const contextShare = (usage: ModelUsage, windowTokens: number) =>
  (usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens) / windowTokens

export const shouldRollOver = (share: number) => share >= ROLLOVER_CONTEXT_SHARE

export const memoryDigestRequest = (agentName: string) =>
  `Write your memory digest to .claude/agent-memory/${agentName}.md now, then stop.`

export const SUBAGENT_COMPACTION_INSTRUCTIONS = 'Keep domain facts, owned paths, and the open task.'
