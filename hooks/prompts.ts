import type { SubIssue } from './github/kickoff_plan'

export type KickoffBrief = { issue: number; title: string; prd_section: string; milestone_body: string; sub_issues: SubIssue[] }
export type StageBrief = { issue: number; title: string; body: string; worktree: string; branch: string; base: string; round: number; defects: string[] }

const FENCED_JSON = /```json\s*\n([\s\S]*?)\n```/g

const answerRule = (shape: string) => `\n\nEnd your answer with one fenced \`\`\`json block holding exactly:\n${shape}`

const KICKOFF_SHAPE = `{
  "milestone": { "goal": "...", "brief": "...", "acceptance": [{ "text": "...", "command": "..." }] },
  "tasks": [{ "issue": 12, "title": "...", "goal": "...", "plan": "...\\nFiles: \`a\`, \`b/**\`", "checklist": [{ "text": "...", "command": "..." }], "depends_on": [{ "issue": 11 }, { "task": 1 }] }]
}
"issue" on a task only when it revises that open sub-issue.`

const IMPLEMENT_SHAPE = `{ "status": "done", "summary": "..." }
or, when you cannot finish:
{ "status": "blocked", "question": "..." }`

const REVIEW_SHAPE = `{ "items": [{ "index": 1, "pass": true, "evidence": "..." }], "defects": ["..."] }
One entry in "items" per checklist item, "index" counting from 1 in the order listed.`

const subIssueText = (subIssue: SubIssue) => `### #${subIssue.number} (${subIssue.state}) ${subIssue.title}\n${subIssue.body}`

export const kickoffPrompt = (brief: KickoffBrief) =>
  `Plan milestone #${brief.issue} "${brief.title}".\n\n` +
  `PRD section:\n${brief.prd_section}\n\n` +
  `Current milestone body:\n${brief.milestone_body || '(empty)'}\n\n` +
  `Sub-issues (${brief.sub_issues.length}):\n${brief.sub_issues.map(subIssueText).join('\n\n') || '(none)'}` +
  answerRule(KICKOFF_SHAPE)

const where = (brief: StageBrief) => `Worktree: ${brief.worktree}\nBranch: ${brief.branch} (based on ${brief.base})`

const defectsText = (brief: StageBrief) =>
  brief.defects.length === 0 ? '' : `\n\nReview round ${brief.round} rejected the work. Fix all of this:\n${brief.defects.join('\n')}`

export const implementPrompt = (brief: StageBrief) =>
  `Implement sub-issue #${brief.issue} "${brief.title}".\n${where(brief)}\n\nSub-issue:\n${brief.body}${defectsText(brief)}` + answerRule(IMPLEMENT_SHAPE)

export const reviewPrompt = (brief: StageBrief) => `Review sub-issue #${brief.issue} "${brief.title}".\n${where(brief)}\n\nSub-issue:\n${brief.body}` + answerRule(REVIEW_SHAPE)

export const answerJson = (answer: string): Record<string, unknown> | undefined => {
  const blocks = [...answer.matchAll(FENCED_JSON)]
  const last = blocks[blocks.length - 1]?.[1]
  if (last === undefined) return undefined
  try {
    const parsed = JSON.parse(last)
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}
