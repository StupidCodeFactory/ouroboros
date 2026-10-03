export const meta = {
  name: 'milestone-exit',
  description: 'Milestone exit: auditor runs every check, implementer opens the PR with the evidence, architect reviews and merges only when every gate passes',
  phases: [{ title: 'Checks' }, { title: 'Pull request' }, { title: 'Merge' }],
}

const stageEffort = (effortByStage, stage) => {
  if (!effortByStage) return undefined
  return effortByStage[stage]
}

const CHECKS_SCHEMA = {
  type: 'object',
  properties: {
    checks_green: { type: 'boolean' },
    evidence: { type: 'string' },
  },
  required: ['checks_green', 'evidence'],
}

const PR_SCHEMA = {
  type: 'object',
  properties: { pr_url: { type: 'string' } },
  required: ['pr_url'],
}

const MERGE_SCHEMA = {
  type: 'object',
  properties: {
    merged: { type: 'boolean' },
    failing_gate: { type: 'string' },
  },
  required: ['merged'],
}

const ouroborosAgent = agent => `ouroboros:${agent}`

const eagerPreamble = file =>
  args.eager_dir ? `Before anything else, read ${args.eager_dir}/${file} in full and follow the skills it holds.\n` : ''

const branchName = () => args.branch ?? 'the current branch'

const checksPrompt = () =>
  eagerPreamble('auditor.md') +
  `Milestone ${args.milestone} exit on ${branchName()}. Run every milestone check and every lane's full test and lint commands from .claude/ouroboros.json. ` +
  'Return whether all are green and the evidence (commands and their output tails).'

const pullRequestPrompt = evidence =>
  eagerPreamble('implementer.md') +
  `Milestone ${args.milestone}: push ${branchName()} and open the pull request against the default branch, ` +
  `following the repository's branch and PR conventions in .claude/ouroboros.json. Put this evidence in the description:\n${evidence}\n` +
  'Every phase PR has normally merged already: when the branch has nothing ahead of the default branch, open no PR and return the url of the last merged phase PR. Return the PR url.'

const mergePrompt = prUrl =>
  eagerPreamble('architect.md') +
  `Milestone ${args.milestone}: final review of ${prUrl}. Check every gate: milestone checks green, CI green, no open incidents, ` +
  'every plan box for this milestone ticked, decisions recorded. When the PR is already merged, return merged true. ' +
  'Otherwise merge only if every gate passes, with `gh pr merge <number> --merge`; else name the failing gate and leave it open.'

const refused = (evidence, prUrl, failingGate) => ({ checks_green: prUrl !== '', evidence, pr_url: prUrl, merged: false, failing_gate: failingGate })

phase('Checks')
const audited = await agent(checksPrompt(), {
  agentType: ouroborosAgent('auditor'),
  schema: CHECKS_SCHEMA,
  phase: 'Checks',
  effort: stageEffort(args.effort, 'audit'),
})
if (!audited) return refused('', '', 'auditor returned nothing')
if (!audited.checks_green) return refused(audited.evidence, '', 'milestone checks red')

phase('Pull request')
const opened = await agent(pullRequestPrompt(audited.evidence), {
  agentType: ouroborosAgent('implementer'),
  schema: PR_SCHEMA,
  phase: 'Pull request',
  effort: stageEffort(args.effort, 'merge'),
})
if (!opened) return refused(audited.evidence, '', 'pull request not opened')

phase('Merge')
const reviewed = await agent(mergePrompt(opened.pr_url), {
  agentType: ouroborosAgent('architect'),
  schema: MERGE_SCHEMA,
  phase: 'Merge',
  effort: stageEffort(args.effort, 'architect_review'),
})
if (!reviewed) return refused(audited.evidence, opened.pr_url, 'architect returned nothing')

return { checks_green: true, evidence: audited.evidence, pr_url: opened.pr_url, merged: reviewed.merged, failing_gate: reviewed.failing_gate }
