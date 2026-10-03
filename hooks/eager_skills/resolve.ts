import type { SkillRef } from './config'

export type SkillIndex = Record<string, string>
export type SkillListing = Array<[root: string, names: string[], pluginPrefix?: string]>

export const fixedSkillRoots = (projectRoot: string, pluginRoot: string, home: string) => [
  `${projectRoot}/.claude/skills`,
  `${pluginRoot}/skills`,
  `${home}/.claude/skills`,
]

export const pluginCacheDir = (home: string) => `${home}/.claude/plugins/cache`

export type PluginSkillRoot = [root: string, names: string[] | undefined]

const dirName = (path: string) => path.slice(0, path.lastIndexOf('/'))

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

const withoutDotSlash = (path: string) => path.replace(/^\.\//, '')

export const pluginSkillRoots = (versionDir: string, manifestSkills: string | string[] | undefined): PluginSkillRoot[] => {
  if (manifestSkills === undefined) return [[`${versionDir}/skills`, undefined]]
  if (typeof manifestSkills === 'string') return [[`${versionDir}/${withoutDotSlash(manifestSkills).replace(/\/$/, '')}`, undefined]]
  const byRoot = new Map<string, string[]>()
  for (const entry of manifestSkills) {
    const root = `${versionDir}/${dirName(withoutDotSlash(entry))}`
    byRoot.set(root, [...(byRoot.get(root) ?? []), baseName(entry)])
  }
  return [...byRoot]
}

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
