import type { SubIssue } from './github/kickoff_plan'

export type KickoffBrief = { issue: number; title: string; prd_section: string; milestone_body: string; sub_issues: SubIssue[] }
export type StageBrief = { issue: number; title: string; body: string; branch: string; base: string; round: number; defects: string[] }

const KICKOFF_ANSWER = 'Answer with the milestone body (goal, brief, acceptance) and the full task list. Give a task an `issue` only when it revises that open sub-issue.'

const IMPLEMENT_ANSWER = 'Answer `status: "done"` with a summary once every checklist command passes and your work is committed, or `status: "blocked"` with one question for the owner.'

const REVIEW_ANSWER = 'Answer one entry in `items` per checklist item, `index` counting from 1 in the order listed, and the `defects` you found.'

const subIssueText = (subIssue: SubIssue) => `### #${subIssue.number} (${subIssue.state}) ${subIssue.title}\n${subIssue.body}`

export const kickoffPrompt = (brief: KickoffBrief) =>
  `Plan milestone #${brief.issue} "${brief.title}".\n\n` +
  `PRD section:\n${brief.prd_section}\n\n` +
  `Current milestone body:\n${brief.milestone_body || '(empty)'}\n\n` +
  `Sub-issues (${brief.sub_issues.length}):\n${brief.sub_issues.map(subIssueText).join('\n\n') || '(none)'}\n\n` +
  KICKOFF_ANSWER

const where = (brief: StageBrief) => `Branch: ${brief.branch} (based on ${brief.base}), checked out in this session's checkout`

const defectsText = (brief: StageBrief) =>
  brief.defects.length === 0 ? '' : `\n\nReview round ${brief.round} rejected the work. Fix all of this:\n${brief.defects.join('\n')}`

export const implementPrompt = (brief: StageBrief) =>
  `Implement sub-issue #${brief.issue} "${brief.title}".\n${where(brief)}\n\nSub-issue:\n${brief.body}${defectsText(brief)}\n\n${IMPLEMENT_ANSWER}`

export const reviewPrompt = (brief: StageBrief) => `Review sub-issue #${brief.issue} "${brief.title}".\n${where(brief)}\n\nSub-issue:\n${brief.body}\n\n${REVIEW_ANSWER}`
