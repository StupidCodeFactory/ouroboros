import { execFileSync } from 'node:child_process'

export const requireEnv = names => {
  const missing = names.filter(name => !process.env[name])
  if (missing.length === 0) return
  console.error(`missing env: ${missing.join(' ')}`)
  process.exit(2)
}

const SUB_ISSUE_FIELDS = '.[] | {number,state,state_reason,title,body,updated_at}'

export const subIssues = (repo, issue) =>
  execFileSync('gh', ['api', '--paginate', `repos/${repo}/issues/${issue}/sub_issues`, '--jq', SUB_ISSUE_FIELDS], { encoding: 'utf8' })
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line))

export const openSubIssues = (repo, issue) => subIssues(repo, issue).filter(subIssue => subIssue.state === 'open')
