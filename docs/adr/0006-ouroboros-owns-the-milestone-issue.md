# 0006 Ouroboros owns the milestone issue; the brief and acceptance checks live in its body
Status: Proposed
Date: 2026-10-11 / Milestone: github-native milestones / Deciders: user, architect

## Context
The brief (`common.md`) and the milestone's acceptance checks need one durable home that every agent and the owner can read. The owner wants ouroboros in full control of milestone issues, so agents can run autonomously inside guard rails.

## Decision
Every issue in the board's milestones column (configurable, default "Milestones") is a milestone issue, and ouroboros owns its body: goal, brief and acceptance checklist. Each acceptance item names a command. Kickoff reruns rewrite the body; at exit the hook runs each command and ticks the items that pass. Exit closes the issue only when every sub-issue is closed and every acceptance item is ticked.

## Alternatives
- A marker comment on an owner-written issue: two places to read, and the body would drift from the plan.
- Repo files: need commits outside any PR, and agents would read them from a branch that may be stale.
- A pinned comment: not reliably managed through the API.

## Consequences
Owner edits to a milestone body are overwritten by the next kickoff; the owner changes a milestone by rerunning kickoff. Ouroboros edits no other issues than milestone issues and their sub-issues. The body is capped at 65,536 characters, so per-task detail goes to sub-issues, not the brief.
