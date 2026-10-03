import type { SkillRef } from './config'

export type SkillIndex = Record<string, string>
export type SkillListing = Array<[root: string, names: string[], pluginPrefix?: string]>

export const fixedSkillRoots = (projectRoot: string, pluginRoot: string, home: string) => [
  `${projectRoot}/.claude/skills`,
  `${pluginRoot}/skills`,
  `${home}/.claude/skills`,
]

export const pluginCacheDir = (home: string) => `${home}/.claude/plugins/cache`

const qualifiedName = (ref: SkillRef) => (ref.level === undefined ? ref.name : `${ref.name}:${ref.level}`)

export const indexSkills = (listing: SkillListing): SkillIndex => {
  const index: SkillIndex = {}
  for (const [root, names, pluginPrefix] of listing) {
    for (const name of names) {
      index[name] ??= `${root}/${name}/SKILL.md`
      if (pluginPrefix !== undefined) index[`${pluginPrefix}:${name}`] ??= `${root}/${name}/SKILL.md`
    }
  }
  return index
}

export const resolveSkill = (index: SkillIndex, ref: SkillRef): { ref: SkillRef; path: string } | undefined => {
  const qualified = index[qualifiedName(ref)]
  if (qualified !== undefined) return { ref: { name: qualifiedName(ref) }, path: qualified }
  const bare = index[ref.name]
  if (bare === undefined) return undefined
  return { ref, path: bare }
}
