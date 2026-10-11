import { expect, test } from 'claude-code/testing'

import { contractGaps, milestoneGaps, parseDependsOn, parseMilestoneBody, parseTaskBody, renderMilestoneBody, renderTaskBody } from './contract'

const TASK = {
  goal: 'Owners see their Page in the list.',
  plan: '1. Red: request spec.\n2. Green: controller.\nFiles: `app/controllers/pages_controller.rb`, `spec/requests/**`',
  checklist: [
    { text: 'the list shows the Page', command: 'bin/rspec spec/requests/pages_spec.rb:4', done: true },
    { text: 'an empty list says so', command: 'bin/rspec spec/requests/pages_spec.rb:12', done: false },
  ],
  completion: ['bin/rspec', 'bin/rubocop'],
  stop: '- Meta returns a shape the spec does not name: stop and ask.',
  must_not: '- No new gem.',
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

const SECTION_NAMES = ['## Goal', '## Plan', '## Checklist', '## Completion condition', '## Stop conditions', '## Must not', '## Depends on']

const withSection = (body: string, name: string, text: string) => body.replace(new RegExp(`## ${name}\\n[\\s\\S]*?(?=\\n## |$)`), `## ${name}\n${text}\n`)

const withoutSection = (body: string, name: string) => body.replace(new RegExp(`## ${name}\\n[\\s\\S]*?(?=\\n## |$)`), '')

test('a rendered task body parses back to the same task', () => {
  const body = renderTaskBody(TASK)

  expect(body.match(/^## .+$/gm)).toEqual(SECTION_NAMES)
  expect(body).toContain('- [x] the list shows the Page: `bin/rspec spec/requests/pages_spec.rb:4`')
  expect(body).toContain('## Completion condition\n- `bin/rspec`\n- `bin/rubocop`')
  expect(body).toContain('## Depends on\n#6, #8')
  expect(parseTaskBody(body)).toEqual(TASK)
})

test('a task with no dependencies says none', () => {
  const body = renderTaskBody({ ...TASK, depends_on: [] })

  expect(body).toContain('## Depends on\nnone')
  expect(parseTaskBody(body)?.depends_on).toEqual([])
})

test('contract gaps name every missing or empty section', () => {
  const body = renderTaskBody(TASK)

  expect(contractGaps(body)).toEqual([])
  expect(contractGaps(withoutSection(body, 'Must not'))).toEqual(['Must not'])
  expect(contractGaps(withSection(withSection(body, 'Goal', '   '), 'Stop conditions', ''))).toEqual(['Goal', 'Stop conditions'])
  expect(contractGaps('')).toEqual(['Goal', 'Plan', 'Checklist', 'Completion condition', 'Stop conditions', 'Must not', 'Depends on'])
  expect(parseTaskBody(withoutSection(body, 'Must not'))).toBeUndefined()
})

test('a checklist or completion item without a command is a gap', () => {
  const body = renderTaskBody(TASK)

  expect(contractGaps(withSection(body, 'Checklist', '- [ ] the list shows the Page'))).toEqual(['Checklist'])
  expect(contractGaps(withSection(body, 'Checklist', 'no boxes here'))).toEqual(['Checklist'])
  expect(contractGaps(withSection(body, 'Completion condition', '- the suite passes'))).toEqual(['Completion condition'])
})

test('a plan without a Files line naming at least one path is a gap', () => {
  const body = renderTaskBody(TASK)

  expect(contractGaps(withSection(body, 'Plan', '1. Red.\n2. Green.'))).toEqual(['Plan'])
  expect(contractGaps(withSection(body, 'Plan', '1. Red.\nFiles: none yet'))).toEqual(['Plan'])
})

test('the Depends on section parses into issue numbers, and nothing else does', () => {
  expect(parseDependsOn('none')).toEqual([])
  expect(parseDependsOn('#3, #40')).toEqual([3, 40])
  expect(parseDependsOn('3, 4')).toBeUndefined()
  expect(parseDependsOn('#3 and #4')).toBeUndefined()
  expect(contractGaps(withSection(renderTaskBody(TASK), 'Depends on', 'P1'))).toEqual(['Depends on'])
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
