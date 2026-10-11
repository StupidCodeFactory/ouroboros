import type { PlannedTask } from './kickoff_plan'

export type Column = 'milestones' | 'planned' | 'in_progress' | 'qa' | 'done'
export type GithubSettings = {
  repo?: string
  project?: string
  status_field?: string
  columns?: Partial<Record<Column, string>>
  labels?: { needs_owner?: string }
}
export type GithubConfig = Omit<GithubSettings, 'status_field' | 'columns' | 'labels'> & {
  status_field: string
  columns: Record<Column, string>
  labels: { needs_owner: string }
}
export type BoardIds = { project_id: string; project_number: number; status_field_id: string; columns: Record<Column, string> }
export type GhCommand = { argv: string[]; stdin?: string }

type ProjectList = { projects: Array<{ number: number; id: string; title: string }> }
type FieldList = { fields: Array<{ id: string; name: string; options?: Array<{ id: string; name: string }> }> }

export const KICKOFF_DROPPED_COMMENT = 'Closed as not planned: kickoff dropped this task from the milestone plan.'

const DEFAULT_COLUMNS: Record<Column, string> = { milestones: 'Milestones', planned: 'Planned', in_progress: 'In Progress', qa: 'QA', done: 'Done' }

export const githubConfigOf = (settings: GithubSettings | undefined): GithubConfig => ({
  ...settings,
  status_field: settings?.status_field ?? 'Status',
  columns: { ...DEFAULT_COLUMNS, ...settings?.columns },
  labels: { needs_owner: settings?.labels?.needs_owner ?? 'needs-owner' },
})

export const createSubIssueCommand = (repo: string, title: string, body: string): GhCommand => ({
  argv: ['gh', 'issue', 'create', '-R', repo, '--title', title, '--body-file', '-'],
  stdin: body,
})

export const linkSubIssueCommand = (repo: string, parent: number, subIssueId: number): GhCommand => ({
  argv: ['gh', 'api', '-X', 'POST', `repos/${repo}/issues/${parent}/sub_issues`, '-F', `sub_issue_id=${subIssueId}`],
})

export const editIssueCommand = (repo: string, number: number, title: string, body: string): GhCommand => ({
  argv: ['gh', 'issue', 'edit', String(number), '-R', repo, '--title', title, '--body-file', '-'],
  stdin: body,
})

export const dropCommand = (repo: string, number: number): GhCommand => ({
  argv: ['gh', 'issue', 'close', String(number), '-R', repo, '--reason', 'not planned', '--comment', KICKOFF_DROPPED_COMMENT],
})

export const commentCommand = (repo: string, number: number, text: string): GhCommand => ({
  argv: ['gh', 'issue', 'comment', String(number), '-R', repo, '--body-file', '-'],
  stdin: text,
})

export const addLabelCommand = (repo: string, number: number, label: string): GhCommand => ({
  argv: ['gh', 'issue', 'edit', String(number), '-R', repo, '--add-label', label],
})

export type PullRequest = { base: string; head: string; title: string; number: number }

export const pullRequestCommand = (repo: string, pr: PullRequest): GhCommand => ({
  argv: ['gh', 'pr', 'create', '-R', repo, '--base', pr.base, '--head', pr.head, '--title', pr.title, '--body-file', '-'],
  stdin: `Closes #${pr.number}\n`,
})

export const addToBoardCommand = (owner: string, ids: BoardIds, issueUrl: string): GhCommand => ({
  argv: ['gh', 'project', 'item-add', String(ids.project_number), '--owner', owner, '--url', issueUrl, '--format', 'json', '--jq', '.id'],
})

export const setColumnCommand = (ids: BoardIds, itemId: string, column: Column): GhCommand => ({
  argv: ['gh', 'project', 'item-edit', '--id', itemId, '--project-id', ids.project_id, '--field-id', ids.status_field_id, '--single-select-option-id', ids.columns[column]],
})

const newTaskDependencies = (task: PlannedTask, created: number[]) =>
  task.depends_on.flatMap(dependency => ('task' in dependency && created.includes(dependency.task) ? [dependency.task] : []))

export const creationOrder = (tasks: PlannedTask[], created: number[]) => {
  const ordered: number[] = []
  while (ordered.length < created.length) {
    const ready = created.find(position => !ordered.includes(position) && newTaskDependencies(tasks[position - 1] as PlannedTask, created).every(dependency => ordered.includes(dependency)))
    if (ready === undefined) return ordered
    ordered.push(ready)
  }
  return ordered
}

const columnIds = (options: Array<{ id: string; name: string }>, github: GithubConfig) =>
  Object.entries(github.columns).map(([column, name]) => ({ column, name, id: options.find(option => option.name === name)?.id }))

export const boardIdsOf = (projects: ProjectList, fields: FieldList, github: GithubConfig): BoardIds | { missing: string } => {
  if (github.project === undefined) return { missing: 'github.project in .claude/ouroboros.json' }
  const project = projects.projects.find(candidate => candidate.title === github.project)
  if (project === undefined) return { missing: `project "${github.project}"` }
  const status = fields.fields.find(field => field.name === github.status_field)
  if (status === undefined) return { missing: `field "${github.status_field}" on project "${github.project}"` }
  const columns = columnIds(status.options ?? [], github)
  const absent = columns.find(column => column.id === undefined)
  if (absent !== undefined) return { missing: `column "${absent.name}" of field "${github.status_field}"` }
  return {
    project_id: project.id,
    project_number: project.number,
    status_field_id: status.id,
    columns: Object.fromEntries(columns.map(column => [column.column, column.id])) as Record<Column, string>,
  }
}

export const issueOfPosition = (tasks: PlannedTask[], created: Map<number, number>) => (position: number) => tasks[position - 1]?.issue ?? created.get(position) ?? 0
