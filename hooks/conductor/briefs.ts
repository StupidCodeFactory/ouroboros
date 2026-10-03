export type TaskSlice = { id: string; guidance: string; touches: string[] }
export type BriefSlices = { common: string; tasks: TaskSlice[] }

const isSliced = (brief: unknown): brief is BriefSlices =>
  brief !== null && typeof brief === 'object' && typeof (brief as BriefSlices).common === 'string' && Array.isArray((brief as BriefSlices).tasks)

export const briefSlicesOf = (json: Record<string, unknown> | undefined) => (isSliced(json?.brief) ? json.brief : undefined)

const touchesText = (touches: string[]) => (touches.length === 0 ? '' : `\nTouches:\n${touches.map(file => `- ${file}\n`).join('')}`)

export const briefFiles = (slices: BriefSlices) => [
  { name: 'common.md', text: `${slices.common}\n` },
  ...slices.tasks.map(task => ({ name: `${task.id}.md`, text: `${task.guidance}\n${touchesText(task.touches)}` })),
]

export const touchesByTask = (slices: BriefSlices): Record<string, string[]> => Object.fromEntries(slices.tasks.map(task => [task.id, task.touches]))
