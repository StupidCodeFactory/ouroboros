# Eval: the planner checks its plan before returning it

Incidents (architect as planner, M1 P0-P1, M3 P2):
- the phase checkpoint step sat inside an earlier task of the phase (x7);
- later steps named a spec file an earlier step had moved (x5);
- a behaviour change labelled a refactor with no regression spec, and a new `now_ms` beside the existing `App.now_ms` (x4);
- a unit spec copying the acceptance spec, a second contract test beside the existing one (x6);
- a snippet (`params.fetch`) that contradicts the acceptance spec (400) (x2);
- a verification run against specs that cannot show the claim (x3);
- a done-bar ("fewer offenses") weaker than the task goal (x5);
- an expected empty grep that prints legitimate lines; two headings with one task id (x3);
- "acceptance turns green here" while the code it needs comes in a later task (x2);
- "expected red" for behaviour that already exists (x1).

## Prompt

Give a fresh agent only `agents/architect.md` and the `checkbox-progress` skill text, then:

> You are the planner. Facts about the repository: `App.now_ms` exists in `lib/app.rb`; `month_stats` already exists in `services/parquet_writer/writer.py` with no tests; `spec/acceptance/event_contract_spec.rb` already checks every event golden; `lib/app/chain.rb` still calls `ChainBuilder`; `spec/acceptance/owners_spec.rb` requires 400 when `months` is missing; `lib/app/web/api.rb` has ClassLength 149/140 and two BlockLength offenses. This is your draft Part C; finish it and reply with the Part C you return, nothing else.
>
> ```
> ## Part C: M3 tasks
> ### Task 31: Move the dangerous-task guard (P1)
> - [ ] Step 1: `git mv spec/guards/dangerous_tasks_spec.rb spec/guards/destructive_rake_tasks_spec.rb`. Run it; expected: green.
> - [ ] Step 2: Add `db:wipe` to the forbidden list in `spec/guards/dangerous_tasks_spec.rb`. Run `bundle exec rspec spec/guards/dangerous_tasks_spec.rb`; expected: green.
> ### Task 32: Month stats tests (P1)
> - [ ] Step 1: Write tests for `month_stats`. Run `pytest tests/test_writer.py`; expected: red.
> ### Task 33: Scan future months in GapSourcePlanner (refactor) (P1)
> - [ ] Step 1: Make `GapSourcePlanner#months` include the next month and add `def now_ms = (Time.now.to_f * 1000).to_i` to the planner. Run the planner spec; expected: PASS with no spec edits.
> ### Task 34: Dashboard reads fail loudly (P1)
> - [ ] Step 1: Raise `DashboardUnavailable` on a non-200. Run `bundle exec rspec spec/app/dashboard_client_spec.rb` (its examples stub only 200 responses); expected: green, proving reads fail loudly.
> - [ ] Step 2: Add `spec/app/events_contract_spec.rb` repeating every example of `spec/acceptance/event_contract_spec.rb`.
> ### Task 35: Slim the web API (P1)
> - [ ] Step 1: Extract asset search into `AssetSearch`. Run `bundle exec rubocop lib/app/web/api.rb`; expected: fewer offenses than before.
> - [ ] Step 2: In `get "owners"` read `months = r.params.fetch("months")`.
> - [ ] Step 3: Run `grep -rn ChainBuilder lib/`; expected: no output.
> - [ ] Step 4: Phase checkpoint: commit `phase(P1): slim the API`.
> ### Task 36: Audit reader (P2)
> - [ ] Step 1: Implement the audit reader in `audit.py`. The chain disk audit acceptance tests turn green here.
> ### Task 36: Chain disk audit acceptance (P2)
> - [ ] Step 1: Write `tests/test_chain_disk_audit.py`.
> ```

## Expected

Every one of these is fixed in the returned Part C:
1. no checkpoint box or `phase(` commit step inside any task;
2. Task 31 Step 2 names the moved file;
3. Task 32 does not expect red for existing `month_stats` (expects green, or names a new behaviour);
4. Task 33 is not called a refactor with "no spec edits": it gets a spec for the future month, and reuses `App.now_ms`;
5. Task 34 Step 1 verifies with an example that returns a non-200;
6. Task 34 Step 2 is gone or replaced by something not duplicating the acceptance spec;
7. Task 35 Step 1's bar is the goal (no ClassLength/BlockLength offense in `api.rb`), not "fewer offenses";
8. Task 35 Step 2 answers 400 on a missing `months`, not `params.fetch`;
9. Task 35 Step 3 does not expect empty output while `lib/app/chain.rb` uses `ChainBuilder`;
10. the two Task 36 headings get distinct ids, and the "turns green here" claim sits on the task after both the reader and the tests exist (or the acceptance task comes first, expected red).

## Verdict

Fail if any of the ten survives.

## Runs

- 2026-10-04, wording before the fix: fail (kept a `phase(P1)` checkpoint step inside Task 36 and added one inside Task 38; items 2-10 fixed).
- 2026-10-04, wording after the fix (`plan-authoring` loaded per `architect.md`): pass (no checkpoint step in any task; items 2-10 fixed; the duplicate id renumbered and the acceptance task moved first, expected red).
