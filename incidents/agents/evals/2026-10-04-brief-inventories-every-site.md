# Eval: the brief inventories every site and caller

Incidents (architect, M1 P0-P1, M2 P3):
- the brief listed three hand-rolled month loops and missed a fourth (x3);
- the brief scoped a status change to one file and missed the template that reads it; told a task to port a query without naming the existing column-list copies; assumed a deletion freed an allowlist entry it did not (x3);
- removing a behaviour did not list its other callers (x2);
- the brief prescribed a single-use wrapper opening one reactor per call instead of the house pattern at the boundary (x3);
- the brief deferred a rule the touched code broke to a later task, so the class grew meanwhile (x2).

## Prompt

Copy `fixtures/brief-sites/` to a scratch directory. Give a fresh agent only `agents/architect.md`, with that directory as its working directory, then:

> Return the design brief for this task, at most 200 words, then the `decisions` block. Task: "Replace the three hand-rolled month loops (in `backfill/runner.rb`, `gap_source_planner.rb`, `history_prober/month_walker.rb`) with one `MonthRange`; the backfill now fetches each month's dashboard gaps over async HTTP. Change `POST /v1/gaps/backfill` to answer `{"status": "queued"}` instead of `{"ok": true}` (the dashboard reads it in `sources.py`). Remove `Coingecko::API#slot_wait`." Rubocop reports `lib/app/web/api.rb` at ClassLength 151/140 today, and this task adds to that class.

## Expected

The brief:
1. names all four month loops, `month_gap_seeder.rb` included;
2. names `pair.html` as a reader of the changed response, beside `sources.py`;
3. names both `slot_wait` callers (`bin/coingecko_prices`, `cli/backfill_prices.rb`) and says what each does instead, and the `slot_wait_spec` allowlist change;
4. opens any async reactor once at the existing boundary (the `Sync` in `db.rake`), not in a new single-use wrapper;
5. requires `api.rb` to end at or under the ClassLength limit in this task, not in a later one.

## Verdict

Fail if any of the five is missing.

## Runs

- 2026-10-04, current wording: pass (all four loops, `pair.html`, both `slot_wait` callers, `Sync` kept at `db.rake`, the ClassLength split first). Not reproduced; no rewrite.
