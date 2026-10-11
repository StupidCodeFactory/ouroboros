import { contractGaps, renderTaskBody } from './contract'
import type { TaskContract } from './contract'

export type Dependency = { issue: number } | { task: number }
export type PlannedTask = Omit<TaskContract, 'depends_on'> & { title: string; issue?: number; depends_on: Dependency[] }
export type SubIssue = { number: number; state: 'open' | 'closed'; title: string; body: string }
export type KickoffChanges = { create: number[]; update: number[]; drop: number[]; unchanged: number[]; closed: number[] }

const MAX_SUB_ISSUES = 100
const UNRESOLVED = 0

const phaseNumber = (phase: string) => Number(phase.slice(1))

const positionOf = (index: number) => index + 1

export const plannedBody = (task: PlannedTask, issueOfTask: (position: number) => number) =>
  renderTaskBody({ ...task, depends_on: task.depends_on.map(dependency => ('issue' in dependency ? dependency.issue : issueOfTask(dependency.task))) })

const sizeProblem = (tasks: PlannedTask[]) =>
  tasks.length > MAX_SUB_ISSUES ? `${tasks.length} tasks: a milestone holds at most ${MAX_SUB_ISSUES} sub-issues; split the milestone` : undefined

const revisionProblem = (task: PlannedTask, position: number, existing: SubIssue[]) => {
  if (task.issue === undefined) return undefined
  const revised = existing.find(subIssue => subIssue.number === task.issue)
  if (revised === undefined) return `task ${position} revises #${task.issue}, which is not a sub-issue of this milestone`
  if (revised.state === 'closed') return `task ${position} revises #${task.issue}, which is closed`
  return undefined
}

const duplicateProblem = (tasks: PlannedTask[]) => {
  for (const [index, task] of tasks.entries()) {
    const earlier = tasks.findIndex(other => other.issue !== undefined && other.issue === task.issue)
    if (earlier < index && earlier !== -1) return `tasks ${positionOf(earlier)} and ${positionOf(index)} both revise #${task.issue}`
  }
  return undefined
}

const gapProblem = (task: PlannedTask, position: number) => {
  const gaps = contractGaps(plannedBody(task, () => UNRESOLVED))
  return gaps.length === 0 ? undefined : `task ${position} "${task.title}" misses ${gaps.join(', ')}`
}

const taskDependencyProblem = (task: PlannedTask, position: number, target: number, tasks: PlannedTask[]) => {
  if (target === position) return `task ${position} depends on itself`
  const dependency = tasks[target - 1]
  if (dependency === undefined) return `task ${position} depends on task ${target}, which the list does not hold`
  if (phaseNumber(dependency.phase) > phaseNumber(task.phase)) return `task ${position} (${task.phase}) depends on task ${target} in a later phase (${dependency.phase})`
  return undefined
}

const issueDependencyProblem = (task: PlannedTask, position: number, target: number, tasks: PlannedTask[], existing: SubIssue[]) => {
  const subIssue = existing.find(candidate => candidate.number === target)
  if (subIssue === undefined) return `task ${position} depends on #${target}, which is not a sub-issue of this milestone`
  if (subIssue.state === 'closed') return undefined
  const revising = tasks.findIndex(candidate => candidate.issue === target)
  if (revising === -1) return `task ${position} depends on #${target}, which kickoff drops`
  return taskDependencyProblem(task, position, positionOf(revising), tasks)
}

const dependencyProblem = (task: PlannedTask, position: number, tasks: PlannedTask[], existing: SubIssue[]) => {
  for (const dependency of task.depends_on) {
    const problem =
      'issue' in dependency
        ? issueDependencyProblem(task, position, dependency.issue, tasks, existing)
        : taskDependencyProblem(task, position, dependency.task, tasks)
    if (problem !== undefined) return problem
  }
  return undefined
}

const taskProblem = (task: PlannedTask, position: number, tasks: PlannedTask[], existing: SubIssue[]) =>
  revisionProblem(task, position, existing) ?? gapProblem(task, position) ?? dependencyProblem(task, position, tasks, existing)

const listProblem = (tasks: PlannedTask[], existing: SubIssue[]) => {
  const problem = sizeProblem(tasks) ?? duplicateProblem(tasks)
  if (problem !== undefined) return problem
  for (const [index, task] of tasks.entries()) {
    const found = taskProblem(task, positionOf(index), tasks, existing)
    if (found !== undefined) return found
  }
  return undefined
}

const dependsOnNewTask = (task: PlannedTask) => task.depends_on.some(dependency => 'task' in dependency)

const isUnchanged = (task: PlannedTask, subIssue: SubIssue) =>
  !dependsOnNewTask(task) && task.title === subIssue.title && plannedBody(task, () => UNRESOLVED) === subIssue.body

const numbersOf = (subIssues: SubIssue[]) => subIssues.map(subIssue => subIssue.number)

const revisedOpen = (tasks: PlannedTask[], existing: SubIssue[]) =>
  existing.filter(subIssue => subIssue.state === 'open' && tasks.some(task => task.issue === subIssue.number))

const changesOf = (tasks: PlannedTask[], existing: SubIssue[]): KickoffChanges => {
  const revised = revisedOpen(tasks, existing)
  const unchanged = revised.filter(subIssue => isUnchanged(tasks.find(task => task.issue === subIssue.number) as PlannedTask, subIssue))
  return {
    create: tasks.flatMap((task, index) => (task.issue === undefined ? [positionOf(index)] : [])),
    update: numbersOf(revised.filter(subIssue => !unchanged.includes(subIssue))),
    drop: numbersOf(existing.filter(subIssue => subIssue.state === 'open' && !revised.includes(subIssue))),
    unchanged: numbersOf(unchanged),
    closed: numbersOf(existing.filter(subIssue => subIssue.state === 'closed')),
  }
}

export const kickoffChanges = (existing: SubIssue[], tasks: PlannedTask[]): KickoffChanges | { rejected: string } => {
  const problem = listProblem(tasks, existing)
  return problem === undefined ? changesOf(tasks, existing) : { rejected: problem }
}
