---
name: phase-pr-workflow
description: Load when implementing a phase on a milestone branch; outside-in TDD steps, checkpoint commit, evidence and merge rules.
---
# Phase PR workflow

## Progress

Track every step with the plan's checkboxes per the `checkbox-progress` skill: start from the first unchecked box, tick each box in the commit that verifies it.

## Outside-in TDD

1. Start with a failing acceptance test at the outer edge: end-to-end, an HTTP request test, or input-in → output-out through the real entry point. Name test files, describe blocks and examples after the domain behaviour they check, never after the milestone, phase or task (see `code-style`).
2. Work inward: write a red unit test that discovers each collaborator before its code exists. A double may stand in for an internal collaborator not built yet; replace it with the real class once built.
3. Keep boundaries real: record and replay external HTTP instead of stubbing it, use the real datastores and infrastructure the code talks to, inject configuration instead of mutating the environment, and give each lane its own test database. The project's lane skills name the exact tools.
4. Go green with small functions, early returns and typed names (see `code-style`).
5. Delete the old path this phase replaces in the same phase; never leave both.
6. Run the lane's `test` and `lint` commands from `.claude/ouroboros.json`; lint offenses must not exceed the lane's `lint_baseline` and only go down.

## Branch and commits

- One branch per milestone off a fresh `origin/main`, named `<branch_prefix><milestone>-<slug>` with `branch_prefix` from `.claude/ouroboros.json`. No stacked PRs. After a phase PR is merged, the next phase starts on a fresh branch from the updated default branch; never merge or rebase the old one.
- Each phase ends in one checkpoint commit whose subject starts `phase(PN):`. That commit is the retro trigger. Only the phase checkpoint makes it, after every task of the phase is done, reviewed and the full suite is green. A task or fix commit never starts with `phase(`, even for the last task of a phase; use a conventional subject (`feat:`, `fix:`, `refactor:`, `test:`).
- Work in your own worktree with your own test database; never run two suites against one database.

## Evidence and merge

- Under `merge_policy: ask`, each phase ends in its own PR from its branch into the default branch, opened after the checkpoint, titled `<milestone> <phase>: <summary>`, with the auditor's evidence (command, exit code, decisive output lines) and the phase review outcome in the body.
- Never merge. Under `merge_policy: ask` (the default) the user reviews and merges every PR. Under `merge_policy: architect` there are no phase PRs and only the architect merges the milestone PR at exit, when CI is green, every milestone check is green with evidence, reviewer and architect have zero blocking findings and no incident is open. Never merge or rebase while a workflow is writing to the worktree.
- The same failure surviving three fix rounds is escalated to the user, not retried a fourth time.
