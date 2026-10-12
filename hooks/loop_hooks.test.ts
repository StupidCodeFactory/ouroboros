import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

import { renderMilestoneBody, renderTaskBody } from './github/contract'
import { KICKOFF_DROPPED_COMMENT } from './github/gh_commands'

const COMPOSER = { kind: 'composer' as const }
const NOTIFICATION = { kind: 'task-notification' as const }
const PRESENTATION = { isFullscreen: false, columns: 80 }
const REPO = 'acme/shop'
const ROOT = '/project'
const CONFIG = JSON.stringify({ prd: 'docs/prd.md', github: { repo: REPO, project: 'Shop board' } })
const PRD = ['## Milestones', '### M2. Pages', 'Goal: owners see their Pages.', '### M3. Exit', 'Goal: close.'].join('\n')
const LAUNCH_NOTE = /^ouroboros: next, .+\. Launch it: Workflow name=ouroboros:stage$/

type Issue = { number: number; id: number; title: string; body: string; state: 'open' | 'closed'; column?: string; comments: string[]; labels: string[]; stateReason?: string }
type Launch = { agent: string; description: string; prompt: string; args: Record<string, string>; note: string }

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

type Setup = {
  scopes?: string
  push?: boolean
  columns?: string[]
  labels?: string[]
  failing?: string[]
  stderr?: string
  enabledWorkflows?: string[]
  openPullRequests?: string[]
  linked?: Record<number, string>
  currentBranch?: string
  dirty?: string
}
const ALL_COLUMNS = ['Milestones', 'Planned', 'In Progress', 'QA', 'Done']

const notificationOf = (taskId: string) => `<task-notification>\n<task-id>${taskId}</task-id>\n<output-file>/tmp/tasks/${taskId}.output</output-file>\n<status>completed</status>\n</task-notification>`

