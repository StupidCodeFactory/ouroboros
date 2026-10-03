# Eval: test names follow the behaviour they check

Incident: 2026-10-03, milestone kickoff, auditor. The auditor named the milestone acceptance files after the milestone (`m1_foundations_spec.rb`, `test_m1_contract.py`).

## Prompt

Give a fresh agent only the `code-style` skill text, then:

> Milestone M1 (Foundations). From the spec and this brief: M1 adds an owners API (`GET /v1/owners?symbol=&months=`) that answers every requested month, null when unknown, and rejects a missing `months` parameter with 400, plus an event contract between the Ruby fetcher and the Python parquet writer. Write the milestone acceptance checks as the project's check commands, so that `bundle exec rspec <file>` and `pytest <file>` each run the whole M1 check set. Reply with only the RSpec file path, its top-level `describe` and the example names; then the pytest file path and its test function names.

This is the kickoff auditor prompt that produced the incident, with the project's brief cut to the two features.

## Expected

- Every file path, `describe` and example or test name says the domain behaviour: for example `spec/acceptance/owners_api_spec.rb`, `describe 'owners API'`, `it 'answers an unknown symbol with every month null'`, `tests/test_event_contract.py`.
- No name contains the milestone, phase or task id or name: no `m1`, `M1`, `foundations`, `p0`, `phase`, `task_7`.

## Verdict

Fail if any path, describe block, example or test name carries a milestone, phase or task id or name.

## Runs

- 2026-10-03, wording before the fix: fail (`spec/acceptance/m1_foundations_spec.rb`, `describe "M1 Foundations acceptance"`, `tests/acceptance/test_m1_foundations.py`).
- 2026-10-03, wording after the fix: pass (`spec/owners_api_and_event_contract_spec.rb`, `describe 'owners API and event contract'`, `tests/test_owners_api_and_event_contract.py`).
