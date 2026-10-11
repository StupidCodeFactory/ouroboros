# 0007 One writer ticks sub-issue checklists: the conductor hook
Status: Proposed
Date: 2026-10-11 / Milestone: github-native milestones / Deciders: user, architect

## Context
Implementers finish checklist items at different moments, and every tick rewrites the whole issue body. GitHub's issue update has no compare-and-swap, so a read-modify-write with retry cannot even detect a lost update. The gate design already holds that only the hook verifies, never an agent (0002).

## Decision
Every checklist item names its own command. When the final gate passes, every item's command has exited 0, and the conductor hook ticks them all in one read, tick and write of the sub-issue body. No agent edits a sub-issue body.

## Alternatives
- Read-modify-write with retry by each implementer: lost updates go unnoticed, and an agent's claim is trusted.
- One comment per tick instead of body edits: the checklist in the body would never reflect progress.

## Consequences
Ticks land together at the final gate, not as implementers finish, so the board shows a sub-issue's progress only through its column. Ticking costs no extra check runs.
