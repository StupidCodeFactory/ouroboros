import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

import { renderMilestoneBody, renderTaskBody } from './contract'
import { KICKOFF_DROPPED_COMMENT } from './gh_commands'

const COMPOSER = { kind: 'composer' as const }
const PRESENTATION = { isFullscreen: false, columns: 80 }
const NOTIFICATION = { kind: 'task-notification' as const }
const NOON = Date.UTC(2026, 9, 11, 12)
const REPO = 'acme/shop'
const CONFIG = JSON.stringify({ prd: 'docs/prd.md', github: { repo: REPO, project: 'Shop board' } })
const PRD = ['## Milestones', '### M2. Pages', 'Goal: owners see their Pages.', '### M3. Exit', 'Goal: close.'].join('\n')

type Issue = { number: number; id: number; title: string; body: string; state: 'open' | 'closed'; column?: string; comments: string[]; stateReason?: string }

const CONTRACT = {
  goal: 'g',
  plan: 'p\nFiles: `app/**`',
  checklist: [{ text: 'it works', command: 'bin/rspec spec/a_spec.rb', done: false }],
  completion: ['bin/rspec'],
  stop: 's',
  must_not: 'm',
}

const issue = (number: number, title: string, extra: Partial<Issue> = {}): Issue => ({
  number,
  id: number * 1000,
  title,
  body: renderTaskBody({ ...CONTRACT, depends_on: [] }),
  state: 'open',
  comments: [],
  ...extra,
})

