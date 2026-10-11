import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { KICKOFF_DROPPED_COMMENT, githubConfigOf } from '../../hooks/github/gh_commands.ts'
import { requireEnv, subIssues } from './scratch_milestone.mjs'

const RECORD_KINDS = ['created', 'updated', 'dropped', 'left_closed']
const SCRATCH_ENV = ['OUROBOROS_SCRATCH_REPO', 'OUROBOROS_SCRATCH_ISSUE']

const byNumber = issues => new Map(issues.map(issue => [issue.number, issue]))

const openIssues = issues => issues.filter(issue => issue.state === 'open')

const openGap = (issues, number) => {
  const issue = issues.get(number)
  if (issue === undefined) return [`#${number}: not a sub-issue of the milestone`]
  if (issue.state !== 'open') return [`#${number}: closed`]
  return []
}

export const createsGaps = (record, issues) => {
  if (record.created.length === 0) return ['created: empty']
  const indexed = byNumber(issues)
  return record.created.flatMap(number => openGap(indexed, number))
}

const droppedGap = (issues, commentsOf, number) => {
  const issue = issues.get(number)
  if (issue?.state_reason !== 'not_planned') return [`#${number}: not closed as not planned`]
  if (!commentsOf(number).includes(KICKOFF_DROPPED_COMMENT)) return [`#${number}: lacks the kickoff dropped comment`]
  return []
}

const leftClosedGap = (issues, startedAt, number) => {
  const issue = issues.get(number)
  if (issue === undefined) return [`#${number}: not a sub-issue of the milestone`]
  return issue.updated_at > startedAt ? [`#${number}: left closed but updated after ${startedAt}`] : []
}

const duplicateTitleGaps = issues =>
  [...Map.groupBy(openIssues(issues), issue => issue.title)]
    .filter(([, same]) => same.length > 1)
    .map(([title, same]) => `${same.map(issue => `#${issue.number}`).join(' ')}: share the title "${title}"`)

export const rerunGaps = (record, issues, commentsOf) => {
  const missing = RECORD_KINDS.filter(kind => !Array.isArray(record[kind]))
  if (missing.length > 0) return missing.map(kind => `record: ${kind} missing`)
  const indexed = byNumber(issues)
  return [
    ...createsGaps(record, issues),
    ...record.updated.flatMap(number => openGap(indexed, number)),
    ...record.dropped.flatMap(number => droppedGap(indexed, commentsOf, number)),
    ...record.left_closed.flatMap(number => leftClosedGap(indexed, record.started_at, number)),
    ...duplicateTitleGaps(issues),
  ]
}

export const boardGaps = (issues, statusOf, plannedColumn) =>
  openIssues(issues).flatMap(issue => {
    const status = statusOf(issue.number)
    return status === plannedColumn ? [] : [`#${issue.number}: in "${status ?? 'no column'}", not "${plannedColumn}"`]
  })

const gh = args => execFileSync('gh', args, { encoding: 'utf8' })

const commentsOf = repo => number =>
  gh(['api', '--paginate', `repos/${repo}/issues/${number}/comments`, '--jq', '.[].body']).split('\n')

const STATUS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $field: String!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { projectItems(first: 50) { nodes {
    project { title }
    fieldValueByName(name: $field) { ... on ProjectV2ItemFieldSingleSelectValue { name } }
  } } } } }`

const statusOf = (repo, github) => number => {
  const [owner, name] = repo.split('/')
  const reply = JSON.parse(gh(['api', 'graphql', '-f', `query=${STATUS_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${number}`, '-f', `field=${github.status_field}`]))
  return reply.data.repository.issue.projectItems.nodes.find(item => item.project.title === github.project)?.fieldValueByName?.name
}

const recordPath = issue => process.env.OUROBOROS_KICKOFF_RECORD || `.claude/ouroboros/results/kickoff-${issue}.json`

const readRecord = issue => {
  try {
    return JSON.parse(readFileSync(recordPath(issue), 'utf8'))
  } catch {
    console.error(`kickoff record not found: ${recordPath(issue)}`)
    process.exit(2)
  }
}

const githubConfig = () => {
  const github = githubConfigOf(JSON.parse(readFileSync('.claude/ouroboros.json', 'utf8')).github)
  if (github.project === undefined) {
    console.error('missing github.project in .claude/ouroboros.json')
    process.exit(2)
  }
  return github
}

const openSubIssuesOrExit = (repo, issue) => {
  const issues = subIssues(repo, issue)
  if (openIssues(issues).length > 0) return issues
  console.error(`no open sub-issue under ${repo}#${issue}`)
  process.exit(2)
}

const gapsOf = (check, repo, issue) => {
  if (check === 'creates') {
    const record = readRecord(issue)
    return createsGaps(record, openSubIssuesOrExit(repo, issue))
  }
  if (check === 'rerun') {
    const record = readRecord(issue)
    return rerunGaps(record, openSubIssuesOrExit(repo, issue), commentsOf(repo))
  }
  if (check === 'board') {
    const github = githubConfig()
    return boardGaps(openSubIssuesOrExit(repo, issue), statusOf(repo, github), github.columns.planned)
  }
  console.error(`unknown check: ${check}; expected creates, rerun or board`)
  process.exit(2)
}

export const main = check => {
  requireEnv(SCRATCH_ENV)
  const gaps = gapsOf(check, process.env.OUROBOROS_SCRATCH_REPO, process.env.OUROBOROS_SCRATCH_ISSUE)
  gaps.forEach(gap => console.log(gap))
  process.exit(gaps.length === 0 ? 0 : 1)
}

if (process.argv[1] === new URL(import.meta.url).pathname) main(process.argv[2])
