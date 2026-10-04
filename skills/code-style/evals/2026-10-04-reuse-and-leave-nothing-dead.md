# Eval: reuse what exists and leave nothing dead

Incidents (code-style, implementer, M1 P0-P1, M2 P3, M3 P2):
- reuse before writing not applied: spec helpers and lets copied per spec file (x5); second copies of a row mapping, `blank_to_nil`, a column list, an error check and a constant (x9);
- dead code left behind: an unused `require "date"` (x2); unused methods, no-op config, one-line forwarders (x6);
- implementer, M1 P0: a month round-tripped YYYYMM, Date, ms and back to fit a helper (x5).

## Prompt

Copy `fixtures/reuse-and-dead-code/` to a scratch directory. Give a fresh agent only the `code-style` skill text, with that directory as its working directory, then:

> Lane ruby. Do both, then reply with the full content of every file you create or change:
> 1. Add `App::HealEnqueuer#candidates(month)`: the listings with no gap row for that month, as `Listing` objects, selected the way `GapBackfill#missing` does; and its spec `spec/app/heal_enqueuer_spec.rb`, whose example stubs the dashboard gaps for one symbol.
> 2. In `App::GapSourcePlanner#current_month`, take the time from the injected clock (`@clock.now_ms`, epoch milliseconds, UTC) instead of `Date.today`.

## Expected

- No second copy of the column list, the row-to-`Listing` mapping or `blank_to_nil`: they are shared with `GapBackfill` (extracted on this second use) or called where they live.
- The spec uses `stub_dashboard_gaps` from `spec/support`, not a new stub.
- `gap_source_planner.rb` no longer requires `date`, and computes the month straight from the milliseconds (`Time.at(ms / 1000).utc`), with no Date detour.
- No one-line forwarder or unused method is added.

## Verdict

Fail if any copy of the column list, mapping, `blank_to_nil` or dashboard stub appears, if `require "date"` survives, or if the month goes through `Date`.

## Runs

- 2026-10-04, current wording: pass (called `GapBackfill#missing`, reused `stub_dashboard_gaps`, dropped `require "date"`, month from `Time.at(ms, :millisecond).utc`).
- 2026-10-04, current wording, brief slice that names the columns but not `GapBackfill`: pass (found and called `GapBackfill#missing`, reused the stub). Not reproduced in a small repository; no rewrite.
- 2026-10-04, current wording, on the implementer's own model, both changes: pass (delegated to `GapBackfill#missing`, reused the stub, dropped `require "date"`, month from `Time.at(ms / 1000).utc`). Not reproduced; no rewrite.
