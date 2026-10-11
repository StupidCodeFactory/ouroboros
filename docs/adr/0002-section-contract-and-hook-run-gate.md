# 0002 The sub-issue is the contract, and the hook runs the gate
Status: Proposed
Date: 2026-10-10 / Milestone: sections and verified gates / Deciders: user, architect

## Context
Auto-continue (0004) is only safe when "done" is proven by something an agent cannot talk past. Before this, the checkpoint agent reported whether checks were green, and nothing checked scope or forbidden changes. Claude Code's best practices call a hook that runs the check stronger than an instruction, and say evidence beats claims (https://code.claude.com/docs/en/best-practices). Anthropic's harness design work has builder and evaluator agree testable criteria before any code (https://www.anthropic.com/engineering/harness-design-long-running-apps, 2026-03-24).

## Decision
The sub-issue body is the contract: every checklist item and completion item names a command, and the Plan's `Files:` line bounds the scope; `protected` and `no_new` come from the project config. Before implementing, the auditor commits the checks red, and the run refuses to implement when a check is green before code, red for the wrong reason, weakly asserted, or satisfiable by a cheat. The hook, not an agent, runs the final gate and writes the PR's evidence.

## Alternatives
- Agent-reported gate: the failure this replaces.
- CI as the only gate: too late for the run to stop itself, and CI does not know the sub-issue's scope.
- A contract file per run beside the sub-issue (criteria, done_when, may_change): it repeats the sub-issue in another format, and two records drift.
- Re-running the checks against reverted production code (revert test): rejected by the user as over the top; red at the red commit plus an unchanged check since then already proves the check depends on the work.

## Consequences
Every project needs lane `test` commands before a sub-issue can start. One extra agent per sub-issue (the cheat attempt). Kickoff must write every checklist item as a command. A gate command longer than 10 minutes fails, since a hook process runs at most that long.
