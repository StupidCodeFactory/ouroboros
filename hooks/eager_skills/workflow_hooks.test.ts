import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const CONFIG = JSON.stringify({
  agents: {
    architect: { eager_skills: ['terse:terse:ultra', 'tooling:tidy', 'spec-conventions'] },
    implementer: { eager_skills: ['checkbox-progress'], lanes: { ruby: { eager_skills: ['spec-conventions'] } } },
  },
  eager_skills_max_chars: 60000,
})

const DIRS = {
  '/project/.claude/skills': ['spec-conventions', 'code-style', 'checkbox-progress', 'findings-contract'],
  '/home/.claude/plugins/cache': ['market'],
  '/home/.claude/plugins/cache/market': ['terse', 'tooling'],
  '/home/.claude/plugins/cache/market/tooling': ['2.0.0'],
  '/home/.claude/plugins/cache/market/terse': ['1.0.0'],
  '/home/.claude/plugins/cache/market/terse/1.0.0/skills': ['terse'],
}

const FILES = {
  '.claude/ouroboros.json': CONFIG,
  'tooling/2.0.0/.claude-plugin/plugin.json': JSON.stringify({ name: 'tooling', skills: ['./skills/engineering/tidy'] }),
  'skills/terse/SKILL.md': '---\nname: terse\n---\nTalk short.',
  'skills/checkbox-progress/SKILL.md': 'Tick boxes.',
  'skills/code-style/SKILL.md': 'Small functions.',
  'skills/findings-contract/SKILL.md': 'Root cause per finding.',
  'skills/spec-conventions/SKILL.md': 'Predicate matchers.',
  'engineering/tidy/SKILL.md': 'Keep it tidy.',
}

const worldBeneath = (on: On, files: Record<string, string>) => {
  const written = new Map<string, string>()
  const fileAt = (path: string) => Object.entries(files).find(([name]) => path.endsWith(name))?.[1]
  mock.env(on, { HOME: '/home' })
  on('session.cwd', () => ({ value: '/project/lib' }))
  on('process.run', (_, e) => {
    const stdout = e.argv.includes('--show-toplevel') ? '/project\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', (_, e) => ({ value: fileAt(e.path) !== undefined || e.path in DIRS }))
  on('fs.read', (_, e) => ({ value: fileAt(e.path) ?? '' }))
  on('fs.list', (_, e) => ({
    value: (DIRS[e.path as keyof typeof DIRS] ?? []).map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('fs.write', (_, e) => {
    written.set(e.path, e.text)
    return { value: undefined }
  })
  return written
}

test('a loop workflow launch writes every role its eager skills, in configured order, and names the directory in its args', async ($, on) => {
  const written = worldBeneath(on, FILES)
  const launched: Array<{ name?: string; args?: unknown }> = []
  on('tool.call', { tool: 'Workflow' }, (_, e) => {
    launched.push({ name: e.name, args: e.args })
    return { result: { status: 'async_launched' as const, taskId: 'w1' } }
  })

  await $.tool.call({ tool: 'Workflow', name: 'ouroboros:milestone-kickoff', args: { milestone: 'M1' } })

  expect(launched[0]?.args).toEqual({ milestone: 'M1', eager_dir: '/project/.claude/ouroboros/eager' })
  expect(written.get('/project/.claude/ouroboros/eager/architect.md')).toBe(
    '<eager-skills>\n<skill name="terse:terse">\nLevel: ultra\nTalk short.\n</skill>\n<skill name="tooling:tidy">\nKeep it tidy.\n</skill>\n' +
      '<skill name="spec-conventions">\nPredicate matchers.\n</skill>\n</eager-skills>\n\n',
  )
  expect(written.get('/project/.claude/ouroboros/eager/implementer-ruby.md')).toContain('<skill name="checkbox-progress">\nTick boxes.\n</skill>\n<skill name="spec-conventions">')
  expect(written.get('/project/.claude/ouroboros/eager/reviewer.md')).toContain('<skill name="findings-contract">')
})

test('a configured skill nobody ships refuses the loop workflow by name', async ($, on) => {
  const config = JSON.stringify({ agents: { architect: { eager_skills: ['tooling:tidy'] }, auditor: { eager_skills: ['nowhere-skill'] } } })
  worldBeneath(on, { ...FILES, '.claude/ouroboros.json': config })
  on('tool.call', { tool: 'Workflow' }, () => ({ result: { status: 'async_launched' as const, taskId: 'w1' } }))

  const answered = await $.tool.call({ tool: 'Workflow', name: 'phase', args: {} })

  expect(answered.deny ?? answered.text).toContain('eager skill not found: nowhere-skill')
})

test('a workflow outside the loop launches untouched', async ($, on) => {
  const written = worldBeneath(on, FILES)
  const launched: unknown[] = []
  on('tool.call', { tool: 'Workflow' }, (_, e) => {
    launched.push(e.args)
    return { result: { status: 'async_launched' as const, taskId: 'w1' } }
  })

  await $.tool.call({ tool: 'Workflow', name: 'review-changes', args: { depth: 1 } })

  expect(launched).toEqual([{ depth: 1 }])
  expect(written.size).toBe(0)
})
