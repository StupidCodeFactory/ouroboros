import { expect, test } from 'claude-code/testing'

import { contractGaps, milestoneGaps, parseMilestoneBody, parsePhase, parseTaskBody, renderMilestoneBody, renderTaskBody } from './contract'

const TASK = {
  goal: 'Owners see their Page in the list.',
  plan: '1. Red: request spec.\n2. Green: controller.',
  checklist: [
    { text: 'the list shows the Page: `bin/rspec spec/requests/pages_spec.rb` passes', done: true },
    { text: 'an empty list says so: `bin/rspec spec/requests/pages_spec.rb` passes', done: false },
  ],
  completion: '`bin/rspec` exits 0.',
  stop: '- Meta returns a shape the spec does not name: stop and ask.',
  must_not: '- No new gem.',
  phase: 'P2',
  depends_on: [6, 8],
}

const MILESTONE = {
  goal: 'The wizard runs without Meta.',
  brief: 'Every screen renders from fixtures.',
  acceptance: [
    { text: 'every screen renders', command: 'bin/rspec spec/system', done: false },
    { text: 'lint is clean', command: 'bin/rubocop', done: true },
  ],
}

const withSection = (body: string, name: string, text: string) => body.replace(new RegExp(`## ${name}\\n[\\s\\S]*?(?=\\n## |$)`), `## ${name}\n${text}\n`)

const withoutSection = (body: string, name: string) => body.replace(new RegExp(`## ${name}\\n[\\s\\S]*?(?=\\n## |$)`), '')

test('a rendered task body parses back to the same task', () => {
  const body = renderTaskBody(TASK)

  expect(body.match(/^## .+$/gm)).toEqual(['## Goal', '## Plan', '## Checklist', '## Completion condition', '## Stop conditions', '## Must not', '## Phase'])
  expect(body).toContain('- [x] the list shows the Page')
  expect(body).toContain('P2\nDepends on: #6, #8')
  expect(parseTaskBody(body)).toEqual(TASK)
})

test('a task with no dependencies says none', () => {
  const body = renderTaskBody({ ...TASK, depends_on: [] })

  expect(body).toContain('P2\nDepends on: none')
  expect(parseTaskBody(body)?.depends_on).toEqual([])
})

test('contract gaps name every missing or empty section', () => {
  const body = renderTaskBody(TASK)

  expect(contractGaps(body)).toEqual([])
  expect(contractGaps(withoutSection(body, 'Must not'))).toEqual(['Must not'])
  expect(contractGaps(withSection(withSection(body, 'Goal', '   '), 'Stop conditions', ''))).toEqual(['Goal', 'Stop conditions'])
  expect(contractGaps(withSection(body, 'Checklist', 'no boxes here'))).toEqual(['Checklist'])
  expect(contractGaps('')).toEqual(['Goal', 'Plan', 'Checklist', 'Completion condition', 'Stop conditions', 'Must not', 'Phase'])
  expect(parseTaskBody(withoutSection(body, 'Must not'))).toBeUndefined()
})

test('the Phase section parses into a phase and its dependencies, and nothing else does', () => {
  expect(parsePhase('P1\nDepends on: none')).toEqual({ phase: 'P1', depends_on: [] })
  expect(parsePhase('P12\nDepends on: #3, #40')).toEqual({ phase: 'P12', depends_on: [3, 40] })
  expect(parsePhase('P1')).toBeUndefined()
  expect(parsePhase('phase one\nDepends on: none')).toBeUndefined()
  expect(parsePhase('P1\nDepends on: 3, 4')).toBeUndefined()
  expect(parsePhase('P1\nDepends on:')).toBeUndefined()
  expect(contractGaps(withSection(renderTaskBody(TASK), 'Phase', 'P1'))).toEqual(['Phase'])
})

test('a milestone body renders Goal, Brief and an Acceptance checklist whose items each carry a command', () => {
  const body = renderMilestoneBody(MILESTONE)

  expect(body.match(/^## .+$/gm)).toEqual(['## Goal', '## Brief', '## Acceptance'])
  expect(body).toContain('- [ ] every screen renders: `bin/rspec spec/system`')
  expect(body).toContain('- [x] lint is clean: `bin/rubocop`')
  expect(parseMilestoneBody(body)).toEqual(MILESTONE)
  expect(milestoneGaps(body)).toEqual([])
})

test('an acceptance item without a command, or a missing milestone section, is a gap', () => {
  const body = renderMilestoneBody(MILESTONE)

  expect(milestoneGaps(withSection(body, 'Acceptance', '- [ ] every screen renders'))).toEqual(['Acceptance'])
  expect(milestoneGaps(withoutSection(body, 'Brief'))).toEqual(['Brief'])
  expect(parseMilestoneBody(withoutSection(body, 'Brief'))).toBeUndefined()
})
