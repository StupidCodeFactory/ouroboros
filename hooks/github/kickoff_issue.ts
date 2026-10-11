import type { CommandItem, MilestoneBody } from './contract'
import type { PlannedTask } from './kickoff_plan'

export type AppliedKickoff = { created: number[]; updated: number[]; dropped: number[]; unchanged: number[]; closed: number[] }
type ProjectItem = { title: string; status?: { name: string } }
type CommandSpec = { text: string; command: string }
type ArchitectTask = Omit<PlannedTask, 'checklist'> & { checklist: CommandSpec[] }
type ArchitectJson = { milestone?: { goal: string; brief: string; acceptance: CommandSpec[] }; tasks?: ArchitectTask[] }

const ISSUE_ARGUMENT = /^(?:#|.*\/issues\/)?(\d+)$/
const HEADING = /^(#{1,6})\s+(.+?)\s*$/

export const kickoffIssueNumber = (argument: string) => {
  const match = ISSUE_ARGUMENT.exec(argument.trim())
  return match === null ? undefined : Number(match[1])
}

const headingOf = (line: string) => {
  const match = HEADING.exec(line)
  return match === null ? undefined : { level: (match[1] ?? '').length, text: match[2] ?? '' }
}

export const prdSection = (prd: string, title: string): { section: string } | { headings: string[] } => {
  const lines = prd.split('\n')
  const start = lines.findIndex(line => headingOf(line)?.text === title)
  if (start === -1) return { headings: lines.flatMap(line => headingOf(line)?.text ?? []) }
  const level = headingOf(lines[start] ?? '')?.level ?? 1
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => (headingOf(line)?.level ?? Infinity) <= level)
  return { section: (end === -1 ? rest : rest.slice(0, end)).join('\n').trim() }
}

export const milestoneColumn = (projectItems: ProjectItem[], project: string) => projectItems.find(item => item.title === project)?.status?.name

const unticked = (items: CommandSpec[]): CommandItem[] => items.map(({ text, command }) => ({ text, command, done: false }))

export const architectResult = (json: unknown): { milestone: MilestoneBody; tasks: PlannedTask[] } | { error: string } => {
  const result = json as ArchitectJson | undefined
  if (result?.milestone === undefined || !Array.isArray(result.tasks)) return { error: 'the architect returned no milestone body and task list' }
  return {
    milestone: { goal: result.milestone.goal, brief: result.milestone.brief, acceptance: unticked(result.milestone.acceptance) },
    tasks: result.tasks.map(task => ({ ...task, checklist: unticked(task.checklist) })),
  }
}

const plannedEntry = (task: PlannedTask) => (task.issue === undefined ? { title: task.title } : { issue: task.issue, title: task.title })

export const kickoffRecord = (startedAt: number, tasks: PlannedTask[]) => ({ started_at: new Date(startedAt).toISOString(), planned: tasks.map(plannedEntry) })

const numbersText = (numbers: number[]) => (numbers.length === 0 ? 'none' : numbers.map(number => `#${number}`).join(', '))

export const kickoffAnswer = (milestone: number, applied: AppliedKickoff) =>
  `kickoff #${milestone}: created ${numbersText(applied.created)}; updated ${numbersText(applied.updated)}; dropped ${numbersText(applied.dropped)}; unchanged ${numbersText(applied.unchanged)}; left closed ${numbersText(applied.closed)}`
