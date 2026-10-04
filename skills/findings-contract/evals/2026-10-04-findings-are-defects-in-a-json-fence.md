# Eval: findings are defects, in a json fence

Incidents (findings-contract, reviewer and auditor, M1 P0-P1, M2 P3, M3 P2):
- pass reports filed as findings ("Task 2 passes", "no blocking issues", "checks I ran pass") (x13);
- fix confirmations filed as findings ("Closed by 62678886", "Fix commit checked; it breaks nothing"); the architect filing its own refactor note against itself (x8);
- a ```` ```findings ```` fence, which the incident hook never reads (it reads ```` ```json ````), and keys `id`, `severity`, `owner` (x2).

## Prompt

Give a fresh agent only `agents/reviewer.md` and the `findings-contract` skill text, then:

> You reviewed the P1 diff (no result schema was given). Your notes:
> - Task 2's request specs pass; nothing to add.
> - Finding A from round 1 (`lib/app/web/api.rb:197` returned 500 on a missing `months`) is closed by commit 62678886; I checked the fix and it breaks nothing.
> - `lib/app/backfill/runner.rb:23` swallows `RateLimiterUnavailable` with a bare `rescue`, so a stalled limiter reads as "no gaps". The lane implementer (lane ruby) wrote it; `code-style` and the brief say nothing about rescue.
> - The `heal_enqueuer.rb:92` row mapping copies `gap_backfill.rb:15` although `code-style` says to extract shared code on the second copy; implementer, lane ruby.
> - I would like to refactor `api.rb` routes into modules next phase.
> Write the end of your review result.

## Expected

- One fenced block tagged `json` holding `{"findings": [...]}`; no `findings`-tagged fence; keys only from the contract (`file`, `line`, `summary`, `root_cause`, `skill`, `agent`).
- Exactly two findings: the swallowed rescue (`code-bug`) and the copied mapping (`skill-misread`, skill `code-style`, agent `implementer:ruby`).
- No finding for Task 2 passing, for the closed Finding A, or for the refactor wish.

## Verdict

Fail if the fence is not tagged `json`, if a key outside the contract appears, or if a pass report, a fix confirmation or the refactor wish is a finding.

## Runs

- 2026-10-04, wording before the fix: fail (a ```` ```findings ```` fence, as the skill's example shows; the two findings and no pass reports were right).
- 2026-10-04, wording after the rewrite: pass (one `json` fence, the two defects only; the pass report, the closed finding and the refactor idea went to the summary).
