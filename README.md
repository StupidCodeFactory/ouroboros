# ouroboros

A Claude Code plugin that runs a milestone of work on a GitHub project board.

An architect turns a milestone from your PRD into sub-issues, each holding an implementation plan and a checklist of verifiable items. The loop then takes the sub-issues one at a time. The implementer works in its own worktree. The reviewer runs the checklist, and each item that passes gets ticked. Defects send the sub-issue back to In Progress with a comment, until the reviewer accepts it. An accepted sub-issue moves to Done and gets a PR, and the loop starts the next one.

The design is in [docs/specs/2026-10-11-github-milestone-loop.md](docs/specs/2026-10-11-github-milestone-loop.md).

## Install

```bash
claude plugin marketplace add StupidCodeFactory/ouroboros
claude plugin install ouroboros@ouroboros
```

The hooks are function hooks: set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in the `env` of `~/.claude/settings.json`.

## Setup

1. Create a GitHub project with a single-select `Status` field holding the columns `Milestones`, `Planned`, `In Progress`, `QA` and `Done`.
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

## Use

| Command | Does |
|---|---|
| `/ouroboros kickoff <milestone-issue>` | The architect plans the milestone. The hook writes its body and creates, updates or drops sub-issues in Planned. Rerun it to revise the plan. |
| `/ouroboros start <milestone-issue>` | Runs the loop: the next ready sub-issue, then the one after, until none is left or one needs you. |
| `/ouroboros status` | Shows the milestone, the stage and the sub-issue in progress. |
| `/ouroboros stop` | Stops following the running agent. `start` resumes. |

A sub-issue needs you (`needs-owner` label plus a comment) in three cases: its body is incomplete, the implementer is blocked, or three review rounds end without acceptance. Fix the cause, remove the label and run `start` again.

Every accepted sub-issue gets a PR closing it. While a PR is open, the next sub-issue stacks on its branch. Merge the PRs in order.

## Development

```bash
./scripts/install-hooks.sh
./scripts/pre-push
```

`pre-push` runs `claude plugin test .` and validates the manifest. It always runs the pushing worktree's own `scripts/pre-push` in that worktree; `./scripts/acceptance/pre_push_own_checkout.sh` checks this.
