import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

import { renderMilestoneBody, renderTaskBody } from './github/contract'
import { KICKOFF_DROPPED_COMMENT } from './github/gh_commands'

const COMPOSER = { kind: 'composer' as const }
const PRESENTATION = { isFullscreen: false, columns: 80 }
const REPO = 'acme/shop'
const ROOT = '/project'
const CONFIG = JSON.stringify({ prd: 'docs/prd.md', github: { repo: REPO, project: 'Shop board' } })
const PRD = ['## Milestones', '### M2. Pages', 'Goal: owners see their Pages.', '### M3. Exit', 'Goal: close.'].join('\n')

type Issue = { number: number; id: number; title: string; body: string; state: 'open' | 'closed'; column?: string; comments: string[]; labels: string[]; stateReason?: string }
type Launch = { agent?: string; prompt: string; cwd?: string; description?: string }

const TASK = {
  goal: 'g',
  plan: 'p\nFiles: `app/**`',
  checklist: [
    { text: 'it lists', command: 'bin/rspec spec/a_spec.rb', done: false },
    { text: 'it filters', command: 'bin/rspec spec/b_spec.rb', done: false },
  ],
}

const issue = (number: number, title: string, extra: Partial<Issue> = {}): Issue => ({
  number,
  id: number * 1000,
  title,
  body: renderTaskBody({ ...TASK, depends_on: [] }),
  state: 'open',
  comments: [],
  labels: [],
  ...extra,
})

type Listed = { id: string; description: string; type: string; status: string }

