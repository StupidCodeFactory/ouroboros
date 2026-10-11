export type ChecklistItem = { text: string; done: boolean }
export type TaskContract = {
  goal: string
  plan: string
  checklist: ChecklistItem[]
  completion: string
  stop: string
  must_not: string
  phase: string
  depends_on: number[]
}
export type AcceptanceItem = ChecklistItem & { command: string }
export type MilestoneBody = { goal: string; brief: string; acceptance: AcceptanceItem[] }

const TASK_SECTIONS = ['Goal', 'Plan', 'Checklist', 'Completion condition', 'Stop conditions', 'Must not', 'Phase'] as const
const MILESTONE_SECTIONS = ['Goal', 'Brief', 'Acceptance'] as const
const SECTION_HEADING = /^## (.+)$/m
const CHECKLIST_ITEM = /^- \[( |x)\] (.+)$/
const ACCEPTANCE_TEXT = /^(.+): `([^`]+)`$/
const PHASE_SECTION = /^(P\d+)\nDepends on: (none|#\d+(?:, #\d+)*)$/

const sectionsOf = (body: string): Map<string, string> => {
  const parts = body.split(SECTION_HEADING)
  const sections = new Map<string, string>()
  for (let index = 1; index < parts.length; index += 2) sections.set(parts[index] ?? '', (parts[index + 1] ?? '').trim())
  return sections
}

const renderSections = (sections: Array<[string, string]>) => sections.map(([name, text]) => `## ${name}\n${text}\n`).join('\n')

const checkbox = (item: ChecklistItem) => `- [${item.done ? 'x' : ' '}] `

const renderChecklist = (items: ChecklistItem[]) => items.map(item => `${checkbox(item)}${item.text}`).join('\n')

const parseChecklist = (text: string): ChecklistItem[] | undefined => {
  const lines = text.split('\n').filter(line => line.trim() !== '')
  const items = lines.map(line => CHECKLIST_ITEM.exec(line))
  if (items.length === 0 || items.some(match => match === null)) return undefined
  return items.map(match => ({ done: match?.[1] === 'x', text: match?.[2] ?? '' }))
}

const dependencyText = (dependsOn: number[]) => (dependsOn.length === 0 ? 'none' : dependsOn.map(number => `#${number}`).join(', '))

const dependencyNumbers = (text: string) => (text === 'none' ? [] : text.split(', ').map(reference => Number(reference.slice(1))))

export const parsePhase = (text: string) => {
  const match = PHASE_SECTION.exec(text.trim())
  if (match === null) return undefined
  return { phase: match[1] ?? '', depends_on: dependencyNumbers(match[2] ?? '') }
}

export const renderTaskBody = (task: TaskContract) =>
  renderSections([
    ['Goal', task.goal],
    ['Plan', task.plan],
    ['Checklist', renderChecklist(task.checklist)],
    ['Completion condition', task.completion],
    ['Stop conditions', task.stop],
    ['Must not', task.must_not],
    ['Phase', `${task.phase}\nDepends on: ${dependencyText(task.depends_on)}`],
  ])

const isTaskSectionValid = (name: string, text: string) => {
  if (text === '') return false
  if (name === 'Checklist') return parseChecklist(text) !== undefined
  if (name === 'Phase') return parsePhase(text) !== undefined
  return true
}

export const contractGaps = (body: string) => {
  const sections = sectionsOf(body)
  return TASK_SECTIONS.filter(name => !isTaskSectionValid(name, sections.get(name) ?? ''))
}

export const parseTaskBody = (body: string): TaskContract | undefined => {
  if (contractGaps(body).length > 0) return undefined
  const section = (name: string) => sectionsOf(body).get(name) ?? ''
  const phase = parsePhase(section('Phase'))
  return {
    goal: section('Goal'),
    plan: section('Plan'),
    checklist: parseChecklist(section('Checklist')) ?? [],
    completion: section('Completion condition'),
    stop: section('Stop conditions'),
    must_not: section('Must not'),
    phase: phase?.phase ?? '',
    depends_on: phase?.depends_on ?? [],
  }
}

const renderAcceptance = (items: AcceptanceItem[]) => renderChecklist(items.map(item => ({ done: item.done, text: `${item.text}: \`${item.command}\`` })))

const acceptanceItemOf = (item: ChecklistItem): AcceptanceItem | undefined => {
  const match = ACCEPTANCE_TEXT.exec(item.text)
  if (match === null) return undefined
  return { text: match[1] ?? '', command: match[2] ?? '', done: item.done }
}

const parseAcceptance = (text: string): AcceptanceItem[] | undefined => {
  const items = (parseChecklist(text) ?? []).map(acceptanceItemOf)
  if (items.length === 0 || items.some(item => item === undefined)) return undefined
  return items.filter((item): item is AcceptanceItem => item !== undefined)
}

export const renderMilestoneBody = (milestone: MilestoneBody) =>
  renderSections([
    ['Goal', milestone.goal],
    ['Brief', milestone.brief],
    ['Acceptance', renderAcceptance(milestone.acceptance)],
  ])

const isMilestoneSectionValid = (name: string, text: string) => text !== '' && (name !== 'Acceptance' || parseAcceptance(text) !== undefined)

export const milestoneGaps = (body: string) => {
  const sections = sectionsOf(body)
  return MILESTONE_SECTIONS.filter(name => !isMilestoneSectionValid(name, sections.get(name) ?? ''))
}

export const parseMilestoneBody = (body: string): MilestoneBody | undefined => {
  if (milestoneGaps(body).length > 0) return undefined
  const sections = sectionsOf(body)
  return { goal: sections.get('Goal') ?? '', brief: sections.get('Brief') ?? '', acceptance: parseAcceptance(sections.get('Acceptance') ?? '') ?? [] }
}
