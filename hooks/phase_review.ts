export type Hunk = { file: string; start: number; end: number }
export type Implemented = { changed?: boolean; commits?: string[]; hunks?: Hunk[]; evidence?: string }

export const needsReview = (implemented: Implemented | undefined) => implemented?.changed !== false
