import type { SkillRef } from './config'

export { stripFrontmatter } from '../skill_text'

export type InlinedSkill = { ref: SkillRef; body: string }

const levelLine = (ref: SkillRef) => (ref.level === undefined ? '' : `Level: ${ref.level}\n`)

const skillTag = ({ ref, body }: InlinedSkill) => `<skill name="${ref.name}">\n${levelLine(ref)}${body}\n</skill>`

export const eagerBlock = (skills: InlinedSkill[]) => `<eager-skills>\n${skills.map(skillTag).join('\n')}\n</eager-skills>\n\n`

export const checkBudget = (block: string, maxChars: number, sizes: Record<string, number>): { ok: true } | { ok: false; reason: string } => {
  if (block.length <= maxChars) return { ok: true }
  const breakdown = Object.entries(sizes).map(([name, size]) => `${name} ${size}`).join(', ')
  return { ok: false, reason: `eager skills block is ${block.length} chars, over the ${maxChars} limit: ${breakdown}` }
}
