export type Hunk = { file: string; start: number; end: number }
export type Reviewer = { agent: string; stage: string }
export type ReviewFinding = { reviewer?: string; task?: string; file?: string; line?: number; summary: string; blocking: boolean; source?: 'suite' }
export type TaskDiffs = Record<string, Hunk[]>
export type Implemented = { changed?: boolean; commits?: string[]; hunks?: Hunk[]; evidence?: string; blocked?: boolean }

export const needsReview = (implemented: Implemented | undefined) => implemented?.changed !== false

export const BLOCKED_WORD = /\bBLOCKED\b|\bBLOCKER\b|^\s*Block(?:ed|er)\b/m

export const isBlocked = (implemented: Implemented | null | undefined) =>
  implemented === null || implemented === undefined || implemented.blocked === true || BLOCKED_WORD.test(implemented.evidence ?? '')

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

export const isOwnSuiteFailure = (finding: ReviewFinding, diffs: TaskDiffs) => finding.source === 'suite' && finding.task !== undefined && diffs[finding.task] !== undefined

export const blocksItsTask = (finding: ReviewFinding, diffs: TaskDiffs) => isInOwnDiff(finding, diffs) || isOwnSuiteFailure(finding, diffs)

export const triagePhaseFindings = (findings: ReviewFinding[], diffs: TaskDiffs) => {
  const raised = findings.filter(finding => finding.blocking).map(finding => withOwner(finding, diffs))
  return {
    blocking: raised.filter(finding => blocksItsTask(finding, diffs)),
    followUps: raised.filter(finding => !blocksItsTask(finding, diffs)),
  }
}

const locationOf = (finding: ReviewFinding) => (finding.file === undefined ? '' : `${finding.file}${finding.line === undefined ? '' : `:${finding.line}`}, `)

const followUpBox = (finding: ReviewFinding) => `- [ ] ${finding.summary} (${locationOf(finding)}raised by ${finding.reviewer ?? 'review'})\n`

const phaseTag = (nextPhase: string | undefined) => (nextPhase === undefined ? '' : ` (${nextPhase})`)

export const followUpSection = (phase: string, taskId: string, followUps: ReviewFinding[], nextPhase: string | undefined) =>
  `\n### Task ${taskId}-${phase}-follow-ups: follow-ups raised while reviewing ${phase} task ${taskId}${phaseTag(nextPhase)}\n${followUps.map(followUpBox).join('')}`

const groupedByTask = (followUps: ReviewFinding[], phase: string) => {
  const groups = new Map<string, ReviewFinding[]>()
  for (const finding of followUps) groups.set(finding.task ?? phase, [...(groups.get(finding.task ?? phase) ?? []), finding])
  return [...groups]
}

export const phaseFollowUps = (json: Record<string, unknown> | undefined, nextPhase: string | undefined) => {
  if (!Array.isArray(json?.follow_ups) || json.follow_ups.length === 0) return ''
  const phase = typeof json.phase === 'string' ? json.phase : ''
  return groupedByTask(json.follow_ups as ReviewFinding[], phase).map(([taskId, findings]) => followUpSection(phase, taskId, findings, nextPhase)).join('')
}

export type Checkpoint = { committed: boolean; sha: string; suite_green: boolean; evidence: string }

export const checkpointVerdict = (checkpoint: Checkpoint | null) => {
  if (!checkpoint) return { status: 'escalate', evidence: 'checkpoint agent returned nothing' }
  const status = checkpoint.committed && checkpoint.suite_green ? 'checkpointed' : 'escalate'
  return { status, evidence: checkpoint.evidence }
}

export type CheckpointFailure = { file: string; line?: number; summary: string; task?: string }

export const ownerByFile = (file: string, diffs: TaskDiffs) => Object.keys(diffs).find(id => (diffs[id] ?? []).some(hunk => samePath(hunk.file, file)))

