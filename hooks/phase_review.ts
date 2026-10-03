export type Hunk = { file: string; start: number; end: number }
export type Reviewer = { agent: string; stage: string }
export type ReviewFinding = { reviewer?: string; task?: string; file?: string; line?: number; summary: string; blocking: boolean }
export type TaskDiffs = Record<string, Hunk[]>
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

export const ownerTask = (finding: ReviewFinding, diffs: TaskDiffs) => {
  if (finding.task !== undefined && diffs[finding.task] !== undefined) return finding.task
  return Object.keys(diffs).find(id => isInDiff(finding, diffs[id] ?? []))
}

export const withOwner = (finding: ReviewFinding, diffs: TaskDiffs) => {
  const task = ownerTask(finding, diffs)
  return task === undefined ? finding : { ...finding, task }
}

export const isInOwnDiff = (finding: ReviewFinding, diffs: TaskDiffs) => finding.task !== undefined && isInDiff(finding, diffs[finding.task] ?? [])

export const triagePhaseFindings = (findings: ReviewFinding[], diffs: TaskDiffs) => {
  const raised = findings.filter(finding => finding.blocking).map(finding => withOwner(finding, diffs))
  return {
    blocking: raised.filter(finding => isInOwnDiff(finding, diffs)),
    followUps: raised.filter(finding => !isInOwnDiff(finding, diffs)),
  }
}

const locationOf = (finding: ReviewFinding) => (finding.file === undefined ? '' : `${finding.file}${finding.line === undefined ? '' : `:${finding.line}`}, `)

const followUpBox = (finding: ReviewFinding) => `- [ ] ${finding.summary} (${locationOf(finding)}raised by ${finding.reviewer ?? 'review'})\n`

export const followUpSection = (phase: string, taskId: string, followUps: ReviewFinding[]) =>
  `\n### Task ${taskId}-follow-ups: follow-ups raised while reviewing ${phase} task ${taskId}\n${followUps.map(followUpBox).join('')}`

const groupedByTask = (followUps: ReviewFinding[], phase: string) => {
  const groups = new Map<string, ReviewFinding[]>()
  for (const finding of followUps) groups.set(finding.task ?? phase, [...(groups.get(finding.task ?? phase) ?? []), finding])
  return [...groups]
}

export const phaseFollowUps = (json: Record<string, unknown> | undefined) => {
  if (!Array.isArray(json?.follow_ups) || json.follow_ups.length === 0) return ''
  const phase = typeof json.phase === 'string' ? json.phase : ''
  return groupedByTask(json.follow_ups as ReviewFinding[], phase).map(([taskId, findings]) => followUpSection(phase, taskId, findings)).join('')
}

export type Checkpoint = { committed: boolean; sha: string; suite_green: boolean; evidence: string }

export const checkpointVerdict = (checkpoint: Checkpoint | null) => {
  if (!checkpoint) return { status: 'escalate', evidence: 'checkpoint agent returned nothing' }
  const status = checkpoint.committed && checkpoint.suite_green ? 'checkpointed' : 'escalate'
  return { status, evidence: checkpoint.evidence }
}

export type PlannedTask = { id: string; title: string; touches?: string[] }
export type Merge = { merged: string[]; conflicted: string[] }

export const overlaps = (left: PlannedTask, right: PlannedTask) => {
  if (left.touches === undefined || right.touches === undefined) return true
  return left.touches.some(file => (right.touches ?? []).some(other => samePath(file, other)))
}

export const waveIndexes = (tasks: PlannedTask[]) => {
  const indexes: number[] = []
  tasks.forEach((task, position) => {
    const after = tasks.slice(0, position).map((earlier, earlierPosition) => (overlaps(earlier, task) ? (indexes[earlierPosition] ?? 0) + 1 : 0))
    indexes.push(Math.max(0, ...after))
  })
  return indexes
}

export const taskWaves = <T extends PlannedTask>(tasks: T[]): T[][] => {
  const indexes = waveIndexes(tasks)
  const waveCount = Math.max(0, ...indexes.map(index => index + 1))
  return Array.from({ length: waveCount }, (_, wave) => tasks.filter((_, position) => indexes[position] === wave))
}

export const tasksToRetry = <E extends { task: { id: string }; changed: boolean }>(entries: E[], merge: Merge | null): E[] =>
  entries.filter(entry => entry.changed && !(merge?.merged ?? []).includes(entry.task.id))

export const distinctFindings = (findings: ReviewFinding[]) => findings.filter((finding, position) => !isCoveredBy(finding, findings.slice(0, position)))

export type PhaseMerge = { pr_url: string; merged: boolean; failing_gate: string }

export const mergeVerdict = (merge: PhaseMerge | null) => {
  if (!merge) return { status: 'escalate', failing_gate: 'phase PR merge returned nothing' }
  if (merge.merged) return { status: 'checkpointed', failing_gate: '' }
  return { status: 'escalate', failing_gate: merge.failing_gate || 'phase PR not merged' }
}
