export type CommandItem = { text: string; command: string; done: boolean }
export type TaskContract = {
  goal: string
  plan: string
  checklist: CommandItem[]
  completion: string[]
  stop: string
  must_not: string
  depends_on: number[]
}
export type MilestoneBody = { goal: string; brief: string; acceptance: CommandItem[] }

const TASK_SECTIONS = ['Goal', 'Plan', 'Checklist', 'Completion condition', 'Stop conditions', 'Must not', 'Depends on'] as const
const MILESTONE_SECTIONS = ['Goal', 'Brief', 'Acceptance'] as const
const SECTION_HEADING = /^## (.+)$/m
const COMMAND_ITEM = /^- \[( |x)\] (.+): `([^`]+)`$/
const COMPLETION_ITEM = /^- `([^`]+)`$/
const FILES_LINE = /^Files: .*`[^`]+`/m
const DEPENDS_ON = /^(none|#\d+(?:, #\d+)*)$/

const sectionsOf = (body: string): Map<string, string> => {
  const parts = body.split(SECTION_HEADING)
  const sections = new Map<string, string>()
  for (let index = 1; index < parts.length; index += 2) sections.set(parts[index] ?? '', (parts[index + 1] ?? '').trim())
  return sections
}

const renderSections = (sections: Array<[string, string]>) => sections.map(([name, text]) => `## ${name}\n${text}\n`).join('\n')

const linesOf = (text: string) => text.split('\n').filter(line => line.trim() !== '')

const allOrNothing = <T>(parsed: Array<T | undefined>): T[] | undefined =>
  parsed.length === 0 || parsed.some(item => item === undefined) ? undefined : (parsed as T[])

const renderCommandItems = (items: CommandItem[]) => items.map(item => `- [${item.done ? 'x' : ' '}] ${item.text}: \`${item.command}\``).join('\n')

const commandItemOf = (line: string): CommandItem | undefined => {
  const match = COMMAND_ITEM.exec(line)
  return match === null ? undefined : { text: match[2] ?? '', command: match[3] ?? '', done: match[1] === 'x' }
}

const parseCommandItems = (text: string) => allOrNothing(linesOf(text).map(commandItemOf))

const renderCompletion = (commands: string[]) => commands.map(command => `- \`${command}\``).join('\n')

const parseCompletion = (text: string) => allOrNothing(linesOf(text).map(line => COMPLETION_ITEM.exec(line)?.[1]))

export const parseDependsOn = (text: string) => {
  const match = DEPENDS_ON.exec(text.trim())
  if (match === null) return undefined
  return match[1] === 'none' ? [] : (match[1] ?? '').split(', ').map(reference => Number(reference.slice(1)))
}

const renderDependsOn = (dependsOn: number[]) => (dependsOn.length === 0 ? 'none' : dependsOn.map(number => `#${number}`).join(', '))

export const renderTaskBody = (task: TaskContract) =>
  renderSections([
    ['Goal', task.goal],
    ['Plan', task.plan],
    ['Checklist', renderCommandItems(task.checklist)],
    ['Completion condition', renderCompletion(task.completion)],
    ['Stop conditions', task.stop],
    ['Must not', task.must_not],
    ['Depends on', renderDependsOn(task.depends_on)],
  ])

const SECTION_CHECKS: Record<string, (text: string) => boolean> = {
  Plan: text => FILES_LINE.test(text),
  Checklist: text => parseCommandItems(text) !== undefined,
  'Completion condition': text => parseCompletion(text) !== undefined,
  'Depends on': text => parseDependsOn(text) !== undefined,
  Acceptance: text => parseCommandItems(text) !== undefined,
}

const isSectionValid = (name: string, text: string) => text !== '' && (SECTION_CHECKS[name]?.(text) ?? true)

const gapsOf = (body: string, names: readonly string[]) => {
  const sections = sectionsOf(body)
  return names.filter(name => !isSectionValid(name, sections.get(name) ?? ''))
}

export const contractGaps = (body: string) => gapsOf(body, TASK_SECTIONS)

export const milestoneGaps = (body: string) => gapsOf(body, MILESTONE_SECTIONS)

export const parseTaskBody = (body: string): TaskContract | undefined => {
  if (contractGaps(body).length > 0) return undefined
  const sections = sectionsOf(body)
  const section = (name: string) => sections.get(name) ?? ''
  return {
    goal: section('Goal'),
    plan: section('Plan'),
    checklist: parseCommandItems(section('Checklist')) ?? [],
    completion: parseCompletion(section('Completion condition')) ?? [],
    stop: section('Stop conditions'),
    must_not: section('Must not'),
    depends_on: parseDependsOn(section('Depends on')) ?? [],
  }
}

export const renderMilestoneBody = (milestone: MilestoneBody) =>
  renderSections([
    ['Goal', milestone.goal],
    ['Brief', milestone.brief],
    ['Acceptance', renderCommandItems(milestone.acceptance)],
  ])

export const parseMilestoneBody = (body: string): MilestoneBody | undefined => {
  if (milestoneGaps(body).length > 0) return undefined
  const sections = sectionsOf(body)
  return { goal: sections.get('Goal') ?? '', brief: sections.get('Brief') ?? '', acceptance: parseCommandItems(sections.get('Acceptance') ?? '') ?? [] }
}