export const checkpointRepairs = (checkpoint: (Checkpoint & { failures?: CheckpointFailure[] }) | null, diffs: TaskDiffs) => {
  if (!checkpoint || (checkpoint.committed && checkpoint.suite_green)) return []
  return (checkpoint.failures ?? []).flatMap(failure => {
    const task = failure.task !== undefined && diffs[failure.task] !== undefined ? failure.task : ownerByFile(failure.file, diffs)
    return task === undefined ? [] : [{ ...failure, task, reviewer: 'checkpoint', source: 'suite' as const, root_cause: 'code-bug', blocking: true }]
  })
}

export type PlannedTask = { id: string; title: string; touches?: string[] }
export type Merge = { merged: string[]; conflicted: string[] }

export const staticPrefix = (path: string) => path.split('*')[0] ?? path

export const pathsOverlap = (left: string, right: string) => {
  if (!left.includes('*') && !right.includes('*')) return samePath(left, right)
  const leftPrefix = staticPrefix(left)
  const rightPrefix = staticPrefix(right)
  return leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix)
}

export const overlaps = (left: PlannedTask, right: PlannedTask) => {
  if (left.touches === undefined || right.touches === undefined) return true
  return left.touches.some(file => (right.touches ?? []).some(other => pathsOverlap(file, other)))
}

export const touchesNothing = (task: PlannedTask) => task.touches !== undefined && task.touches.length === 0

export const isCheckpointTask = (task: PlannedTask) => /^\s*(?:P\d+\s+checkpoint|checkpoint\s+P\d+)\b/i.test(task.title)

export const inPlanOrderOf = <T>(tasks: T[], members: T[]) => [...members].sort((left, right) => tasks.indexOf(left) - tasks.indexOf(right))

export const overlapGroups = <T extends PlannedTask>(tasks: T[]): T[][] => {
  let groups: T[][] = []
  for (const task of tasks) {
    const joined = groups.filter(group => group.some(member => overlaps(member, task)))
    groups = [...groups.filter(group => !joined.includes(group)), inPlanOrderOf(tasks, [...joined.flat(), task])]
  }
  return groups.sort((left, right) => tasks.indexOf(left[0] as T) - tasks.indexOf(right[0] as T))
}

export const segmentsOf = <T>(chain: T[], perImplementer: number) =>
  Array.from({ length: Math.ceil(chain.length / perImplementer) }, (_, index) => chain.slice(index * perImplementer, (index + 1) * perImplementer))

export const implementerChains = <T extends PlannedTask>(tasks: T[], slots: number, perImplementer: number) => {
  const chains: T[][] = Array.from({ length: Math.max(1, slots) }, () => [])
  for (const group of overlapGroups(tasks.filter(task => !touchesNothing(task)))) {
    const lightest = chains.reduce((best, chain) => (chain.length < best.length ? chain : best))
    lightest.push(...group)
  }
  return {
    chains: chains.filter(chain => chain.length > 0).map(chain => segmentsOf(inPlanOrderOf(tasks, chain), Math.max(1, perImplementer))),
    finale: tasks.filter(touchesNothing),
  }
}

export const tasksToRetry = <E extends { task: { id: string }; changed: boolean }>(entries: E[], merge: Merge | null): E[] =>
  entries.filter(entry => entry.changed && !(merge?.merged ?? []).includes(entry.task.id))

export const distinctFindings = (findings: ReviewFinding[]) => findings.filter((finding, position) => !isCoveredBy(finding, findings.slice(0, position)))

export type Authored = { task: { id: string }; handoff?: string }

export const fixRequests = <E extends Authored>(entries: E[], blocking: ReviewFinding[]) =>
  entries.flatMap(entry => {
    const findings = distinctFindings(blocking.filter(finding => finding.task === entry.task.id))
    return findings.length === 0 ? [] : [{ entry, findings, handoff: entry.handoff ?? '' }]
  })
