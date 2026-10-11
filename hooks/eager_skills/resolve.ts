import type { SkillRef } from './config'

export type SkillIndex = Record<string, string>
export type SkillListing = Array<[root: string, names: string[], pluginPrefix?: string, frontmatterNames?: Record<string, string>]>

export const fixedSkillRoots = (projectRoot: string, pluginRoot: string, home: string) => [
  `${projectRoot}/.claude/skills`,
  `${pluginRoot}/skills`,
  `${home}/.claude/skills`,
]

export const pluginCacheDir = (home: string) => `${home}/.claude/plugins/cache`

export const syncedPluginsDir = (home: string) => `${home}/.claude/plugins/synced`

export const syncedPluginName = (folder: string, manifestName: string | undefined) => manifestName ?? folder.replace(/~.*$/, '')

const FRONTMATTER = /^---\n([\s\S]*?)\n---/
const NAME_LINE = /^name:\s*(.+?)\s*$/m

export const frontmatterName = (text: string) => {
  const frontmatter = FRONTMATTER.exec(text)?.[1]
  return frontmatter === undefined ? undefined : NAME_LINE.exec(frontmatter)?.[1]
}

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
  for (const [root, names, pluginPrefix, frontmatterNames] of listing) {
    for (const name of names) {
      const path = `${root}/${name}/SKILL.md`
      for (const key of [name, frontmatterNames?.[name]].filter((key): key is string => key !== undefined)) {
        index[key] ??= path
        if (pluginPrefix !== undefined) index[`${pluginPrefix}:${key}`] ??= path
      }
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
