# 0006 Ouroboros owns the milestone issue; the brief and acceptance checks live in its body
Status: Accepted
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

## Implementation
`hooks/github/contract.ts` renders and parses the milestone body (Goal, Brief, Acceptance) and checks the task contract. `hooks/register.ts` (`kickoffIssue`) refuses a kickoff, naming the reason, when a run is in flight, when `.claude/ouroboros.json` has no `github.project`, when a board column or field is missing, or when the issue is not in the milestones column; `hooks/github/kickoff_issue.ts` (`milestoneColumn`) only looks up the issue's column. The milestone is the PRD section whose heading matches the issue title (`prdSection` in `hooks/github/kickoff_issue.ts`); with no PRD file kickoff stops and names the `prd` setting, and with no matching heading it stops and lists the PRD's headings. `hooks/register.ts` writes the whole body on each kickoff, then records the run at `.claude/ouroboros/results/kickoff-<n>.json` with the keys `created`, `updated`, `dropped`, `left_closed` and `started_at` (`kickoffRecord` in `hooks/github/kickoff_issue.ts`); the acceptance scripts read that record through `OUROBOROS_KICKOFF_RECORD`. The acceptance items of M1 are commands in the PRD (`docs/specs/2026-10-10-sections-and-verified-gates.md`). Acceptance scripts under `scripts/acceptance/` (`scratch_milestone.mjs`, `contract_sections.mjs`, `kickoff_record.mjs` with `kickoff_creates.sh`, `kickoff_rerun.sh`, `board_planned.sh`) take their input from `OUROBOROS_SCRATCH_REPO`, `OUROBOROS_SCRATCH_ISSUE` and `OUROBOROS_KICKOFF_RECORD`, and never write to GitHub. Fixtures are in `scripts/acceptance/fixtures/`; the README Development section documents the scripts.

## Verification
- `node --experimental-strip-types --no-warnings --test 'scripts/acceptance/*.test.mjs'`: 27 pass, 0 fail (2026-10-11).
- `./scripts/guard_no_outside_skills.sh` exit 0; `./scripts/pre-push` exit 0.
- `hooks/github/contract.test.ts`, `hooks/github/kickoff_issue.test.ts`.
- Not run: the acceptance scripts against a live scratch milestone; they need `OUROBOROS_SCRATCH_REPO` and `OUROBOROS_SCRATCH_ISSUE`.

## Outcome
Accepted at M1 (sub-issues #6 and #7; PRs #11, #14, #15). Kickoff owns the milestone body and the acceptance checks exist as scripts. Deviation: the PRD rather than the milestone body holds the M1 acceptance items until a kickoff run writes them. Deferred to M3: exit ticks acceptance items and closes the issue.
