# 0005 Issues replace the plan file
Status: Accepted
Date: 2026-10-11 / Milestone: github-native milestones / Deciders: user, architect

## Context
Agents should work GitHub-native: the milestone issue and its sub-issues are where work is planned, tracked and closed. Keeping the plan file alongside them gives two places that say what is done. The gate design (0001, 0002) is unbuilt, so it can adopt issues before any plan-file parsing ships.

## Decision
The plan file goes away. A milestone is one issue; each task is a sub-issue carrying its contract; the next unit of work is the lowest-numbered open sub-issue whose dependencies are closed (0001). No local mirror is generated. The sub-issue's number is the task's identity: a kickoff rerun reads the milestone's open sub-issues and edits, closes as "not planned" or adds them directly, and never touches a closed one.

## Alternatives
- Read-only generated mirror: agents would read a stale copy, and `gh` already reads the issues.
- Plan file stays the source, issues mirror it: the drift this replaces.
- A hidden task marker in each sub-issue body to match tasks on a rerun: only needed when tasks come from a separate source; the parent link and the issue number already identify them.

## Consequences
Every run needs `gh` with access to the repo. Finding the next sub-issue and reading checkboxes go through the GitHub API instead of a file.

## Implementation
Kickoff reads the milestone's sub-issues and applies the architect's task list directly (`hooks/github/kickoff_plan.ts` computes created, updated and dropped; `hooks/github/gh_commands.ts` holds the `gh` calls; `hooks/register.ts` applies and records it). A sub-issue is matched by its number. A closed sub-issue is never touched. `kickoffChanges` rejects the whole task list, and kickoff applies nothing, when a task revises a closed sub-issue or one outside the milestone, when two tasks revise the same sub-issue, when a task misses part of its contract, when a task depends on itself, on a task the list does not hold, on an issue outside the milestone or on a sub-issue kickoff drops, when tasks depend on each other in a cycle, or when the list holds more than 100 tasks. `workflows/issue-kickoff.js` replaces `milestone-kickoff` for issue-backed milestones. The old plan-file workflows still exist and are retired in M4.

## Verification
- `scripts/acceptance/kickoff_rerun.sh`: a rerun updates, creates and drops, never touches a closed sub-issue, makes no duplicate.
- `scripts/acceptance/board_planned.sh`: every open sub-issue is in the planned column.
- `hooks/github/kickoff_plan.test.ts`, `hooks/github/kickoff_hooks.test.ts`: the diff rules and the hook path.
- `./scripts/pre-push` exit 0 (2026-10-11).

## Outcome
Accepted at M1 (PRs #11, #12, #15). Kickoff plans through issues with no plan file. Deviation: the plan-file flow stays in place beside it until M4, so two flows exist for now. Deferred: the run and exit stages (M2, M3), and removal of the plan-file code (M4).
