import { execFileSync } from 'node:child_process'

export const requireEnv = names => {
  const missing = names.filter(name => !process.env[name])
  if (missing.length === 0) return
  console.error(`missing env: ${missing.join(' ')}`)
  process.exit(2)
}

export const scratchEnv = () => {
  requireEnv(['OUROBOROS_SCRATCH_REPO', 'OUROBOROS_SCRATCH_ISSUE'])
  return { repo: process.env.OUROBOROS_SCRATCH_REPO, issue: process.env.OUROBOROS_SCRATCH_ISSUE }
}

const gh = args => execFileSync('gh', args, { encoding: 'utf8' })

const jsonLines = text => text.split('\n').filter(line => line !== '').map(line => JSON.parse(line))

const SUB_ISSUE_FIELDS = '.[] | {number,state,state_reason,title,body,updated_at}'

export const subIssues = (repo, issue) => jsonLines(gh(['api', '--paginate', `repos/${repo}/issues/${issue}/sub_issues`, '--jq', SUB_ISSUE_FIELDS]))

export const openSubIssues = (repo, issue) => subIssues(repo, issue).filter(subIssue => subIssue.state === 'open')

export const scratchSubIssues = () => {
  const { repo, issue } = scratchEnv()
  const issues = subIssues(repo, issue)
  if (issues.some(subIssue => subIssue.state === 'open')) return issues
  console.error(`no open sub-issue under ${repo}#${issue}`)
  process.exit(2)
}

export const commentsOf = repo => number => gh(['api', '--paginate', `repos/${repo}/issues/${number}/comments`, '--jq', '.[].body']).split('\n')

const STATUS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $field: String!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { projectItems(first: 50) { nodes {
    project { title }
    fieldValueByName(name: $field) { ... on ProjectV2ItemFieldSingleSelectValue { name } }
  } } } } }`

export const statusOf = (repo, github) => number => {
  const [owner, name] = repo.split('/')
  const reply = JSON.parse(gh(['api', 'graphql', '-f', `query=${STATUS_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${number}`, '-f', `field=${github.status_field}`]))
  return reply.data.repository.issue.projectItems.nodes.find(item => item.project.title === github.project)?.fieldValueByName?.name
}
