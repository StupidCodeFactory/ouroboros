import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const LESSONS_FILE = 'skills/planning-lessons/SKILL.md'
const INCIDENTS_FILE = 'skills/planning-lessons/incidents.md'
const CONFIG_FILE = '.claude/ouroboros.json'
const CONFIG = JSON.stringify({ planning_skills: ['acme:brainstorm', 'acme:plan-writer'] })
const COMPOSER = { kind: 'composer' as const }
const PRESENTATION = { isFullscreen: false, columns: 80 }

const filesBeneath = (on: On, seeded: Record<string, string>) => {
  const files = new Map(Object.entries(seeded))
  const fileAt = (path: string) => [...files].find(([name]) => path.endsWith(name))?.[1]
  on('fs.exists', (_, e) => ({ value: fileAt(e.path) !== undefined }))
  on('fs.read', (_, e) => ({ value: fileAt(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    files.set(e.path.slice(e.path.indexOf('skills/')), e.text)
    return { value: undefined }
  })
  return files
}

const gitBeneath = (on: On, subject: string) =>
  on('process.run', () => ({
    value: { exitCode: 0, stdout: subject, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))

const mainTurn = { reason: 'answer' as const, answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' }

const sessionBeneath = (on: On) => {
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  mock.clock(on, { now: Date.UTC(2026, 9, 3) })
  gitBeneath(on, 'phase(P1): first')
}

test('a configured planning skill reads with the planning lessons appended', async ($, on) => {
  sessionBeneath(on)
  filesBeneath(on, { [CONFIG_FILE]: CONFIG, [LESSONS_FILE]: '---\nname: planning-lessons\n---\n1. Map first.' })

  const shown = await $.skill.prompt({ skill: 'acme:brainstorm', text: 'BRAINSTORM' })

  expect(shown.text).toBe('BRAINSTORM\n\n## Planning lessons (from past sessions)\n\n1. Map first.')
})

test('without configured planning skills no skill gets lessons', async ($, on) => {
  sessionBeneath(on)
  filesBeneath(on, { [LESSONS_FILE]: 'lessons' })

  const shown = await $.skill.prompt({ skill: 'acme:brainstorm', text: 'BRAINSTORM' })

  expect(shown.text).toBe('BRAINSTORM')
})

test('an unrelated skill is left alone', async ($, on) => {
  sessionBeneath(on)
  const reads: string[] = []
  on('fs.exists', (_, e) => ({ value: e.path.endsWith(CONFIG_FILE) }))
  on('fs.read', (_, e) => {
    reads.push(e.path)
    return { value: e.path.endsWith(CONFIG_FILE) ? CONFIG : '' }
  })

  const shown = await $.skill.prompt({ skill: 'commit', text: 'COMMIT' })

  expect(shown.text).toBe('COMMIT')
  expect(reads.filter(path => !path.endsWith(CONFIG_FILE))).toEqual([])
})

test('a prompt during planning is a candidate lesson, and planning ends with a turn that ran no planning skill', async ($, on) => {
  sessionBeneath(on)
  const files = filesBeneath(on, { [CONFIG_FILE]: CONFIG, [LESSONS_FILE]: 'lessons', [INCIDENTS_FILE]: '# Incidents\n\n' })

  await $.skill.prompt({ skill: 'plan-writer', text: 'PLAN' })
  await $.turn.complete(mainTurn)
  await $.prompt.submit({ text: 'no, keep the existing queue', wait: false, origin: COMPOSER })
  await $.turn.complete(mainTurn)
  await $.prompt.submit({ text: 'unrelated later prompt', wait: false, origin: COMPOSER })

  const log = files.get(INCIDENTS_FILE) ?? ''
  expect(log).toContain('| 2026-10-03 | P2 | user | candidate | | no, keep the existing queue | | candidate | |')
  expect(log).not.toContain('unrelated later prompt')
})

test('/skill-incident is registered at session start and logs an open skill-gap row', async ($, on) => {
  sessionBeneath(on)
  const files = filesBeneath(on, {})
  const registered: string[] = []
  on('command.register', (_, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/project', surface: null, isInteractive: true })
  const answered = await $.command.run({
    command: 'skill-incident',
    args: 'code-style used nested ifs',
    origin: COMPOSER,
    presentation: PRESENTATION,
  })

  expect(registered).toEqual(['skill-incident', 'ouroboros'])
  expect(answered.text).toBe('logged against code-style')
  expect(files.get('skills/code-style/incidents.md')).toContain('| 2026-10-03 | P2 | user | skill-gap | | used nested ifs |  | open | |')
})
