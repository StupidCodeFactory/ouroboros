import { boardIdsOf } from './gh_commands'
import type { GithubConfig } from './gh_commands'

type ProjectList = Parameters<typeof boardIdsOf>[0]
type FieldList = Parameters<typeof boardIdsOf>[1]

const REQUIRED_SCOPES = ['repo', 'project']

export const loginOf = (userAnswer: string) => /"login"\s*:\s*"([^"]+)"/.exec(userAnswer)?.[1] ?? 'the gh account'

const grantedScopes = (userAnswer: string) =>
  (/^x-oauth-scopes:(.*)$/im.exec(userAnswer)?.[1] ?? '').split(',').map(scope => scope.trim()).filter(Boolean)

export const scopeProblems = (userAnswer: string) => {
  const missing = REQUIRED_SCOPES.filter(scope => !grantedScopes(userAnswer).includes(scope))
  if (missing.length === 0) return []
  return [`the gh token of ${loginOf(userAnswer)} lacks the ${missing.join(' and ')} scope: run gh auth refresh -s ${missing.join(',')}`]
}

export const pushProblems = (login: string, repo: string, pushAnswer: string) =>
  pushAnswer.trim() === 'true' ? [] : [`${login} cannot push to ${repo}: ask for write access`]

export const deleteHeadBranchesProblems = (repo: string, answer: string) =>
  answer.trim() === 'true' ? [] : [`the setting "Automatically delete head branches" of ${repo} is off, so a stacked PR can merge into a branch already in the default branch: turn it on under Settings > General > Pull Requests, or run gh api -X PATCH repos/${repo} -F delete_branch_on_merge=true`]

const absentColumns = (fields: FieldList, github: GithubConfig) => {
  const options = fields.fields.find(field => field.name === github.status_field)?.options ?? []
  return Object.values(github.columns).filter(name => !options.some(option => option.name === name))
}

export const boardProblems = (projects: ProjectList, fields: FieldList, github: GithubConfig) => {
  const ids = boardIdsOf(projects, fields, github)
  if (!('missing' in ids)) return []
  if (!ids.missing.startsWith('column ')) return [`missing ${ids.missing}`]
  return absentColumns(fields, github).map(name => `missing column "${name}" of field "${github.status_field}" on project "${github.project}"`)
}

const AUTO_CLOSE = 'Auto-close issue'

export const WORKFLOWS_QUERY = 'query($id: ID!) { node(id: $id) { ... on ProjectV2 { workflows(first: 50) { nodes { name enabled } } } } }'

type WorkflowsAnswer = { data?: { node?: { workflows?: { nodes?: Array<{ name: string; enabled: boolean }> } } } }

export const autoCloseProblems = (project: string, workflowsAnswer: string) => {
  const nodes = (JSON.parse(workflowsAnswer || '{}') as WorkflowsAnswer).data?.node?.workflows?.nodes ?? []
  if (!nodes.some(workflow => workflow.name === AUTO_CLOSE && workflow.enabled)) return []
  return [`the "${AUTO_CLOSE}" workflow of project "${project}" closes a sub-issue when the loop moves it to Done, before its PR merges: turn it off under the project's Workflows, so only the PR's Closes #n closes it on merge`]
}

export const labelProblems = (repo: string, label: string, labelsAnswer: string) =>
  (JSON.parse(labelsAnswer || '[]') as Array<{ name: string }>).some(each => each.name === label) ? [] : [`missing label "${label}" in ${repo}: gh label create ${label} -R ${repo}`]

export const prdProblems = (path: string, text: string | undefined) => {
  if (text === undefined) return [`no PRD at ${path}: write one or set prd in .claude/ouroboros.json`]
  return /^### /m.test(text) ? [] : [`the PRD ${path} has no "### " milestone headings`]
}

export const doctorAnswer = (problems: string[]) =>
  problems.length === 0 ? 'ouroboros doctor: ready' : [`ouroboros doctor found ${problems.length} problems:`, ...problems.map(problem => `- ${problem}`)].join('\n')
