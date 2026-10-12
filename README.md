# ouroboros

A Claude Code plugin that runs a milestone of work on a GitHub project board.

An architect turns a milestone from your PRD into sub-issues, each holding an implementation plan and a checklist of verifiable items. The loop then takes the sub-issues one at a time. Each stage runs as a workflow in the session's own checkout, on a branch GitHub links to the sub-issue, so the app shows the diff live and the PR when it opens. The implementer works on that branch. The reviewer runs the checklist, and each item that passes gets ticked. Defects send the sub-issue back to In Progress with a comment, until the reviewer accepts it. An accepted sub-issue moves to Done and gets a PR, and the loop starts the next one.

The design is in [docs/specs/2026-10-11-github-milestone-loop.md](docs/specs/2026-10-11-github-milestone-loop.md).

## Install

```bash
claude plugin marketplace add StupidCodeFactory/ouroboros
claude plugin install ouroboros@ouroboros
```

The hooks are function hooks: set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in the `env` of `~/.claude/settings.json`.

## Setup

1. Create a GitHub project with a single-select `Status` field holding the columns `Milestones`, `Planned`, `In Progress`, `QA` and `Done`.
   Under the project's Workflows, turn off "Auto-close issue": the loop moves a sub-issue to Done before its PR merges, and only the PR's `Closes #n` should close it.
2. Create the label `needs-owner` in the repository.
3. Write a PRD with one heading per milestone, for example `### M1. Sign-in`.
4. Open one issue per milestone with that heading as its title, and put it in the Milestones column.
5. Commit `.claude/ouroboros.json`:

```json
{
  "prd": "docs/prd.md",
  "github": {
    "repo": "owner/repo",
    "project": "My board",
    "status_field": "Status",
    "columns": { "milestones": "Milestones", "planned": "Planned", "in_progress": "In Progress", "qa": "QA", "done": "Done" },
    "labels": { "needs_owner": "needs-owner" }
  }
}
```

Everything but `github.project` has the default shown. `branch_prefix` (default `work/`) sets the prefix of task branches. `gh` must be logged in as an account that can edit the repository's issues and the project.

Then run `/ouroboros doctor`. It checks the `gh` account's `repo` and `project` scopes and push rights, the repository setting "Automatically delete head branches", the board, its status field, columns and "Auto-close issue" workflow, the `needs-owner` label and the PRD, and names every problem in one answer, or says the setup is ready. Turn "Automatically delete head branches" on under Settings > General > Pull Requests: without it GitHub keeps a merged base branch, and a stacked PR merges into it instead of the default branch.

## Use

| Command | Does |
|---|---|
| `/ouroboros kickoff <milestone-issue>` | The architect plans the milestone. The hook writes its body and creates, updates or drops sub-issues in Planned. Rerun it to revise the plan. |
| `/ouroboros start <milestone-issue>` | Runs the loop: the next ready sub-issue, then the one after, until none is left or one needs you. |
| `/ouroboros status` | Shows the milestone, the stage and the sub-issue in progress. |
| `/ouroboros stop` | Stops following the running stage. `start` resumes. |
| `/ouroboros doctor` | Checks the setup and names every missing piece, or says it is ready. |

A sub-issue needs you (`needs-owner` label plus a comment) in three cases: its body is incomplete, the implementer is blocked, or three review rounds end without acceptance. Fix the cause, remove the label and run `start` again.

Every accepted sub-issue gets a PR closing it. While a PR is open, the next sub-issue stacks on its branch. Merge the PRs in order.

## Development

```bash
./scripts/install-hooks.sh
./scripts/pre-push
```

`pre-push` runs `claude plugin test .` and validates the manifest. It always runs the pushing worktree's own `scripts/pre-push` in that worktree; `./scripts/acceptance/pre_push_own_checkout.sh` checks this.
