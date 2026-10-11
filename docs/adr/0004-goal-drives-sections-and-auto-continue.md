# 0004 /goal drives each sub-issue; the next starts after the user's merge
Status: Proposed
Date: 2026-10-10 / Milestone: sections and verified gates / Deciders: user, architect

## Context
The user wants the next unit of work to start by itself. Claude Code's `/goal` keeps a session working until a small model, reading only the transcript, judges a condition met (https://code.claude.com/docs/en/goal). A spike on 2026-10-10 (Claude Code 2.1.295) showed a plugin hook can set a goal with `$.command.run({ command: 'goal', args })` from a `$.clock.after` callback; `$.prompt.submit` refuses text starting with `/`.

## Decision
Starting a sub-issue sets a goal whose condition is the gate line only the hook prints (`GATE PASS`/`GATE FAIL #<number>`) or an open escalation. After the user merges its PR, the conductor starts the next ready sub-issue under a new goal. The user's merge stays the only human gate.

## Alternatives
- Start the next sub-issue as soon as the gate passes, stacking PRs.
- Auto-merge a green PR: rejected; the user stays the final check.
- Only the conductor's own launch path: works, but loses the per-turn evaluator.

## Consequences
Setting a goal from a hook is undocumented; if a build drops it, sub-issues still chain through the conductor and only the evaluator is lost. The gate is unaffected.
