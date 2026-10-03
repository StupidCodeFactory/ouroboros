export type Hunk = { file: string; start: number; end: number }
export type Reviewer = { agent: string; stage: string }
export type ReviewFinding = { reviewer?: string; file?: string; line?: number; summary: string; blocking: boolean }
export type Implemented = { changed?: boolean; commits?: string[]; hunks?: Hunk[]; evidence?: string }

export const needsReview = (implemented: Implemented | undefined) => implemented?.changed !== false

const samePath = (left: string, right: string) => left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)

const sameSpot = (left: ReviewFinding, right: ReviewFinding) =>
  left.file !== undefined && right.file !== undefined && samePath(left.file, right.file) && left.line === right.line

const isCoveredBy = (finding: ReviewFinding, kept: ReviewFinding[]) => kept.some(keptFinding => sameSpot(finding, keptFinding))

const reviewersOwningEachFinding = <R extends Reviewer>(reviewers: R[], blocking: ReviewFinding[]) => {
  const kept: ReviewFinding[] = []
  return reviewers.filter(reviewer => {
    const fresh = blocking.filter(finding => finding.reviewer === reviewer.agent && !isCoveredBy(finding, kept))
    kept.push(...fresh)
    return fresh.length > 0
  })
}

const touchesOtherFiles = (fix: Hunk[], blocking: ReviewFinding[]) =>
  fix.some(hunk => !blocking.some(finding => finding.file !== undefined && samePath(hunk.file, finding.file)))

export const reviewersForRound = <R extends Reviewer>(round: number, maxRounds: number, reviewers: R[], previousBlocking: ReviewFinding[], fix: Hunk[]): R[] => {
  if (round === 1 || round === maxRounds || previousBlocking.length === 0) return reviewers
  if (touchesOtherFiles(fix, previousBlocking)) return reviewers
  const owners = reviewersOwningEachFinding(reviewers, previousBlocking)
  return owners.length === 0 ? reviewers : owners
}
