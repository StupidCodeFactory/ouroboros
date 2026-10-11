import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { KICKOFF_DROPPED_COMMENT, githubConfigOf } from '../../hooks/github/gh_commands.ts'
import { commentsOf, scratchEnv, scratchSubIssues, statusOf } from './scratch_milestone.mjs'

const RECORD_KINDS = ['created', 'updated', 'dropped', 'left_closed']

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

const touchedAfterStart = (startedAt, issue) => Date.parse(issue.updated_at) > Date.parse(startedAt)

const leftClosedGaps = (record, issues) => {
  if (Number.isNaN(Date.parse(record.started_at))) return ['record: started_at missing or not a date']
  const keptClosed = issues.filter(issue => issue.state === 'closed' && !record.dropped.includes(issue.number))
  return keptClosed.filter(issue => touchedAfterStart(record.started_at, issue)).map(issue => `#${issue.number}: left closed but updated after ${record.started_at}`)
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
    ...record.left_closed.filter(number => !indexed.has(number)).map(number => `#${number}: not a sub-issue of the milestone`),
    ...leftClosedGaps(record, issues),
    ...duplicateTitleGaps(issues),
  ]
}

export const boardGaps = (issues, statusOf, plannedColumn) =>
  openIssues(issues).flatMap(issue => {
    const status = statusOf(issue.number)
    return status === plannedColumn ? [] : [`#${issue.number}: in "${status ?? 'no column'}", not "${plannedColumn}"`]
  })

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

const gapsOf = check => {
  const { repo, issue } = scratchEnv()
  if (check === 'creates') {
    const record = readRecord(issue)
    return createsGaps(record, scratchSubIssues())
  }
  if (check === 'rerun') {
    const record = readRecord(issue)
    return rerunGaps(record, scratchSubIssues(), commentsOf(repo))
  }
  if (check === 'board') {
    const github = githubConfig()
    return boardGaps(scratchSubIssues(), statusOf(repo, github), github.columns.planned)
  }
  console.error(`unknown check: ${check}; expected creates, rerun or board`)
  process.exit(2)
}

export const main = check => {
  const gaps = gapsOf(check)
  gaps.forEach(gap => console.log(gap))
  process.exit(gaps.length === 0 ? 0 : 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv[2])
