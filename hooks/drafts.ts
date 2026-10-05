export type PhaseTask = { id: string; title: string; line: number; unchecked: number; lane?: string }
export type UncheckedBox = { task: string; line: number; text: string }
export type ActiveDrafts = { spec: string; plan: string }

export const STATE_PATH = '.claude/ouroboros/state.json'
export const GIT_COMMON_DIR = ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir']
const TASK_HEADING = /^### Task (\S+?):\s+(.*)$/
const PHASE_TAG = /\s*\((P\d+)(?:,\s*([\w-]+))?\)\s*$/
const UNCHECKED_BOX = /^\s*- \[ \] (.*)$/
const DROPPED_BOX = /^~~.*~~ dropped:/
const NEEDS_A_PERSON = /\(needs: [^)]+\)/

type Heading = { id: string; title: string; phase: string | undefined; lane: string | undefined; index: number }

export const checkoutRootOf = (gitCommonDirStdout: string) => {
  const commonDir = gitCommonDirStdout.trim()
  return commonDir.slice(0, commonDir.lastIndexOf('/'))
}

export const draftsPathOf = (checkoutRoot: string, draftsDir: string | undefined, relative: string) => {
  if (draftsDir === undefined) throw new Error('drafts_dir missing from .claude/ouroboros.json')
  return `${checkoutRoot}/${draftsDir}/${relative}`
}

export const activeDraftsOf = (stateJson: string | undefined): ActiveDrafts | null => {
  if (stateJson === undefined) return null
  return JSON.parse(stateJson).drafts ?? null
}

const headingAt = (line: string, index: number): Heading | undefined => {
  const match = TASK_HEADING.exec(line)
  if (!match) return undefined
  const rawTitle = match[2] as string
  const tag = PHASE_TAG.exec(rawTitle)
  return { id: match[1] as string, title: rawTitle.replace(PHASE_TAG, ''), phase: tag?.[1], lane: tag?.[2], index }
}

const headingsOf = (lines: string[]) => lines.flatMap((line, index) => headingAt(line, index) ?? [])

const duplicateIds = (headings: Heading[]) => [...new Set(headings.map(heading => heading.id).filter((id, position, ids) => ids.indexOf(id) !== position))]

export const assertUniqueTaskIds = (planText: string) => {
  const duplicates = duplicateIds(headingsOf(planText.split('\n')))
  if (duplicates.length > 0) throw new Error(`the plan has duplicate task ids: ${duplicates.join(', ')}; renumber them before running a phase`)
}

const inPhase = (headings: Heading[], phase: string) => {
  if (headings.every(heading => heading.phase === undefined)) return headings
  return headings.filter(heading => heading.phase === phase)
}

const sectionEnd = (lines: string[], start: number) => {
  const next = lines.findIndex((line, index) => index > start && TASK_HEADING.test(line))
  return next === -1 ? lines.length : next
}

const openBoxText = (line: string) => {
  const text = UNCHECKED_BOX.exec(line)?.[1]
  if (text === undefined || DROPPED_BOX.test(text) || NEEDS_A_PERSON.test(text)) return undefined
  return text
}

const openBoxesIn = (lines: string[], heading: Heading): UncheckedBox[] =>
  lines.slice(heading.index + 1, sectionEnd(lines, heading.index)).flatMap((line, offset) => {
    const text = openBoxText(line)
    return text === undefined ? [] : [{ task: heading.id, line: heading.index + offset + 2, text }]
  })

const isFollowUp = (heading: Heading) => heading.id.endsWith('-follow-ups')

export const untaggedOpenTasks = (planText: string) => {
  const lines = planText.split('\n')
  const headings = headingsOf(lines)
  if (headings.every(heading => heading.phase === undefined)) return []
  return headings.filter(heading => heading.phase === undefined && !isFollowUp(heading) && openBoxesIn(lines, heading).length > 0).map(heading => heading.id)
}

export const phaseTasks = (planText: string, phase: string): PhaseTask[] => {
  assertUniqueTaskIds(planText)
  const lines = planText.split('\n')
  return inPhase(headingsOf(lines), phase).map(heading => ({
    id: heading.id,
    title: heading.title,
    line: heading.index + 1,
    unchecked: openBoxesIn(lines, heading).length,
    ...(heading.lane === undefined ? {} : { lane: heading.lane }),
  }))
}

export const firstUncheckedBox = (planText: string, phase: string): UncheckedBox | null => {
  const lines = planText.split('\n')
  return inPhase(headingsOf(lines), phase).flatMap(heading => openBoxesIn(lines, heading))[0] ?? null
}

const phaseNumber = (phase: string) => Number(phase.slice(1))

export const planPhases = (planText: string): string[] => {
  const tagged = [...new Set(headingsOf(planText.split('\n')).flatMap(heading => heading.phase ?? []))]
  if (tagged.length === 0) return ['P0']
  return tagged.sort((left, right) => phaseNumber(left) - phaseNumber(right))
}
