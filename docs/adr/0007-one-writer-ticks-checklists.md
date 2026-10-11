# 0007 One writer ticks sub-issue checklists: the conductor hook
Status: Proposed
Date: 2026-10-11 / Milestone: github-native milestones / Deciders: user, architect

## Context
Parallel implementers finish checklist items at the same time, and every tick rewrites the whole issue body. GitHub's issue update has no compare-and-swap, so a read-modify-write with retry cannot even detect a lost update. The sections design already holds that only the hook verifies, never an agent (0002).

## Decision
Every checklist item is covered by a contract criterion. When the final gate passes, the conductor hook ticks each item whose criterion's checks passed, reading, ticking and writing one issue body at a time. No agent edits a sub-issue body.

## Alternatives
- Read-modify-write with retry by each implementer: lost updates go unnoticed, and an agent's claim is trusted.
- One comment per tick instead of body edits: the checklist in the body would never reflect progress.

## Consequences
Ticks land together at the final gate, not as implementers finish, so the board shows a section's progress only through its column. Ticking costs no extra check runs.
