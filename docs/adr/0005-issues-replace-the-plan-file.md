# 0005 Issues replace the plan file
Status: Proposed
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