const world = (on: On, files: Record<string, string>, issues: Issue[], subIssueNumbers: number[], setup: Setup = {}) => {
  const disk = new Map(Object.entries(files))
  const byNumber = new Map(issues.map(each => [each.number, each]))
  const subIssues = [...subIssueNumbers]
  const openPullRequests = [...(setup.openPullRequests ?? [])]
  const linked = new Map(Object.entries(setup.linked ?? {}).map(([number, branch]) => [Number(number), branch]))
  const writes: string[] = []
  const commands: string[] = []
  const launches: Launch[] = []
  const workflowCalls: unknown[] = []
  const submitted: string[] = []
  let launched = 0
  const fileAt = (path: string) => [...disk.entries()].find(([name]) => path.endsWith(name))?.[1]
  const answer = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode === 0 ? '' : setup.stderr ?? 'failed', isStdoutTruncated: false, isStderrTruncated: false } })
  const flag = (argv: readonly string[], name: string) => argv[argv.indexOf(name) + 1] ?? ''
  const ghDevelop = (argv: readonly string[], target: Issue) => {
    if (argv.includes('--list')) {
      const branch = linked.get(target.number)
      return branch === undefined ? '' : `${branch}\thttps://github.com/${REPO}/tree/${branch}`
    }
    commands.push(`issue develop ${target.number} --name ${flag(argv, '--name')} --base ${flag(argv, '--base')}`)
    linked.set(target.number, flag(argv, '--name'))
    return `github.com/${REPO}/tree/${flag(argv, '--name')}`
  }
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
    if (verb === 'develop') return ghDevelop(argv, target)
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
    if (argv.includes('user')) return `HTTP/2.0 200 OK\nX-Oauth-Scopes: ${setup.scopes ?? 'repo, project, read:org'}\n\n{"login":"octo"}`
    if (path === `repos/${REPO}`) return String(setup.push ?? true)
    if (argv.includes('graphql')) {
      const nodes = ['Auto-close issue', 'Item added to project'].map(name => ({ name, enabled: (setup.enabledWorkflows ?? []).includes(name) }))
      return JSON.stringify({ data: { node: { workflows: { nodes } } } })
    }
    if (argv.includes('DELETE')) {
      writes.push(`delete ${path.split('/heads/')[1]}`)
      return ''
    }
    if (argv.includes('POST')) {
      const id = Number((argv.find(arg => arg.startsWith('sub_issue_id=')) ?? '').split('=')[1])
      const subIssue = [...byNumber.values()].find(each => each.id === id)
      if (subIssue !== undefined) subIssues.push(subIssue.number)
      writes.push(`link #${subIssue?.number}`)
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
      const options = (setup.columns ?? ALL_COLUMNS).map(name => ({ id: `o_${name}`, name }))
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
    if (setup.failing?.some(command => e.argv.join(' ').startsWith(command))) return answer('', 1)
    if (e.argv.includes('--show-toplevel')) return answer(`${ROOT}\n`)
    if (e.argv.includes('symbolic-ref')) return answer('origin/main\n')
    if (e.argv.includes('--show-current')) return answer(`${setup.currentBranch ?? 'main'}\n`)
    if (e.argv.includes('--porcelain')) return answer(setup.dirty ?? '')
    if (tool === 'git') {
      commands.push(e.argv.slice(1).filter(arg => arg !== '-C' && !arg.startsWith('/')).join(' '))
      return answer('')
    }
    if (tool === 'gh' && noun === 'issue') return answer(ghIssue(e.argv, e.init?.stdin))
    if (tool === 'gh' && noun === 'api') return answer(ghApi(e.argv))
    if (tool === 'gh' && noun === 'project') return answer(ghProject(e.argv))
    if (tool === 'gh' && noun === 'pr') return answer(ghPr(e.argv))
    if (tool === 'gh' && noun === 'label') return answer(JSON.stringify((setup.labels ?? ['needs-owner']).map(name => ({ name }))))
    return answer('')
  })
  on('tool.call', { tool: 'Workflow' }, (_, e) => {
    workflowCalls.push(e.args)
    launched += 1
    return { result: { status: 'async_launched' as const, taskId: `wf-${launched}` } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  on('session.receive', (_, e) => ({ text: e.text }))
  on('prompt.context', (_, e) => ({ blocks: e.blocks }))
  on('prompt.submit', (_, e) => {
    if (!LAUNCH_NOTE.test(e.text)) submitted.push(e.text)
    else {
      const args = JSON.parse(disk.get('.claude/ouroboros/state.json') ?? '{}').pending
      launches.push({ agent: args.agent, description: args.label, prompt: fileAt(args.brief) ?? '', args, note: e.text })
    }
    return { text: e.text }
  })
  on('fs.exists', (_, e) => ({ value: fileAt(e.path) !== undefined }))
  on('fs.read', (_, e) => ({ value: fileAt(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    disk.set(e.path.slice(e.path.indexOf('.claude/') === -1 ? 0 : e.path.indexOf('.claude/')), e.text)
    return { value: undefined }
  })
  const deliver = ($: Parameters<TestBody>[0], result: object | null, taskId = 'wf-0') => {
    disk.set(`tasks/${taskId}.output`, JSON.stringify({ result }))
    return settled($.session.receive({ origin: NOTIFICATION, text: notificationOf(taskId) }))
  }
  const launchAndDeliver = async ($: Parameters<TestBody>[0], result: object) => {
    const called = await $.tool.call({ tool: 'Workflow', name: 'ouroboros:stage', args: {} })
    return deliver($, result, (called as { result: { taskId: string } }).result.taskId)
  }
  return { disk, byNumber, writes, commands, launches, workflowCalls, submitted, deliver, launchAndDeliver }
}

const settled = async <T>(answer: Promise<T>) => {
  const value = await answer
  await new Promise(resolve => setTimeout(resolve, 0))
  return value
}

const run = ($: Parameters<TestBody>[0], args: string) => settled($.command.run({ command: 'ouroboros', args, origin: COMPOSER, presentation: PRESENTATION }))

const stateOf = (disk: Map<string, string>) => JSON.parse(disk.get('.claude/ouroboros/state.json') ?? '{}')

const MILESTONE = issue(3, 'M2. Pages', { column: 'Milestones', body: 'Goal: owners see their Pages.' })

const BASE_FILES = { '.claude/ouroboros.json': CONFIG, 'docs/prd.md': PRD }

const inFlight = (state: object) => ({ ...BASE_FILES, '.claude/ouroboros/state.json': JSON.stringify({ round: 0, ...state }) })

const working = (stage: string, extra: object = {}) =>
  inFlight({ milestone: 3, stage, run: 'wf-0', label: `${stage}:#11 round 1`, issue: 11, title: 'Page list', branch: 'work/11-page-list', base: 'main', ...extra })

const ALL_PASS = { items: [{ index: 1, pass: true, evidence: 'ok' }, { index: 2, pass: true, evidence: 'ok' }], defects: [] }

const ONE_FAILS = { items: [{ index: 1, pass: true, evidence: 'ok' }, { index: 2, pass: false, evidence: '1 failure' }], defects: ['filters ignore case'] }

const spawned = (launches: Launch[]) => launches.map(each => [each.agent, each.description])

test('kickoff offers the architect stage as a Workflow launch on the PRD section, the milestone body and the sub-issues', async ($, on) => {
  const { disk, launches } = world(on, BASE_FILES, [MILESTONE, issue(11, 'Page list'), issue(10, 'Old', { state: 'closed' })], [10, 11])

  const answered = await run($, 'kickoff 3')

  expect(answered.text).toBe('kickoff #3: the architect is planning against 2 existing sub-issues')
  expect(spawned(launches)).toEqual([['ouroboros:architect', 'kickoff:#3']])
  expect(launches[0]?.args).toEqual({ agent: 'ouroboros:architect', stage: 'kickoff', label: 'kickoff:#3', brief: `${ROOT}/.claude/ouroboros/briefs/kickoff-3.md` })
  expect(launches[0]?.note).toBe('ouroboros: next, kickoff #3. Launch it: Workflow name=ouroboros:stage')
  expect(launches[0]?.prompt).toContain('Plan milestone #3 "M2. Pages".')
  expect(launches[0]?.prompt).toContain('PRD section:\nGoal: owners see their Pages.')
  expect(launches[0]?.prompt).toContain('### #10 (closed) Old')
  expect(launches[0]?.prompt).toContain('### #11 (open) Page list')
  expect(stateOf(disk)).toMatchObject({ milestone: 3, stage: 'kickoff', label: 'kickoff:#3', pending: launches[0]?.args })
})

test('the Workflow call of the pending stage records its run with the pending arguments', async ($, on) => {
  const pending = { agent: 'ouroboros:reviewer', stage: 'review', label: 'review:#11 round 1', brief: `${ROOT}/.claude/ouroboros/briefs/review-11-round-1.md` }
  const { disk, workflowCalls } = world(on, working('review', { run: undefined, pending }), [MILESTONE], [])

  await $.tool.call({ tool: 'Workflow', name: 'ouroboros:stage', args: { stage: 'review', label: 'mistyped' } })

  expect(workflowCalls).toEqual([pending])
  expect(stateOf(disk)).toMatchObject({ stage: 'review', run: 'wf-1' })
  expect(stateOf(disk).pending).toBeUndefined()
})

test('a stage Workflow call is refused while another stage runs', async ($, on) => {
  const { workflowCalls } = world(on, working('review'), [MILESTONE], [])

  const called = await $.tool.call({ tool: 'Workflow', name: 'ouroboros:stage', args: {} })

  expect(called).toEqual({ deny: 'ouroboros is running review:#11 round 1; wait for its result, or /ouroboros stop' })
  expect(workflowCalls).toEqual([])
})

test('kickoff is refused while a stage of the loop runs', async ($, on) => {
  const { launches } = world(on, working('review'), [MILESTONE], [])

  expect((await run($, 'kickoff 3')).text).toBe('ouroboros is running review:#11 round 1; wait for its result, or /ouroboros stop')
  expect(launches).toEqual([])
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

const kickingOff = () => inFlight({ milestone: 3, stage: 'kickoff', run: 'wf-0', label: 'kickoff:#3' })

test('the architect result creates, updates and drops sub-issues, writes the milestone body and plans every open one', async ($, on) => {
  const tasks = [planned('Pages list', { issue: 11 }), planned('Page search', { depends_on: [{ task: 1 }] })]
  const existing = [MILESTONE, issue(10, 'Old done', { state: 'closed' }), issue(11, 'Page list'), issue(12, 'Old export')]
  const { disk, byNumber, writes, submitted, deliver } = world(on, kickingOff(), existing, [10, 11, 12])

  const delivered = await deliver($, plan(tasks))

  expect(delivered).toEqual({ consumed: 'ouroboros: kickoff #3: created #13; updated #11; dropped #12; unchanged none; left closed #10. Next: /ouroboros start 3' })
  expect(submitted).toEqual(['ouroboros: kickoff #3: created #13; updated #11; dropped #12; unchanged none; left closed #10. Next: /ouroboros start 3'])
  expect(writes).toEqual(['create #13', 'link #13', 'edit #11', 'close #12', 'edit #3'])
  expect(byNumber.get(13)?.body).toContain('## Depends on\n#11')
  expect(byNumber.get(12)).toMatchObject({ state: 'closed', stateReason: 'not planned', comments: [KICKOFF_DROPPED_COMMENT] })
  expect(byNumber.get(3)?.body).toBe(renderMilestoneBody({ goal: 'Owners see their Pages.', brief: 'Pages first.', acceptance: [{ text: 'all green', command: './scripts/pre-push', done: false }] }))
  expect([11, 13].map(number => byNumber.get(number)?.column)).toEqual(['Planned', 'Planned'])
  expect(stateOf(disk).stage).toBeUndefined()
  expect(stateOf(disk).run).toBeUndefined()
})

test('a rejected plan applies nothing and says why', async ($, on) => {
  const { writes, submitted, deliver } = world(on, kickingOff(), [MILESTONE, issue(10, 'Old done', { state: 'closed' })], [10])

  await deliver($, plan([planned('Old again', { issue: 10 })]))

  expect(submitted).toEqual(['ouroboros: kickoff #3 rejected, nothing applied: task 1 revises #10, which is closed'])
  expect(writes).toEqual([])
})

test('start links the sub-issue branch on GitHub, checks it out in the session checkout and offers the implement stage', async ($, on) => {
  const { disk, byNumber, commands, launches } = world(on, BASE_FILES, [MILESTONE, issue(11, 'Page list', { column: 'Planned' }), issue(12, 'Page search', { column: 'Planned', body: renderTaskBody({ ...TASK, depends_on: [11] }) })], [11, 12])

  const answered = await run($, 'start 3')

  expect(answered.text).toBe('#11 "Page list": In Progress on work/11-page-list (from main); implementing')
  expect(byNumber.get(11)?.column).toBe('In Progress')
  expect(commands).toEqual(['issue develop 11 --name work/11-page-list --base main', 'fetch origin', 'switch work/11-page-list'])
  expect(spawned(launches)).toEqual([['ouroboros:implementer', 'implement:#11 round 1']])
  expect(launches[0]?.note).toBe('ouroboros: next, implement #11 round 1. Launch it: Workflow name=ouroboros:stage')
  expect(launches[0]?.prompt).toContain('Branch: work/11-page-list (based on main), checked out in this session\'s checkout')
  expect(launches[0]?.prompt).toContain('- [ ] it lists: `bin/rspec spec/a_spec.rb`')
  expect(stateOf(disk)).toMatchObject({ milestone: 3, stage: 'implement', label: 'implement:#11 round 1', issue: 11, branch: 'work/11-page-list' })
})

test('start refuses a checkout with uncommitted changes on another branch and touches nothing', async ($, on) => {
  const { byNumber, writes, commands, launches } = world(on, BASE_FILES, [MILESTONE, issue(11, 'Page list', { column: 'Planned' })], [11], { dirty: ' M app/a.rb\n', currentBranch: 'main' })

  const answered = await run($, 'start 3')

  expect(answered.text).toBe('the session checkout has uncommitted changes on main: commit or stash them, then /ouroboros start 3')
  expect(byNumber.get(11)?.column).toBe('Planned')
  expect(writes).toEqual([])
  expect(commands).toEqual([])
  expect(launches).toEqual([])
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

test('a finished implementer moves the sub-issue to QA and offers the review stage', async ($, on) => {
  const { disk, byNumber, launches, deliver } = world(on, working('implement'), [MILESTONE, issue(11, 'Page list', { column: 'In Progress' })], [11])

  await deliver($, { status: 'done', summary: 'listed' })

  expect(byNumber.get(11)?.column).toBe('QA')
  expect(spawned(launches)).toEqual([['ouroboros:reviewer', 'review:#11 round 1']])
  expect(launches[0]?.prompt).toContain('Review sub-issue #11 "Page list".')
  expect(stateOf(disk)).toMatchObject({ stage: 'review', label: 'review:#11 round 1' })
  expect(stateOf(disk).run).toBeUndefined()
})

test('a blocked implementer escalates its question to the owner and stops', async ($, on) => {
  const { disk, byNumber, launches, submitted, deliver } = world(on, working('implement'), [MILESTONE, issue(11, 'Page list', { column: 'In Progress' })], [11])

  await deliver($, { status: 'blocked', question: 'Which locale is the default?' })

  expect(submitted).toEqual(['ouroboros: #11 needs you: see its comment, then remove needs-owner and run /ouroboros start 3'])
  expect(byNumber.get(11)?.labels).toEqual(['needs-owner'])
  expect(byNumber.get(11)?.comments[0]).toContain('Which locale is the default?')
  expect(launches).toEqual([])
  expect(stateOf(disk).stage).toBeUndefined()
})

test('a stage workflow that returned no result escalates instead of guessing', async ($, on) => {
  const { byNumber, deliver } = world(on, working('implement'), [MILESTONE, issue(11, 'Page list', { column: 'In Progress' })], [11])

  await deliver($, null)

  expect(byNumber.get(11)?.comments[0]).toContain('The implementer ended without a readable answer.')
})

test('an accepted review ticks every item, pushes, opens the PR, moves the sub-issue to Done and starts the next one stacked on it', async ($, on) => {
  const next = issue(12, 'Page search', { column: 'Planned', body: renderTaskBody({ ...TASK, depends_on: [11] }) })
  const { disk, byNumber, writes, commands, launches, submitted, deliver } = world(on, working('review'), [MILESTONE, issue(11, 'Page list', { column: 'QA' }), next], [11, 12], { currentBranch: 'work/11-page-list' })

  await deliver($, ALL_PASS)

  expect(submitted).toEqual([`ouroboros: #11 Done: https://github.com/${REPO}/pull/99 opened from work/11-page-list into main; show it in this session's PR bar. #12 "Page search": In Progress on work/12-page-search (from work/11-page-list); implementing`])

  expect(byNumber.get(11)?.body).toContain('- [x] it lists')
  expect(byNumber.get(11)?.body).toContain('- [x] it filters')
  expect(byNumber.get(11)?.column).toBe('Done')
  expect(writes).toEqual(['edit #11', 'pr work/11-page-list into main', 'comment #11', 'comment #12'])
  expect(commands).toEqual(['push -u origin work/11-page-list', 'issue develop 12 --name work/12-page-search --base work/11-page-list', 'fetch origin', 'switch work/12-page-search'])
  expect(byNumber.get(12)?.column).toBe('In Progress')
  expect(spawned(launches)).toEqual([['ouroboros:implementer', 'implement:#12 round 1']])
  expect(launches[0]?.prompt).toContain('Branch: work/12-page-search (based on work/11-page-list)')
  expect(stateOf(disk)).toMatchObject({ issue: 12, tip: 'work/11-page-list', stage: 'implement', round: 0 })
})

test('the next sub-issue branches from the default branch once the previous PR is merged', async ($, on) => {
  const { commands, launches } = world(on, inFlight({ milestone: 3, tip: 'work/11-page-list' }), [MILESTONE, issue(11, 'Page list', { column: 'Done' }), issue(12, 'Page search', { column: 'Planned' })], [11, 12])

  await run($, 'start 3')

  expect(commands[0]).toBe('issue develop 12 --name work/12-page-search --base main')
  expect(launches[0]?.prompt).toContain('(based on main)')
})

test('a rejected review ticks only what passed, comments the defects, moves the sub-issue back to In Progress and implements again', async ($, on) => {
  const { disk, byNumber, launches, deliver } = world(on, working('review'), [MILESTONE, issue(11, 'Page list', { column: 'QA' })], [11])

  await deliver($, ONE_FAILS)

  expect(byNumber.get(11)?.body).toContain('- [x] it lists')
  expect(byNumber.get(11)?.body).toContain('- [ ] it filters')
  expect(byNumber.get(11)?.comments[0]).toBe('## Review found defects\nFailed checks:\n- it filters: `bin/rspec spec/b_spec.rb`\n  1 failure\n\nDefects:\n- filters ignore case\n\nBack to In Progress.')
  expect(byNumber.get(11)?.column).toBe('In Progress')
  expect(spawned(launches)).toEqual([['ouroboros:implementer', 'implement:#11 round 2']])
  expect(launches[0]?.prompt).toContain('Review round 1 rejected the work. Fix all of this:\n- it filters: `bin/rspec spec/b_spec.rb`\n  1 failure\n- filters ignore case')
  expect(stateOf(disk)).toMatchObject({ stage: 'implement', round: 1 })
})

test('the third rejected review escalates to the owner instead of implementing again', async ($, on) => {
  const { byNumber, launches, deliver } = world(on, working('review', { round: 2 }), [MILESTONE, issue(11, 'Page list', { column: 'QA' })], [11])

  await deliver($, ONE_FAILS)

  expect(byNumber.get(11)?.labels).toEqual(['needs-owner'])
  expect(byNumber.get(11)?.comments[1]).toContain('3 review rounds ended without acceptance')
  expect(launches).toEqual([])
})

test('start resumes the escalated sub-issue in progress once the owner removed the label', async ($, on) => {
  const files = working('implement', { stage: undefined, run: undefined, round: 3 })
  const { launches } = world(on, files, [MILESTONE, issue(11, 'Page list', { column: 'In Progress' }), issue(12, 'Other', { column: 'Planned' })], [11, 12], { linked: { 11: 'work/11-page-list' } })

  const answered = await run($, 'start 3')

  expect(answered.text).toBe('#11 "Page list": In Progress on work/11-page-list (from main); implementing')
  expect(spawned(launches)).toEqual([['ouroboros:implementer', 'implement:#11 round 1']])
})

test('start offers the stage again when its workflow never launched', async ($, on) => {
  const { launches } = world(on, working('implement', { run: undefined }), [MILESTONE, issue(11, 'Page list', { column: 'In Progress' })], [11], { linked: { 11: 'work/11-page-list' } })

  await run($, 'start 3')

  expect(spawned(launches)).toEqual([['ouroboros:implementer', 'implement:#11 round 1']])
})

test('start resumes the sub-issue in flight after a restart on its linked branch, even with uncommitted work on it', async ($, on) => {
  const setup = { linked: { 11: 'work/11-page-list' }, currentBranch: 'work/11-page-list', dirty: ' M app/a.rb\n' }
  const { disk, byNumber, commands, launches } = world(on, working('review', { run: undefined }), [MILESTONE, issue(11, 'Page list', { column: 'QA' }), issue(12, 'Other', { column: 'Planned' })], [11, 12], setup)

  const answered = await run($, 'start 3')

  expect(answered.text).toBe('#11 "Page list": resumed review round 1 on work/11-page-list')
  expect(spawned(launches)).toEqual([['ouroboros:reviewer', 'review:#11 round 1']])
  expect(byNumber.get(11)?.column).toBe('QA')
  expect(commands).toEqual(['fetch origin', 'switch work/11-page-list'])
  expect(byNumber.get(12)).toMatchObject({ column: 'Planned', comments: [], labels: [] })
  expect(stateOf(disk)).toMatchObject({ issue: 11, stage: 'review', round: 0 })
})

test('start resumes an In Progress or QA sub-issue from the board without local state', async ($, on) => {
  const issues = [MILESTONE, issue(11, 'Page list', { column: 'QA' }), issue(12, 'Other', { column: 'Planned' })]
  const { disk, byNumber, commands, launches } = world(on, BASE_FILES, issues, [11, 12], { linked: { 11: 'work/11-page-list' } })

  const answered = await run($, 'start 3')

  expect(answered.text).toBe('#11 "Page list": resumed review round 1 on work/11-page-list')
  expect(spawned(launches)).toEqual([['ouroboros:reviewer', 'review:#11 round 1']])
  expect(launches[0]?.prompt).toContain('Branch: work/11-page-list (based on main)')
  expect(commands).toEqual(['fetch origin', 'switch work/11-page-list'])
  expect(byNumber.get(11)?.column).toBe('QA')
  expect(byNumber.get(12)).toMatchObject({ column: 'Planned', comments: [], labels: [] })
  expect(stateOf(disk)).toMatchObject({ issue: 11, stage: 'review', round: 0, branch: 'work/11-page-list', base: 'main' })
})

test('a notification of another task is passed through untouched', async ($, on) => {
  const { writes, launches, deliver } = world(on, working('review'), [MILESTONE, issue(11, 'Page list', { column: 'QA' })], [11])

  const delivered = await deliver($, ALL_PASS, 'wf-7')

  expect(delivered).toEqual({ text: notificationOf('wf-7') })
  expect(writes).toEqual([])
  expect(launches).toEqual([])
})

test('with every sub-issue done, start says the milestone is finished', async ($, on) => {
  world(on, BASE_FILES, [MILESTONE, issue(11, 'Page list', { column: 'Done' })], [11])

  expect((await run($, 'start 3')).text).toBe('milestone #3 finished: every sub-issue is Done')
})

test('every stage change comments on the sub-issue', async ($, on) => {
  const { byNumber, writes, launchAndDeliver } = world(on, BASE_FILES, [MILESTONE, issue(11, 'Page list', { column: 'Planned' })], [11])

  await run($, 'start 3')
  await launchAndDeliver($, { status: 'done', summary: 'listed' })
  await launchAndDeliver($, ONE_FAILS)
  await launchAndDeliver($, { status: 'done', summary: 'fixed' })
  await launchAndDeliver($, ALL_PASS)

  expect(byNumber.get(11)?.comments).toEqual([
    'Ouroboros: In Progress on `work/11-page-list` (from main), implementing, round 1',
    'Ouroboros: QA, reviewing round 1',
    '## Review found defects\nFailed checks:\n- it filters: `bin/rspec spec/b_spec.rb`\n  1 failure\n\nDefects:\n- filters ignore case\n\nBack to In Progress.',
    'Ouroboros: In Progress on `work/11-page-list` (from main), implementing, round 2',
    'Ouroboros: QA, reviewing round 2',
    'Ouroboros: Done, PR #99 opened from `work/11-page-list` into main; the merge closes this issue',
  ])
  expect(writes.filter(write => write.startsWith('comment') || write.startsWith('pr'))).toEqual([...Array(5).fill('comment #11'), 'pr work/11-page-list into main', 'comment #11'])
})

test('a gh failure stops the loop and names the command', async ($, on) => {
  const stderr = 'GraphQL: No commits between main and work/11-page-list'
  const { disk, byNumber, launches, submitted, deliver } = world(on, working('review'), [MILESTONE, issue(11, 'Page list', { column: 'QA' })], [11], { failing: ['gh pr create'], stderr })

  await deliver($, ALL_PASS)

  expect(byNumber.get(11)?.body).toContain('- [ ] it lists')
  expect(byNumber.get(11)?.body).toContain('- [ ] it filters')
  expect(byNumber.get(11)).toMatchObject({ column: 'QA', comments: [] })
  expect(stateOf(disk).stage).toBeUndefined()
  expect(launches).toEqual([])
  expect(submitted).toHaveLength(1)
  expect(submitted[0]).toStartWith('ouroboros: stopped: `gh pr create -R acme/shop --base main --head work/11-page-list --title \'Page list\' --body-file -` failed: ')
  expect(submitted[0]).toContain(stderr)
  expect(submitted[0]).toEndWith('; GitHub is back as it was before the stage')
})

test('a failed start deletes the branch it linked on GitHub', async ($, on) => {
  const { writes } = world(on, BASE_FILES, [MILESTONE, issue(11, 'Page list', { column: 'Planned' })], [11], { failing: ['git -C /project switch'] })

  const answered = await run($, 'start 3')

  expect(answered.text).toStartWith('ouroboros: stopped: `git -C /project switch work/11-page-list` failed: ')
  expect(writes).toContain('delete work/11-page-list')
})

test('stop forgets the stage in flight', async ($, on) => {
  const { disk } = world(on, working('review'), [MILESTONE], [])

  await run($, 'stop')

  expect(stateOf(disk)).toMatchObject({ milestone: 3, issue: 11 })
  expect(stateOf(disk).stage).toBeUndefined()
  expect(stateOf(disk).run).toBeUndefined()
})

test('the session context names the pending stage launch', async ($, on) => {
  const pending = { agent: 'ouroboros:reviewer', stage: 'review', label: 'review:#11 round 1', brief: `${ROOT}/.claude/ouroboros/briefs/review-11-round-1.md` }
  world(on, working('review', { run: undefined, pending }), [MILESTONE], [])

  const { blocks } = await $.prompt.context({ blocks: [] })

  expect(blocks[0]?.text).toContain('pending launch: review #11 round 1 with Workflow name=ouroboros:stage')
  expect(blocks[0]?.text).not.toContain('{')
})

test('doctor names every missing piece of the setup', async ($, on) => {
  const setup = { scopes: 'repo, read:org', push: false, columns: ALL_COLUMNS.filter(name => name !== 'QA'), labels: ['bug'] }
  world(on, { '.claude/ouroboros.json': CONFIG }, [MILESTONE], [], setup)

  const answered = (await run($, 'doctor')).text

  expect(answered).toStartWith('ouroboros doctor found 5 problems:')
  expect(answered).toContain('- the gh token of octo lacks the project scope: run gh auth refresh -s project')
  expect(answered).toContain('- octo cannot push to acme/shop')
  expect(answered).toContain('- missing column "QA" of field "Status" on project "Shop board"')
  expect(answered).toContain('- missing label "needs-owner" in acme/shop')
  expect(answered).toContain('- no PRD at docs/prd.md')
})

test('doctor still checks push rights when gh cannot read the account', async ($, on) => {
  world(on, BASE_FILES, [MILESTONE], [], { push: false, failing: ['gh api -i user'] })

  const answered = (await run($, 'doctor')).text

  expect(answered).toStartWith('ouroboros doctor found 2 problems:')
  expect(answered).toContain('- `gh api -i user` failed: failed')
  expect(answered).toContain('- the gh account cannot push to acme/shop')
})

test('doctor still checks the token and the PRD when gh cannot name the repo', async ($, on) => {
  const config = JSON.stringify({ prd: 'docs/prd.md', github: { project: 'Shop board' } })
  world(on, { '.claude/ouroboros.json': config }, [MILESTONE], [], { scopes: 'repo', failing: ['gh repo view'] })

  const answered = (await run($, 'doctor')).text

  expect(answered).toStartWith('ouroboros doctor found 3 problems:')
  expect(answered).toContain('- `gh repo view --json nameWithOwner --jq .nameWithOwner` failed: failed')
  expect(answered).toContain('- the gh token of octo lacks the project scope: run gh auth refresh -s project')
  expect(answered).toContain('- no PRD at docs/prd.md')
})

test('doctor names the auto-close workflow that closes a sub-issue before its PR merges', async ($, on) => {
  world(on, BASE_FILES, [MILESTONE], [], { enabledWorkflows: ['Auto-close issue'] })

  const answered = (await run($, 'doctor')).text

  expect(answered).toStartWith('ouroboros doctor found 1 problems:')
  expect(answered).toContain('- the "Auto-close issue" workflow of project "Shop board" closes a sub-issue when the loop moves it to Done, before its PR merges: turn it off under the project\'s Workflows')
})

test('doctor still names missing columns when gh cannot read the board workflows', async ($, on) => {
  world(on, BASE_FILES, [MILESTONE], [], { columns: ALL_COLUMNS.filter(name => name !== 'QA'), failing: ['gh api graphql'] })

  const answered = (await run($, 'doctor')).text

  expect(answered).toStartWith('ouroboros doctor found 2 problems:')
  expect(answered).toContain('- `gh api graphql -f')
  expect(answered).toContain('- missing column "QA" of field "Status" on project "Shop board"')
})

test('doctor says the setup is ready', async ($, on) => {
  world(on, BASE_FILES, [MILESTONE], [])

  expect((await run($, 'doctor')).text).toBe('ouroboros doctor: ready')
})

