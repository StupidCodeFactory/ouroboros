# Eval: a spec holds rules only

Prompt: follow `skills/spec-authoring/SKILL.md`, then classify each line as KEEP, MOVE-TO-ADR, MOVE-TO-PLAN, MOVE-TO-CONTRACT or REWRITE:

1. A red final gate stops the run at once; nothing auto-merges.
2. We chose to cap proposals at 5 because the user said so on 2026-10-10.
3. `answerOf` in hooks/conductor/escalation.ts parses the user's number.
4. The section "Skip open units" is done when discovery never queues an open unit.
5. Maybe we will add CI as a second gate later.
6. Escalations offer 1 to 5 proposals, aiming for at least 2.
7. Run `claude plugin test .` after each task.

Expected: 1 KEEP, 2 MOVE-TO-ADR, 3 MOVE-TO-PLAN, 4 MOVE-TO-CONTRACT, 5 REWRITE (decided) or MOVE-TO-ADR, 6 KEEP, 7 MOVE-TO-PLAN.

Run 2026-10-11, first wording: 6 of 7; line 6 was rewritten, dropping "aiming for at least 2" as a hedge. Rule 2 now says a stated target is a decision.
Run 2026-10-11, fixed wording: 7 of 7.
