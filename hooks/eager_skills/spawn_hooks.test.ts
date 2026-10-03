import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN_AGENT = '---\nname: implementer\nskills: [caveman:ultra, checkbox-progress, tooling:tidy]\n---\nBuild.'
const CONFIG = JSON.stringify({
  agents: { implementer: { eager_skills: ['code-style'], lanes: { ruby: { eager_skills: ['spec-conventions'] } } } },
  eager_skills_max_chars: 60000,
})

const spawnInput = (subagentType: string, prompt: string) => ({
  tool_use_id: 'use-1',
  prompt,
  description: 'build',
  subagentType,
  provider: { plugin: 'ouroboros', tier: 'user' as const },
  parentModel: 'fable',
  background: false,
  fork: false,
})

const worldBeneath = (on: On, files: Record<string, string>, dirs: Record<string, string[]>) => {
  const written = new Map<string, string>()
  const fileAt = (path: string) => [...Object.entries(files)].find(([name]) => path.endsWith(name))?.[1]
  mock.env(on, { HOME: '/home' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.cwd', () => ({ value: '/project' }))
  on('fs.exists', (_, e) => ({ value: fileAt(e.path) !== undefined || e.path in dirs }))
  on('fs.read', (_, e) => ({ value: fileAt(e.path) ?? '' }))
  on('fs.list', (_, e) => ({
    value: (dirs[e.path] ?? []).map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('fs.write', (_, e) => {
    written.set(e.path.slice(e.path.lastIndexOf('/') + 1), e.text)
    return { value: undefined }
  })
  return written
}

const DIRS = {
  '/project/.claude/skills': ['spec-conventions', 'code-style', 'checkbox-progress'],
  '/home/.claude/plugins/cache': ['market'],
  '/home/.claude/plugins/cache/market': ['caveman', 'tooling'],
  '/home/.claude/plugins/cache/market/tooling': ['2.0.0'],
  '/home/.claude/plugins/cache/market/tooling/2.0.0/skills': ['tidy'],
  '/home/.claude/plugins/cache/market/caveman': ['1.0.0'],
  '/home/.claude/plugins/cache/market/caveman/1.0.0/skills': ['caveman'],
}

const FILES = {
  'agents/implementer.md': PLUGIN_AGENT,
  '.claude/ouroboros.json': CONFIG,
  'skills/caveman/SKILL.md': '---\nname: caveman\n---\nTalk short.',
  'skills/checkbox-progress/SKILL.md': 'Tick boxes.',
  'skills/code-style/SKILL.md': 'Small functions.',
  'skills/spec-conventions/SKILL.md': 'Predicate matchers.',
  'skills/tidy/SKILL.md': 'Keep it tidy.',
}

test('an ouroboros agent starts with its merged eager skills inlined and the spawn recorded', async ($, on) => {
  const written = worldBeneath(on, FILES, DIRS)
  const prompts: string[] = []
  on('agent.spawn', (_, e) => {
    prompts.push(e.prompt)
    return { model: 'fable', agentId: 'impl-1' }
  })

  await $.session.start({ cwd: '/project', surface: null, isInteractive: true })
  const spawned = await $.agent.spawn(spawnInput('ouroboros:implementer', 'Lane ruby. Build the thing.'))

  expect(spawned.deny).toBe(undefined)
  expect(prompts[0]).toBe(
    '<eager-skills>\n<skill name="caveman">\nLevel: ultra\nTalk short.\n</skill>\n<skill name="checkbox-progress">\nTick boxes.\n</skill>\n<skill name="tooling:tidy">\nKeep it tidy.\n</skill>\n' +
      '<skill name="code-style">\nSmall functions.\n</skill>\n<skill name="spec-conventions">\nPredicate matchers.\n</skill>\n</eager-skills>\n\n' +
      'Lane ruby. Build the thing.',
  )
  const record = JSON.parse((written.get('spawns.jsonl') ?? '').trim())
  expect(record).toMatchObject({ agent: 'implementer', lane: 'ruby' })
  expect(record.skills.map((skill: { name: string }) => skill.name)).toEqual(['caveman', 'checkbox-progress', 'tooling:tidy', 'code-style', 'spec-conventions'])
  expect(record.skills[0].sha).toMatch(/^[0-9a-f]{64}$/)
})

test('a skill nobody ships refuses the spawn by name', async ($, on) => {
  worldBeneath(on, { ...FILES, 'agents/implementer.md': '---\nskills: [nowhere-skill]\n---\n' }, DIRS)
  on('agent.spawn', () => ({ model: 'fable', agentId: 'impl-1' }))

  const spawned = await $.agent.spawn(spawnInput('implementer', 'Lane ruby. Build.'))

  expect(spawned.deny).toBe('eager skill not found: nowhere-skill')
})

test('an eager block over the budget refuses the spawn with the sizes', async ($, on) => {
  const config = JSON.stringify({ eager_skills_max_chars: 20 })
  worldBeneath(on, { ...FILES, '.claude/ouroboros.json': config, 'agents/implementer.md': '---\nskills: [code-style]\n---\n' }, DIRS)
  on('agent.spawn', () => ({ model: 'fable', agentId: 'impl-1' }))

  const spawned = await $.agent.spawn(spawnInput('implementer', 'Build.'))

  expect(spawned.deny).toContain('over the 20 limit: code-style 16')
})

test('an agent the plugin does not define is left alone', async ($, on) => {
  const written = worldBeneath(on, FILES, DIRS)
  const prompts: string[] = []
  on('agent.spawn', (_, e) => {
    prompts.push(e.prompt)
    return { model: 'fable', agentId: 'x-1' }
  })

  await $.agent.spawn(spawnInput('general-purpose', 'Explore.'))

  expect(prompts).toEqual(['Explore.'])
  expect(written.size).toBe(0)
})
