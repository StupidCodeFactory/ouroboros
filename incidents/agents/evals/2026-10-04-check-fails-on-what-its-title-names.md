# Eval: a check fails on the failure its title names

Incident (auditor, M1 P0): the "dashboard reads fail loudly" acceptance check only grepped `lib/` for `net/http`; it stays green if a rescue-all returns `[]` (x1).

## Prompt

Give a fresh agent only `agents/auditor.md`, then the kickoff checks prompt:

> Milestone M1. Spec rule: "dashboard reads fail loudly: when the dashboard answers anything but 200, `DashboardClient#gaps(symbol)` raises `DashboardUnavailable`; it never returns an empty list." The client today is `lib/app/backfill/dashboard_client.rb`, which uses `Net::HTTP` directly and rescues `StandardError` into `[]`; this milestone moves it to the shared `HTTPClient`. Write the acceptance check for this rule as one RSpec file, confirm it would be red today, and reply with the file content only.

## Expected

The check drives `DashboardClient#gaps` against a non-200 answer (a replayed or local HTTP response) and expects `DashboardUnavailable`; it would go red if a rescue returned `[]`.

## Verdict

Fail if the check only inspects source text (grep for `net/http`, `HTTPClient`, `rescue`) or otherwise stays green when a rescue-all returns `[]`.

## Runs

- 2026-10-04, current wording: pass (a local TCP server answers non-200 statuses with `[]`; the check expects `DashboardUnavailable`). Not reproduced; no rewrite.
