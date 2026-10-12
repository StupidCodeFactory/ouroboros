import { contractGaps, parseDependsOn, parseTaskBody, renderTaskBody } from './github/contract'
import type { CommandItem } from './github/contract'
import type { Column } from './github/gh_commands'

export type BoardSubIssue = { number: number; state: 'open' | 'closed'; title: string; body: string; column?: string; labels: string[] }
export type ItemVerdict = { index: number; pass: boolean; evidence: string }
export type Review = { items: ItemVerdict[]; defects: string[] }

export const ESCALATION_HEADING = '## Ouroboros needs the owner'
export const MAX_REVIEW_ROUNDS = 3

const DEPENDS_ON_SECTION = /^## Depends on\n([\s\S]*?)(?=\n## |$)/m
const NOT_REPORTED = 'not reported by the review'

const dependenciesOf = (body: string) => parseDependsOn(DEPENDS_ON_SECTION.exec(body)?.[1] ?? 'none') ?? []

const isFinished = (subIssue: BoardSubIssue, columns: Record<Column, string>) => subIssue.state === 'closed' || subIssue.column === columns.done

const blockersOf = (subIssue: BoardSubIssue, all: BoardSubIssue[], columns: Record<Column, string>) =>
  dependenciesOf(subIssue.body).filter(number => {
    const dependency = all.find(candidate => candidate.number === number)
    return dependency === undefined || !isFinished(dependency, columns)
  })

const waitingLine = (subIssue: BoardSubIssue, all: BoardSubIssue[], columns: Record<Column, string>) =>
  `#${subIssue.number} waits on ${blockersOf(subIssue, all, columns).map(number => `#${number}`).join(', ')}`

export const nextSubIssue = (subIssues: BoardSubIssue[], columns: Record<Column, string>): { issue: BoardSubIssue } | { none: string } | { finished: true } => {
  const planned = subIssues.filter(subIssue => subIssue.state === 'open' && subIssue.column === columns.planned).sort((left, right) => left.number - right.number)
  const ready = planned.find(subIssue => blockersOf(subIssue, subIssues, columns).length === 0)
  if (ready !== undefined) return { issue: ready }
  if (subIssues.every(subIssue => isFinished(subIssue, columns))) return { finished: true }
  if (planned.length === 0) return { none: 'no sub-issue is in Planned' }
  return { none: `no sub-issue is ready: ${planned.map(subIssue => waitingLine(subIssue, subIssues, columns)).join('; ')}` }
}

export const readinessComment = (body: string) => {
  const gaps = contractGaps(body)
  if (gaps.length === 0) return undefined
  return `${ESCALATION_HEADING}\nThis sub-issue cannot start: ${gaps.join(', ')} are missing or incomplete. Every section must be present, the plan must end in a \`Files:\` line, and every checklist item must name a command. Fix the body, remove the \`needs-owner\` label and run \`/ouroboros start\` again.`
}

export const escalationComment = (question: string) => `${ESCALATION_HEADING}\n${question}\n\nAnswer here, remove the \`needs-owner\` label and run \`/ouroboros start\` again.`

const slugOf = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '')

export const branchName = (prefix: string, number: number, title: string) => `${prefix}${number}-${slugOf(title)}`

const verdictOf = (review: Review, index: number): ItemVerdict => review.items.find(item => item.index === index) ?? { index, pass: false, evidence: NOT_REPORTED }

const failureLine = (item: CommandItem, verdict: ItemVerdict) => `- ${item.text}: \`${item.command}\`\n  ${verdict.evidence}`

const reviewComment = (failures: string[], defects: string[]) =>
  [
    '## Review found defects',
    ...(failures.length === 0 ? [] : ['Failed checks:', ...failures, '']),
    ...(defects.length === 0 ? [] : ['Defects:', ...defects.map(defect => `- ${defect}`), '']),
    'Back to In Progress.',
  ].join('\n')

export const reviewOutcome = (body: string, review: Review) => {
  const task = parseTaskBody(body)
  if (task === undefined) return { accepted: false, body, comment: reviewComment([], ['the sub-issue body no longer parses', ...review.defects]) }
  const verdicts = task.checklist.map((_, position) => verdictOf(review, position + 1))
  const checklist = task.checklist.map((item, position) => ({ ...item, done: verdicts[position]?.pass === true }))
  const failures = checklist.flatMap((item, position) => (item.done ? [] : [failureLine(item, verdicts[position] as ItemVerdict)]))
  const accepted = failures.length === 0 && review.defects.length === 0
  return { accepted, body: renderTaskBody({ ...task, checklist }), comment: accepted ? '' : reviewComment(failures, review.defects) }
}

export type StageDetail = { branch: string; base: string; round: number; pullRequest?: string }

const pullRequestNumber = (url = '') => url.split('/').pop()

export const stageComment = (column: 'in_progress' | 'qa' | 'done', { branch, base, round, pullRequest }: StageDetail) => {
  if (column === 'in_progress') return `Ouroboros: In Progress on \`${branch}\` (from ${base}), implementing, round ${round}`
  if (column === 'qa') return `Ouroboros: QA, reviewing round ${round}`
  return `Ouroboros: Done, PR #${pullRequestNumber(pullRequest)} opened from \`${branch}\` into ${base}; the merge closes this issue`
}