const world = (on: On, files: Record<string, string>, issues: Issue[], subIssueNumbers: number[], openPullRequests: string[] = [], agents: Listed[] = []) => {
  const disk = new Map(Object.entries(files))
  const byNumber = new Map(issues.map(each => [each.number, each]))
  const subIssues = [...subIssueNumbers]
  const writes: string[] = []
  const commands: string[] = []
  const launches: Launch[] = []
  const submitted: string[] = []
  const fileAt = (path: string) => [...disk.entries()].find(([name]) => path.endsWith(name))?.[1]
  const answer = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode === 0 ? '' : 'failed', isStdoutTruncated: false, isStderrTruncated: false } })
  const flag = (argv: readonly string[], name: string) => argv[argv.indexOf(name) + 1] ?? ''
  const ghIssue = (argv: readonly string[], stdin: string | undefined) => {
    const [, , verb, number] = argv
    const target = byNumber.get(Number(number))
    if (verb === 'view' && argv.includes('projectItems')) return JSON.stringify(target?.column === undefined ? [] : [{ title: 'Shop board', status: { name: target.column } }])
    if (verb === 'view') return JSON.stringify({ number: target?.number, title: target?.title, body: target?.body })
    if (verb === 'create') {
      const created = issue(Math.max(...byNumber.keys()) + 1, flag(argv, '--title'), { body: stdin ?? '' })
      byNumber.set(created.number, created)
      writes.push(`create #${created.number}`)
      return `https://github.com/${REPO}/issues/${created.number}`
    }
    if (target === undefined) return ''
    if (verb === 'edit' && argv.includes('--add-label')) {
      target.labels.push(flag(argv, '--add-label'))
      writes.push(`label #${target.number}`)
    } else if (verb === 'edit') {
      target.title = flag(argv, '--title')
      target.body = stdin ?? target.body
      writes.push(`edit #${target.number}`)
    }
    if (verb === 'comment') {
      target.comments.push(stdin ?? '')
      writes.push(`comment #${target.number}`)
    }
    if (verb === 'close') {
      target.state = 'closed'
      target.stateReason = flag(argv, '--reason')
      target.comments.push(flag(argv, '--comment'))
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
    if (path.endsWith('/sub_issues')) {
      return subIssues
        .map(number => byNumber.get(number) as Issue)
        .map(each => JSON.stringify({ number: each.number, state: each.state, title: each.title, body: each.body, labels: each.labels }))
        .join('\n')
    }
    return String(byNumber.get(Number(path.split('/').pop()))?.id)
  }
  const ghProject = (argv: readonly string[]) => {
    if (argv[2] === 'list') return JSON.stringify({ projects: [{ number: 3, id: 'PVT_board', title: 'Shop board' }] })
    if (argv[2] === 'field-list') {
      const options = ['Milestones', 'Planned', 'In Progress', 'QA', 'Done'].map(name => ({ id: `o_${name}`, name }))
      return JSON.stringify({ fields: [{ id: 'F_status', name: 'Status', options }] })
    }
    if (argv[2] === 'item-add') return `PVTI_${flag(argv, '--url').split('/').pop()}`
    const item = byNumber.get(Number(flag(argv, '--id').replace('PVTI_', '')))
    if (item !== undefined) item.column = flag(argv, '--single-select-option-id').replace('o_', '')
    return ''
  }
  const ghPr = (argv: readonly string[]) => {
    if (argv[2] === 'view') return openPullRequests.includes(argv[3] ?? '') ? 'OPEN' : 'MERGED'
    writes.push(`pr ${flag(argv, '--head')} into ${flag(argv, '--base')}`)
    openPullRequests.push(flag(argv, '--head'))
    return `https://github.com/${REPO}/pull/99`
  }
  on('process.run', (_, e) => {
    const [tool, noun] = e.argv
    if (e.argv.includes('--show-toplevel')) return answer(`${ROOT}\n`)
    if (e.argv.includes('symbolic-ref')) return answer('origin/main\n')
    if (tool === 'git') {
      commands.push(e.argv.slice(1).filter(arg => arg !== '-C' && !arg.startsWith('/')).join(' '))
      if (e.argv.includes('worktree') && e.argv.includes('add')) disk.set(`.claude/ouroboros/worktrees/${e.argv[e.argv.length - 2]?.split('/').pop()}`, '')
      return answer('')
    }
    if (tool === 'gh' && noun === 'issue') return answer(ghIssue(e.argv, e.init?.stdin))
    if (tool === 'gh' && noun === 'api') return answer(ghApi(e.argv))
    if (tool === 'gh' && noun === 'project') return answer(ghProject(e.argv))
    if (tool === 'gh' && noun === 'pr') return answer(ghPr(e.argv))
    return answer('')
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('agent.spawn', (_, e) => {
    launches.push({ agent: (e as { subagent_type?: string }).subagent_type, prompt: e.prompt, cwd: e.cwd, description: e.description })
    return { model: 'test' }
  })
  on('agent.list', () => ({
    value: [
      ...agents,
      ...launches.map((launch, index) => ({ id: `agent-${index + 1}`, description: launch.description ?? '', type: 'test', status: 'running' })),
    ],
  }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('fs.exists', (_, e) => ({ value: fileAt(e.path) !== undefined }))
  on('fs.read', (_, e) => ({ value: fileAt(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    disk.set(e.path.slice(e.path.indexOf('.claude/') === -1 ? 0 : e.path.indexOf('.claude/')), e.text)
    return { value: undefined }
  })
  return { disk, byNumber, writes, commands, launches, submitted }
}

const run = ($: Parameters<TestBody>[0], args: string) => $.command.run({ command: 'ouroboros', args, origin: COMPOSER, presentation: PRESENTATION })

const stateOf = (disk: Map<string, string>) => JSON.parse(disk.get('.claude/ouroboros/state.json') ?? '{}')

const answer = ($: Parameters<TestBody>[0], json: object, agentId = 'agent-0') =>
  $.turn.complete({ agentId, answer: `Done.\n\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\``, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't-1' })

const MILESTONE = issue(3, 'M2. Pages', { column: 'Milestones', body: 'Goal: owners see their Pages.' })

const BASE_FILES = { '.claude/ouroboros.json': CONFIG, 'docs/prd.md': PRD }

const inFlight = (state: object) => ({ ...BASE_FILES, '.claude/ouroboros/state.json': JSON.stringify({ round: 0, ...state }) })

const working = (stage: string, extra: object = {}) =>
  inFlight({ milestone: 3, stage, agent: 'agent-0', label: `${stage}:#11 round 1`, issue: 11, title: 'Page list', branch: 'work/11-page-list', base: 'main', worktree: `${ROOT}/.claude/ouroboros/worktrees/11`, ...extra })

const ALL_PASS = { items: [{ index: 1, pass: true, evidence: 'ok' }, { index: 2, pass: true, evidence: 'ok' }], defects: [] }

const ONE_FAILS = { items: [{ index: 1, pass: true, evidence: 'ok' }, { index: 2, pass: false, evidence: '1 failure' }], defects: ['filters ignore case'] }

const spawned = (launches: Launch[]) => launches.map(each => [each.agent, each.description])

test('kickoff starts the architect on the PRD section, the milestone body and the sub-issues', async ($, on) => {
  const { disk, launches } = world(on, BASE_FILES, [MILESTONE, issue(11, 'Page list'), issue(10, 'Old', { state: 'closed' })], [10, 11])

  const answered = await run($, 'kickoff 3')

  expect(answered.text).toBe('kickoff #3: the architect is planning against 2 existing sub-issues')
  expect(spawned(launches)).toEqual([['ouroboros:architect', 'kickoff:#3']])
  expect(launches[0]?.prompt).toContain('Plan milestone #3 "M2. Pages".')
  expect(launches[0]?.prompt).toContain('PRD section:\nGoal: owners see their Pages.')
  expect(launches[0]?.prompt).toContain('### #10 (closed) Old')
  expect(launches[0]?.prompt).toContain('### #11 (open) Page list')
  expect(stateOf(disk)).toMatchObject({ milestone: 3, stage: 'kickoff', label: 'kickoff:#3' })
})

test('kickoff is refused while an agent of the loop is running', async ($, on) => {
  const busy = world(on, working('review'), [MILESTONE], [], [], [{ id: 'agent-0', description: 'review:#11 round 1', type: 'test', status: 'running' }])

  expect((await run($, 'kickoff 3')).text).toBe('ouroboros is running review for #11; wait for it, or /ouroboros stop')
  expect(busy.launches).toEqual([])
})

test('kickoff is refused without github.project', async ($, on) => {
  world(on, { ...BASE_FILES, '.claude/ouroboros.json': JSON.stringify({ github: { repo: REPO } }) }, [MILESTONE], [])

  expect((await run($, 'kickoff #3')).text).toBe('ouroboros needs github.project in .claude/ouroboros.json')
})

test('kickoff is refused for an issue outside the milestones column', async ($, on) => {
  world(on, BASE_FILES, [{ ...MILESTONE, column: 'Planned' }], [])

  expect((await run($, `kickoff https://github.com/${REPO}/issues/3`)).text).toBe('#3 is not in the "Milestones" column of "Shop board"')
})

test('kickoff lists the PRD headings when none matches the issue title', async ($, on) => {
  world(on, BASE_FILES, [{ ...MILESTONE, title: 'M9. Elsewhere' }], [])

  expect((await run($, 'kickoff 3')).text).toBe('no heading of docs/prd.md matches "M9. Elsewhere"; headings: Milestones, M2. Pages, M3. Exit')
})

const planned = (title: string, extra: object = {}) => ({ title, ...TASK, checklist: TASK.checklist.map(({ text, command }) => ({ text, command })), depends_on: [], ...extra })

const plan = (tasks: object[]) => ({ milestone: { goal: 'Owners see their Pages.', brief: 'Pages first.', acceptance: [{ text: 'all green', command: './scripts/pre-push' }] }, tasks })

test('the architect answer creates, updates and drops sub-issues, writes the milestone body and plans every open one', async ($, on) => {
  const tasks = [planned('Pages list', { issue: 11 }), planned('Page search', { depends_on: [{ task: 1 }] })]
  const existing = [MILESTONE, issue(10, 'Old done', { state: 'closed' }), issue(11, 'Page list'), issue(12, 'Old export')]
  const { disk, byNumber, writes, submitted } = world(on, inFlight({ milestone: 3, stage: 'kickoff', agent: 'agent-0' }), existing, [10, 11, 12])

  await answer($, plan(tasks))

  expect(submitted).toEqual(['ouroboros: kickoff #3: created #13; updated #11; dropped #12; unchanged none; left closed #10. Next: /ouroboros start 3'])
  expect(writes).toEqual(['create #13', 'link #13', 'edit #11', 'close #12', 'edit #3'])
  expect(byNumber.get(13)?.body).toContain('## Depends on\n#11')
  expect(byNumber.get(12)).toMatchObject({ state: 'closed', stateReason: 'not planned', comments: [KICKOFF_DROPPED_COMMENT] })
  expect(byNumber.get(3)?.body).toBe(renderMilestoneBody({ goal: 'Owners see their Pages.', brief: 'Pages first.', acceptance: [{ text: 'all green', command: './scripts/pre-push', done: false }] }))
  expect([11, 13].map(number => byNumber.get(number)?.column)).toEqual(['Planned', 'Planned'])
  expect(stateOf(disk).stage).toBeUndefined()
})

test('a rejected plan applies nothing and says why', async ($, on) => {
  const { writes, submitted } = world(on, inFlight({ milestone: 3, stage: 'kickoff', agent: 'agent-0' }), [MILESTONE, issue(10, 'Old done', { state: 'closed' })], [10])

  await answer($, plan([planned('Old again', { issue: 10 })]))

  expect(submitted).toEqual(['ouroboros: kickoff #3 rejected, nothing applied: task 1 revises #10, which is closed'])
  expect(writes).toEqual([])
})

test('start moves the next ready sub-issue to In Progress, makes its worktree and starts the implementer there', async ($, on) => {
  const { disk, byNumber, commands, launches } = world(on, BASE_FILES, [MILESTONE, issue(11, 'Page list', { column: 'Planned' }), issue(12, 'Page search', { column: 'Planned', body: renderTaskBody({ ...TASK, depends_on: [11] }) })], [11, 12])

  const answered = await run($, 'start 3')

  expect(answered.text).toBe('#11 "Page list": In Progress on work/11-page-list (from main); implementing')
  expect(byNumber.get(11)?.column).toBe('In Progress')
  expect(commands).toEqual(['fetch origin', 'worktree add -B work/11-page-list origin/main'])
  expect(spawned(launches)).toEqual([['ouroboros:implementer', 'implement:#11 round 1']])
  expect(launches[0]?.cwd).toBe(`${ROOT}/.claude/ouroboros/worktrees/11`)
  expect(launches[0]?.prompt).toContain('Branch: work/11-page-list (based on main)')
  expect(launches[0]?.prompt).toContain('- [ ] it lists: `bin/rspec spec/a_spec.rb`')
  expect(stateOf(disk)).toMatchObject({ milestone: 3, stage: 'implement', label: 'implement:#11 round 1', issue: 11, branch: 'work/11-page-list' })
})

test('a sub-issue whose checklist is incomplete is not started: it is labelled needs-owner and told what is missing', async ($, on) => {
  const { byNumber, launches, disk } = world(on, BASE_FILES, [MILESTONE, issue(11, 'Page list', { column: 'Planned', body: '## Goal\ng\n\n## Plan\np\nFiles: `a`\n\n## Checklist\n- [ ] it lists\n\n## Depends on\nnone\n' })], [11])

  const answered = await run($, 'start 3')

  expect(answered.text).toBe('#11 needs you: see its comment, then remove needs-owner and run /ouroboros start 3')
  expect(byNumber.get(11)?.labels).toEqual(['needs-owner'])
  expect(byNumber.get(11)?.comments[0]).toContain('This sub-issue cannot start: Checklist are missing or incomplete.')
  expect(byNumber.get(11)?.column).toBe('Planned')
  expect(launches).toEqual([])
  expect(stateOf(disk).stage).toBeUndefined()
})

test('start waits while the sub-issue still carries needs-owner', async ($, on) => {
  const { launches } = world(on, BASE_FILES, [MILESTONE, issue(11, 'Page list', { column: 'Planned', labels: ['needs-owner'] })], [11])

  expect((await run($, 'start 3')).text).toBe('#11 still carries needs-owner: answer its comment, remove the label, then /ouroboros start 3')
  expect(launches).toEqual([])
})

test('a finished implementer moves the sub-issue to QA and starts the reviewer', async ($, on) => {
  const { disk, byNumber, launches } = world(on, working('implement'), [MILESTONE, issue(11, 'Page list', { column: 'In Progress' })], [11])

  await answer($, { status: 'done', summary: 'listed' })

  expect(byNumber.get(11)?.column).toBe('QA')
  expect(spawned(launches)).toEqual([['ouroboros:reviewer', 'review:#11 round 1']])
  expect(launches[0]?.prompt).toContain('Review sub-issue #11 "Page list".')
  expect(stateOf(disk)).toMatchObject({ stage: 'review', label: 'review:#11 round 1' })
})

test('a blocked implementer escalates its question to the owner and stops', async ($, on) => {
  const { disk, byNumber, launches, submitted } = world(on, working('implement'), [MILESTONE, issue(11, 'Page list', { column: 'In Progress' })], [11])

  await answer($, { status: 'blocked', question: 'Which locale is the default?' })

  expect(submitted).toEqual(['ouroboros: #11 needs you: see its comment, then remove needs-owner and run /ouroboros start 3'])
  expect(byNumber.get(11)?.labels).toEqual(['needs-owner'])
  expect(byNumber.get(11)?.comments[0]).toContain('Which locale is the default?')
  expect(launches).toEqual([])
  expect(stateOf(disk).stage).toBeUndefined()
})

test('an implementer answer without the json block escalates instead of guessing', async ($, on) => {
  const { byNumber } = world(on, working('implement'), [MILESTONE, issue(11, 'Page list', { column: 'In Progress' })], [11])

  await $.turn.complete({ agentId: 'agent-0', answer: 'all good', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't-1' })

  expect(byNumber.get(11)?.comments[0]).toContain('The implementer ended without a readable answer.')
})

test('an accepted review ticks every item, pushes, opens the PR, moves the sub-issue to Done and starts the next one stacked on it', async ($, on) => {
  const next = issue(12, 'Page search', { column: 'Planned', body: renderTaskBody({ ...TASK, depends_on: [11] }) })
  const { disk, byNumber, writes, commands, launches } = world(on, working('review'), [MILESTONE, issue(11, 'Page list', { column: 'QA' }), next], [11, 12])

  await answer($, ALL_PASS)

  expect(byNumber.get(11)?.body).toContain('- [x] it lists')
  expect(byNumber.get(11)?.body).toContain('- [x] it filters')
  expect(byNumber.get(11)?.column).toBe('Done')
  expect(writes).toEqual(['edit #11', 'pr work/11-page-list into main'])
  expect(commands.slice(0, 2)).toEqual(['push -u origin work/11-page-list', 'worktree remove --force'])
  expect(commands).toContain('worktree add -B work/12-page-search work/11-page-list')
  expect(byNumber.get(12)?.column).toBe('In Progress')
  expect(spawned(launches)).toEqual([['ouroboros:implementer', 'implement:#12 round 1']])
  expect(launches[0]?.prompt).toContain('Branch: work/12-page-search (based on work/11-page-list)')
  expect(stateOf(disk)).toMatchObject({ issue: 12, tip: 'work/11-page-list', stage: 'implement', round: 0 })
})

test('the next sub-issue branches from the default branch once the previous PR is merged', async ($, on) => {
  const { launches } = world(on, inFlight({ milestone: 3, tip: 'work/11-page-list' }), [MILESTONE, issue(11, 'Page list', { column: 'Done' }), issue(12, 'Page search', { column: 'Planned' })], [11, 12])

  await run($, 'start 3')

  expect(launches[0]?.prompt).toContain('(based on main)')
})

test('a rejected review ticks only what passed, comments the defects, moves the sub-issue back to In Progress and implements again', async ($, on) => {
  const { disk, byNumber, launches } = world(on, working('review'), [MILESTONE, issue(11, 'Page list', { column: 'QA' })], [11])

  await answer($, ONE_FAILS)

  expect(byNumber.get(11)?.body).toContain('- [x] it lists')
  expect(byNumber.get(11)?.body).toContain('- [ ] it filters')
  expect(byNumber.get(11)?.comments[0]).toBe('## Review found defects\nFailed checks:\n- it filters: `bin/rspec spec/b_spec.rb`\n  1 failure\n\nDefects:\n- filters ignore case\n\nBack to In Progress.')
  expect(byNumber.get(11)?.column).toBe('In Progress')
  expect(spawned(launches)).toEqual([['ouroboros:implementer', 'implement:#11 round 2']])
  expect(launches[0]?.prompt).toContain('Review round 1 rejected the work. Fix all of this:\n- it filters: `bin/rspec spec/b_spec.rb`\n  1 failure\n- filters ignore case')
  expect(stateOf(disk)).toMatchObject({ stage: 'implement', round: 1 })
})

test('the third rejected review escalates to the owner instead of implementing again', async ($, on) => {
  const { byNumber, launches } = world(on, working('review', { round: 2 }), [MILESTONE, issue(11, 'Page list', { column: 'QA' })], [11])

  await answer($, ONE_FAILS)

  expect(byNumber.get(11)?.labels).toEqual(['needs-owner'])
  expect(byNumber.get(11)?.comments[1]).toContain('3 review rounds ended without acceptance')
  expect(launches).toEqual([])
})

test('start resumes the escalated sub-issue in progress once the owner removed the label', async ($, on) => {
  const { launches } = world(on, working('implement', { stage: undefined, agent: undefined, round: 3 }), [MILESTONE, issue(11, 'Page list', { column: 'In Progress' }), issue(12, 'Other', { column: 'Planned' })], [11, 12])

  const answered = await run($, 'start 3')

  expect(answered.text).toBe('#11 "Page list": In Progress on work/11-page-list (from main); implementing')
  expect(spawned(launches)).toEqual([['ouroboros:implementer', 'implement:#11 round 1']])
})

test('start relaunches the stage when its agent is gone', async ($, on) => {
  const { launches } = world(on, working('implement'), [MILESTONE, issue(11, 'Page list', { column: 'In Progress' })], [11])

  await run($, 'start 3')

  expect(spawned(launches)).toEqual([['ouroboros:implementer', 'implement:#11 round 1']])
})

test('start resumes the sub-issue in flight after a restart', async ($, on) => {
  const files = { ...working('review', { agent: 'agent-stale' }), '.claude/ouroboros/worktrees/11': '' }
  const { disk, byNumber, commands, launches } = world(on, files, [MILESTONE, issue(11, 'Page list', { column: 'QA' }), issue(12, 'Other', { column: 'Planned' })], [11, 12])

  const answered = await run($, 'start 3')

  expect(answered.text).toBe('#11 "Page list": resumed review round 1 on work/11-page-list')
  expect(spawned(launches)).toEqual([['ouroboros:reviewer', 'review:#11 round 1']])
  expect(launches[0]?.cwd).toBe(`${ROOT}/.claude/ouroboros/worktrees/11`)
  expect(byNumber.get(11)?.column).toBe('QA')
  expect(commands).toEqual([])
  expect(byNumber.get(12)).toMatchObject({ column: 'Planned', comments: [], labels: [] })
  expect(stateOf(disk)).toMatchObject({ issue: 11, stage: 'review', round: 0 })
})

test('an answer from another agent is left alone', async ($, on) => {
  const { writes, launches } = world(on, working('review'), [MILESTONE, issue(11, 'Page list', { column: 'QA' })], [11])

  await answer($, ALL_PASS, 'agent-7')

  expect(writes).toEqual([])
  expect(launches).toEqual([])
})

test('with every sub-issue done, start says the milestone is finished', async ($, on) => {
  world(on, BASE_FILES, [MILESTONE, issue(11, 'Page list', { column: 'Done' })], [11])

  expect((await run($, 'start 3')).text).toBe('milestone #3 finished: every sub-issue is Done')
})
