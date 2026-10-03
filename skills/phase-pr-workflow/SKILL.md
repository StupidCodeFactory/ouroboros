---
name: phase-pr-workflow
description: Load when implementing a phase on a milestone branch; outside-in TDD steps, checkpoint commit, evidence and merge rules.
---
# Phase PR workflow

## Outside-in TDD

1. Start with a failing acceptance test at the outer edge: end-to-end, request spec, or stream-in → stream-out.
2. Work inward: write a red unit test that discovers each collaborator before its code exists. A double may stand in for an internal collaborator not built yet; replace it with the real class once built.
3. Keep boundaries real: VCR for HTTP, real Redis, the real rate limiter. No HTTP stubs, no environment mutation, `:no_transaction` for fiber specs, a per-lane test database.
4. Go green with small functions, early returns and typed names (see `code-style`).
5. Delete the old path this phase replaces in the same phase; never leave both.
6. Run the lane's `test` and `lint` commands from `.claude/ouroboros.json`; lint offenses must not exceed the lane's `lint_baseline` and only go down.

## Branch and commits

- One branch per milestone off a fresh `origin/main`, named `<branch_prefix><milestone>-<slug>` with `branch_prefix` from `.claude/ouroboros.json`. No stacked PRs.
- Each phase ends in one checkpoint commit whose subject starts `phase(PN):`. That commit is the retro trigger.
- Work in your own worktree with your own test database; never run two suites against one database.

## Evidence and merge

- Paste the auditor's evidence (command, exit code, decisive output lines) into the phase checkpoint and the milestone PR body.
- Never merge. Only the architect merges, only milestone PRs, only when CI is green, every milestone check is green with evidence, reviewer and architect have zero blocking findings, and no incident is open.
- The same failure surviving three fix rounds is escalated to the user, not retried a fourth time.
