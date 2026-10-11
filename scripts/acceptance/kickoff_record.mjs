import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { KICKOFF_DROPPED_COMMENT, githubConfigOf } from '../../hooks/github/gh_commands.ts'
import { commentsOf, scratchEnv, scratchSubIssues, statusOf } from './scratch_milestone.mjs'

const openIssues = issues => issues.filter(issue => issue.state === 'open')

const numbers = issues => issues.map(issue => issue.number)

const after = (startedAt, timestamp) => Date.parse(timestamp) > Date.parse(startedAt)

const isDropped = (startedAt, issue) => issue.state === 'closed' && issue.state_reason === 'not_planned' && after(startedAt, issue.updated_at)

export const outcomesOf = (startedAt, issues) => ({
  created: numbers(issues.filter(issue => after(startedAt, issue.created_at))),
  updated: numbers(openIssues(issues).filter(issue => !after(startedAt, issue.created_at) && after(startedAt, issue.updated_at))),
  dropped: numbers(issues.filter(issue => isDropped(startedAt, issue))),
  touched_closed: numbers(issues.filter(issue => issue.state === 'closed' && !isDropped(startedAt, issue) && after(startedAt, issue.updated_at))),
})

const startGaps = record => (Number.isNaN(Date.parse(record.started_at)) ? ['record: started_at missing or not a date'] : [])

const plannedGap = (issues, planned) => {
  const match = issues.find(issue => (planned.issue === undefined ? issue.title === planned.title : issue.number === planned.issue))
  if (match === undefined) return [`planned "${planned.title}"${planned.issue === undefined ? '' : ` (#${planned.issue})`}: no sub-issue`]
  if (match.state !== 'open') return [`planned "${planned.title}" (#${match.number}): closed`]
  return []
}

export const createsGaps = (record, issues) => {
  if (!Array.isArray(record.planned) || record.planned.length === 0) return ['record: planned missing or empty']
  return [...startGaps(record), ...record.planned.flatMap(planned => plannedGap(issues, planned))]
}

const noneGap = (kind, found) => (found.length === 0 ? [`${kind}: none`] : [])

const droppedCommentGaps = (dropped, commentsOf) =>
  dropped.filter(number => !commentsOf(number).includes(KICKOFF_DROPPED_COMMENT)).map(number => `#${number}: lacks the kickoff dropped comment`)

const duplicateTitleGaps = issues =>
  [...Map.groupBy(openIssues(issues), issue => issue.title)]
    .filter(([, same]) => same.length > 1)
    .map(([title, same]) => `${same.map(issue => `#${issue.number}`).join(' ')}: share the title "${title}"`)

export const rerunGaps = (record, issues, commentsOf) => {
  const created = createsGaps(record, issues)
  if (startGaps(record).length > 0) return created
  const outcomes = outcomesOf(record.started_at, issues)
  return [
    ...created,
    ...noneGap('created', outcomes.created),
    ...noneGap('updated', outcomes.updated),
    ...noneGap('dropped', outcomes.dropped),
    ...droppedCommentGaps(outcomes.dropped, commentsOf),
    ...outcomes.touched_closed.map(number => `#${number}: closed, yet changed after ${record.started_at}`),
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
