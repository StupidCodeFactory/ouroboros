import { expect, test } from 'claude-code/testing'

import { fixedSkillRoots, indexSkills, pluginCacheDir, pluginSkillRoots, resolveSkill } from './resolve'

test('fixed skill roots run project, plugin, then user', () => {
  expect(fixedSkillRoots('/project', '/plugin', '/home')).toEqual([
    '/project/.claude/skills',
    '/plugin/skills',
    '/home/.claude/skills',
  ])
  expect(pluginCacheDir('/home')).toBe('/home/.claude/plugins/cache')
})

test('the first root naming a skill wins', () => {
  const listing: Array<[string, string[]]> = [
    ['/project/.claude/skills', ['code-style', 'domain-rules']],
    ['/plugin/skills', ['code-style', 'adr-format']],
  ]
  expect(indexSkills(listing)).toEqual({
    'code-style': '/project/.claude/skills/code-style/SKILL.md',
    'domain-rules': '/project/.claude/skills/domain-rules/SKILL.md',
    'adr-format': '/plugin/skills/adr-format/SKILL.md',
  })
})

test('a root with a plugin prefix names its skills both ways', () => {
  const listing: Array<[string, string[], string?]> = [['/cache/market/tooling/1.0.0/skills', ['tidy'], 'tooling']]
  expect(indexSkills(listing)).toEqual({
    tidy: '/cache/market/tooling/1.0.0/skills/tidy/SKILL.md',
    'tooling:tidy': '/cache/market/tooling/1.0.0/skills/tidy/SKILL.md',
  })
})

test('a qualified plugin skill beats the name:level reading', () => {
  const index = { 'tooling:tidy': '/t/SKILL.md', tidy: '/t/SKILL.md', terse: '/c/SKILL.md' }
  expect(resolveSkill(index, { name: 'tooling', level: 'tidy' })).toEqual({ ref: { name: 'tooling:tidy' }, path: '/t/SKILL.md' })
  expect(resolveSkill(index, { name: 'terse', level: 'ultra' })).toEqual({ ref: { name: 'terse', level: 'ultra' }, path: '/c/SKILL.md' })
  expect(resolveSkill(index, { name: 'nowhere' })).toBe(undefined)
})

test('a plugin manifest places its skills, nested or not', () => {
  expect(pluginSkillRoots('/cache/market/tooling/1.0.0', ['./skills/engineering/tidy', './skills/engineering/lint', './skills/productivity/focus'])).toEqual([
    ['/cache/market/tooling/1.0.0/skills/engineering', ['tidy', 'lint']],
    ['/cache/market/tooling/1.0.0/skills/productivity', ['focus']],
  ])
  expect(pluginSkillRoots('/cache/market/tooling/1.0.0', undefined)).toEqual([['/cache/market/tooling/1.0.0/skills', undefined]])
})

test('a manifest naming one skills directory as a string lists that directory', () => {
  expect(pluginSkillRoots('/cache/market/tooling/1.0.0', './design/')).toEqual([['/cache/market/tooling/1.0.0/design', undefined]])
})