const githubWorld = (on: On, files: Record<string, string>, issues: Issue[], subIssueNumbers: number[]) => {
  const disk = new Map(Object.entries(files))
  const byNumber = new Map(issues.map(each => [each.number, each]))
  const subIssues = [...subIssueNumbers]
  const writes: string[] = []
  const fileAt = (path: string) => [...disk.entries()].find(([name]) => path.endsWith(name))?.[1]
  const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  const ghIssue = (argv: readonly string[], stdin: string | undefined) => {
    const [, , verb, number] = argv
    const target = byNumber.get(Number(number))
    if (verb === 'view' && argv.includes('projectItems')) return JSON.stringify(target?.column === undefined ? [] : [{ title: 'Shop board', status: { name: target.column } }])
    if (verb === 'view') return JSON.stringify({ number: target?.number, title: target?.title, body: target?.body })
    if (verb === 'create') {
      const created = issue(Math.max(...byNumber.keys()) + 1, argv[argv.indexOf('--title') + 1] ?? '', { body: stdin ?? '' })
      byNumber.set(created.number, created)
      writes.push(`create #${created.number}`)
      return `https://github.com/${REPO}/issues/${created.number}`
    }
    if (verb === 'edit' && target !== undefined) {
      target.title = argv[argv.indexOf('--title') + 1] ?? target.title
      target.body = stdin ?? target.body
      writes.push(`edit #${target.number}`)
    }
    if (verb === 'close' && target !== undefined) {
      target.state = 'closed'
      target.stateReason = argv[argv.indexOf('--reason') + 1]
      target.comments.push(argv[argv.indexOf('--comment') + 1] ?? '')
      writes.push(`close #${target.number}`)
    }
    return ''
  }
  const ghApi = (argv: readonly string[]) => {
    const path = argv.find(arg => arg.startsWith('repos/')) ?? ''
    if (argv.includes('POST')) {
      const id = Number((argv.find(arg => arg.startsWith('sub_issue_id=')) ?? '').split('=')[1])
      const linked = [...byNumber.values()].find(each => each.id === id)
      if (linked !== undefined) subIssues.push(linked.number)
      writes.push(`link #${linked?.number}`)
      return ''
    }
    if (path.endsWith('/sub_issues')) return subIssues.map(number => byNumber.get(number)).map(each => JSON.stringify({ number: each?.number, state: each?.state, title: each?.title, body: each?.body })).join('\n')
    return String(byNumber.get(Number(path.split('/').pop()))?.id)
  }
  const ghProject = (argv: readonly string[]) => {
    if (argv[2] === 'list') return JSON.stringify({ projects: [{ number: 3, id: 'PVT_board', title: 'Shop board' }] })
    if (argv[2] === 'field-list') {
      const options = ['Milestones', 'Planned', 'In Progress', 'QA', 'Done'].map(name => ({ id: `o_${name}`, name }))
      return JSON.stringify({ fields: [{ id: 'F_status', name: 'Status', options }] })
    }
    if (argv[2] === 'item-add') return `PVTI_${(argv[argv.indexOf('--url') + 1] ?? '').split('/').pop()}`
    const item = byNumber.get(Number((argv[argv.indexOf('--id') + 1] ?? '').replace('PVTI_', '')))
    if (item !== undefined) item.column = (argv[argv.indexOf('--single-select-option-id') + 1] ?? '').replace('o_', '')
    return ''
  }
  mock.env(on, { HOME: '/home' })
  on('process.run', (_, e) => {
    if (e.argv.includes('--show-toplevel')) return answer('/project\n')
    if (e.argv.includes('--git-common-dir')) return answer('/project/.git\n')
    if (e.argv[0] === 'gh' && e.argv[1] === 'issue') return answer(ghIssue(e.argv, e.init?.stdin))
    if (e.argv[0] === 'gh' && e.argv[1] === 'api') return answer(ghApi(e.argv))
    if (e.argv[0] === 'gh' && e.argv[1] === 'project') return answer(ghProject(e.argv))
    return answer('')
  })
  on('fs.exists', (_, e) => ({ value: fileAt(e.path) !== undefined }))
  on('fs.read', (_, e) => ({ value: fileAt(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    disk.set(e.path.slice(e.path.indexOf('.claude/')), e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.receive', (_, e) => ({ text: e.text }))
  on('session.id', () => ({ value: 'main-session' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  return { disk, byNumber, writes }
}

const run = ($: Parameters<TestBody>[0], args: string) => $.command.run({ command: 'ouroboros', args, origin: COMPOSER, presentation: PRESENTATION })

const stateOf = (disk: Map<string, string>) => JSON.parse(disk.get('.claude/ouroboros/state.json') ?? '{}')

const MILESTONE = issue(3, 'M2. Pages', { column: 'Milestones', body: 'Goal: owners see their Pages.' })

test('kickoff <issue> offers the issue-kickoff launch for a milestone issue', async ($, on) => {
  const { disk } = githubWorld(on, { '.claude/ouroboros.json': CONFIG, 'docs/prd.md': PRD }, [MILESTONE, issue(11, 'Page list'), issue(10, 'Old', { state: 'closed' })], [10, 11])

  const answered = await run($, 'kickoff 3')

  expect(answered.text).toContain('Workflow name=issue-kickoff')
  expect(stateOf(disk)).toMatchObject({ milestone: '#3', status: 'kickoff', pending: { workflow: 'issue-kickoff', args: { issue: 3, title: 'M2. Pages', prd_section: 'Goal: owners see their Pages.' } } })
  expect(stateOf(disk).pending.args.sub_issues.map((each: { number: number }) => each.number)).toEqual([10, 11])
})

test('kickoff <issue> is refused while a run is in flight', async ($, on) => {
  const inFlight = JSON.stringify({ milestone: 'M1', phases: [], current: null, status: 'phase', escalations: [], results: {}, run: { id: 'wf-1', workflow: 'phase' } })
  githubWorld(on, { '.claude/ouroboros.json': CONFIG, 'docs/prd.md': PRD, '.claude/ouroboros/state.json': inFlight }, [MILESTONE], [])

  const answered = await run($, 'kickoff 3')

  expect(answered.text).toBe('kickoff waits: phase (wf-1) is in flight')
})

test('kickoff <issue> is refused without github.project', async ($, on) => {
  githubWorld(on, { '.claude/ouroboros.json': JSON.stringify({ github: { repo: REPO } }), 'docs/prd.md': PRD }, [MILESTONE], [])

  const answered = await run($, 'kickoff #3')

  expect(answered.text).toBe('kickoff needs github.project in .claude/ouroboros.json')
})

test('kickoff <issue> is refused for an issue outside the milestones column', async ($, on) => {
  githubWorld(on, { '.claude/ouroboros.json': CONFIG, 'docs/prd.md': PRD }, [{ ...MILESTONE, column: 'Planned' }], [])

  const answered = await run($, `kickoff https://github.com/${REPO}/issues/3`)

  expect(answered.text).toBe('#3 is not in the "Milestones" column of "Shop board"')
})

test('kickoff <issue> stops and lists the PRD headings when none matches the issue title', async ($, on) => {
  githubWorld(on, { '.claude/ouroboros.json': CONFIG, 'docs/prd.md': PRD }, [{ ...MILESTONE, title: 'M9. Elsewhere' }], [])

  const answered = await run($, 'kickoff 3')

  expect(answered.text).toBe('no heading of docs/prd.md matches "M9. Elsewhere"; headings: Milestones, M2. Pages, M3. Exit')
})

const OUTPUT_FILE = '/tmp/tasks/wf-k.output'

const notification = `<task-notification>\n<task-id>wf-k</task-id>\n<output-file>${OUTPUT_FILE}</output-file>\n<status>completed</status>\n</task-notification>`

const kickoffInFlight = JSON.stringify({ milestone: '#3', phases: [], current: null, status: 'kickoff', escalations: [], results: {}, run: { id: 'wf-k', workflow: 'issue-kickoff', started_at: NOON } })

const planned = (title: string, extra: object = {}) => ({ title, ...CONTRACT, checklist: CONTRACT.checklist.map(({ text, command }) => ({ text, command })), depends_on: [], ...extra })

const outputOf = (tasks: object[]) =>
  JSON.stringify({ result: { milestone: { goal: 'Owners see their Pages.', brief: 'Pages first.', acceptance: [{ text: 'all green', command: './scripts/pre-push' }] }, tasks } })

test('a kickoff result is applied, recorded and answered with numbers per outcome', async ($, on) => {
  const tasks = [planned('Pages list', { issue: 11 }), planned('Page search', { depends_on: [{ task: 1 }] })]
  const existing = [MILESTONE, issue(10, 'Old done', { state: 'closed' }), issue(11, 'Page list'), issue(12, 'Old export')]
  const { disk, byNumber, writes } = githubWorld(on, { '.claude/ouroboros.json': CONFIG, '.claude/ouroboros/state.json': kickoffInFlight, [OUTPUT_FILE]: outputOf(tasks) }, existing, [10, 11, 12])

  const delivered = await $.session.receive({ origin: NOTIFICATION, text: notification })

  expect(delivered.text).toBe('kickoff #3: created #13; updated #11; dropped #12; unchanged none; left closed #10')
  expect(writes).toEqual(['create #13', 'link #13', 'edit #11', 'close #12', 'edit #3'])
  expect(byNumber.get(13)?.body).toContain('## Depends on\n#11')
  expect(byNumber.get(12)).toMatchObject({ state: 'closed', stateReason: 'not planned', comments: [KICKOFF_DROPPED_COMMENT] })
  expect(byNumber.get(3)?.body).toBe(renderMilestoneBody({ goal: 'Owners see their Pages.', brief: 'Pages first.', acceptance: [{ text: 'all green', command: './scripts/pre-push', done: false }] }))
  expect([11, 13].map(number => byNumber.get(number)?.column)).toEqual(['Planned', 'Planned'])
  expect(JSON.parse(disk.get('.claude/ouroboros/results/kickoff-3.json') ?? '{}')).toEqual({ created: [13], updated: [11], dropped: [12], left_closed: [10], started_at: '2026-10-11T12:00:00.000Z' })
  expect(stateOf(disk)).toMatchObject({ status: 'idle' })
  expect(stateOf(disk).run).toBeUndefined()
})

test('a rejected task list applies nothing and answers the reason', async ($, on) => {
  const tasks = [planned('Old done again', { issue: 10 })]
  const existing = [MILESTONE, issue(10, 'Old done', { state: 'closed' }), issue(11, 'Page list')]
  const { disk, writes } = githubWorld(on, { '.claude/ouroboros.json': CONFIG, '.claude/ouroboros/state.json': kickoffInFlight, [OUTPUT_FILE]: outputOf(tasks) }, existing, [10, 11])

  const delivered = await $.session.receive({ origin: NOTIFICATION, text: notification })

  expect(delivered.text).toBe('kickoff #3 rejected, nothing applied: task 1 revises #10, which is closed')
  expect(writes).toEqual([])
  expect(disk.has('.claude/ouroboros/results/kickoff-3.json')).toBe(false)
  expect(stateOf(disk)).toMatchObject({ status: 'idle' })
})
