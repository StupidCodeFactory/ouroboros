import type { ActiveDrafts } from './drafts'

export type DraftFile = { path: string; text: string }
export type Discovery = { drafts: ActiveDrafts } | { error: string }
export type KickoffArgs = { milestone?: string; spec?: string; plan?: string; goal: string }

const TASK_HEADING = /^### Task \S+?:/m
const CHECKBOX = /^\s*- \[[ x]\] /m
const SPEC_LINE = /^\**Spec:?\**:?\s*`?([^`\s]+\.md)`?/im
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/
const ROLE_SUFFIX = /-(design|spec|plan)$/

const isMarkdown = (word: string | undefined) => word?.endsWith('.md') === true

export const kickoffArgs = (args: string): KickoffArgs => {
  const [milestone, second, third, ...rest] = args.split(/\s+/).filter(Boolean)
  if (milestone === undefined) return { goal: '' }
  if (isMarkdown(second) && isMarkdown(third)) return { milestone, spec: second, plan: third, goal: rest.join(' ') }
  return { milestone, goal: [second, third, ...rest].filter(Boolean).join(' ') }
}

const isPlan = (file: DraftFile) => TASK_HEADING.test(file.text) && CHECKBOX.test(file.text)

const namesMilestone = (file: DraftFile, milestone: string) => new RegExp(`\\b${milestone}\\b`).test(file.text)

const slugOf = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/, '').replace(DATE_PREFIX, '').replace(ROLE_SUFFIX, '')

const choosePlan = (plans: DraftFile[], milestone: string) => plans.find(file => namesMilestone(file, milestone)) ?? plans[0]

const specFromLine = (plan: DraftFile, others: DraftFile[], draftsDir: string) => {
  const reference = SPEC_LINE.exec(plan.text)?.[1]
  if (reference === undefined) return undefined
  const relative = reference.startsWith(`${draftsDir}/`) ? reference.slice(draftsDir.length + 1) : reference
  return others.find(file => file.path === relative || relative.endsWith(`/${file.path}`) || file.path.endsWith(`/${relative}`))
}

const specBySlug = (plan: DraftFile, others: DraftFile[]) => others.find(file => slugOf(file.path) === slugOf(plan.path))

export const discoverDrafts = (files: DraftFile[], milestone: string, draftsDir: string): Discovery => {
  const plans = files.filter(isPlan)
  const plan = choosePlan(plans, milestone)
  if (plan === undefined) return { error: `no plan with task checkboxes under ${draftsDir}; pass /ouroboros kickoff ${milestone} <spec> <plan>` }
  const others = files.filter(file => !isPlan(file))
  const spec = specFromLine(plan, others, draftsDir) ?? specBySlug(plan, others)
  if (spec === undefined) return { error: `found plan ${plan.path} but no spec (no Spec: line, no file sharing its name); pass /ouroboros kickoff ${milestone} <spec> ${plan.path}` }
  return { drafts: { plan: plan.path, spec: spec.path } }
}
