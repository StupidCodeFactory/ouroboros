export type Hunk = { file: string; start: number; end: number }
export type Reviewer = { agent: string; stage: string }
export type ReviewFinding = { reviewer?: string; file?: string; line?: number; summary: string; blocking: boolean }
export type Implemented = { changed?: boolean; commits?: string[]; hunks?: Hunk[]; evidence?: string }

export const needsReview = (implemented: Implemented | undefined) => implemented?.changed !== false

export const samePath = (left: string, right: string) => left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)

export const sameSpot = (left: ReviewFinding, right: ReviewFinding) =>
  left.file !== undefined && right.file !== undefined && samePath(left.file, right.file) && left.line === right.line

export const isCoveredBy = (finding: ReviewFinding, kept: ReviewFinding[]) => kept.some(keptFinding => sameSpot(finding, keptFinding))

export const reviewersOwningEachFinding = <R extends Reviewer>(reviewers: R[], blocking: ReviewFinding[]) => {
  const kept: ReviewFinding[] = []
  return reviewers.filter(reviewer => {
    const fresh = blocking.filter(finding => finding.reviewer === reviewer.agent && !isCoveredBy(finding, kept))
    kept.push(...fresh)
    return fresh.length > 0
  })
}

export const touchesOtherFiles = (fix: Hunk[], blocking: ReviewFinding[]) =>
  fix.some(hunk => !blocking.some(finding => finding.file !== undefined && samePath(hunk.file, finding.file)))

export const reviewersForRound = <R extends Reviewer>(round: number, maxRounds: number, reviewers: R[], previousBlocking: ReviewFinding[], fix: Hunk[]): R[] => {
  if (round === 1 || round === maxRounds || previousBlocking.length === 0) return reviewers
  if (touchesOtherFiles(fix, previousBlocking)) return reviewers
  const owners = reviewersOwningEachFinding(reviewers, previousBlocking)
  return owners.length === 0 ? reviewers : owners
}

export const isInDiff = (finding: ReviewFinding, diff: Hunk[]) =>
  diff.some(hunk => finding.file !== undefined && finding.line !== undefined && samePath(hunk.file, finding.file) && finding.line >= hunk.start && finding.line <= hunk.end)

export const triageFindings = (findings: ReviewFinding[], diff: Hunk[]) => {
  const raised = findings.filter(finding => finding.blocking)
  return {
    blocking: raised.filter(finding => isInDiff(finding, diff)),
    followUps: raised.filter(finding => !isInDiff(finding, diff)),
  }
}

const locationOf = (finding: ReviewFinding) => (finding.file === undefined ? '' : `${finding.file}${finding.line === undefined ? '' : `:${finding.line}`}, `)

const followUpBox = (finding: ReviewFinding) => `- [ ] ${finding.summary} (${locationOf(finding)}raised by ${finding.reviewer ?? 'review'})\n`

export const followUpSection = (phase: string, taskId: string, followUps: ReviewFinding[]) =>
  `\n### Task ${taskId}-follow-ups: follow-ups raised while reviewing ${phase} task ${taskId}\n${followUps.map(followUpBox).join('')}`

type PhaseTaskResult = { id?: unknown; follow_ups?: unknown }

const taskFollowUps = (phase: string, task: PhaseTaskResult) => {
  if (!Array.isArray(task.follow_ups) || task.follow_ups.length === 0) return ''
  return followUpSection(phase, String(task.id), task.follow_ups as ReviewFinding[])
}

export const phaseFollowUps = (json: Record<string, unknown> | undefined) => {
  if (!Array.isArray(json?.tasks)) return ''
  const phase = typeof json.phase === 'string' ? json.phase : ''
  return (json.tasks as PhaseTaskResult[]).map(task => taskFollowUps(phase, task)).join('')
}

export type Checkpoint = { committed: boolean; sha: string; suite_green: boolean; evidence: string }

export const checkpointVerdict = (checkpoint: Checkpoint | null) => {
  if (!checkpoint) return { status: 'escalate', evidence: 'checkpoint agent returned nothing' }
  const status = checkpoint.committed && checkpoint.suite_green ? 'checkpointed' : 'escalate'
  return { status, evidence: checkpoint.evidence }
}
