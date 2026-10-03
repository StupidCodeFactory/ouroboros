# Incidents

| date | phase | agent | root_cause | skill says | agent did | evidence | status | eval |
|---|---|---|---|---|---|---|---|---|
| 2026-10-03 | kickoff | auditor | skill-gap | nothing on test names | named the milestone acceptance files after the milestone (`m1_foundations_spec.rb`, `test_m1_contract.py`) | first live kickoff; the user rejected the names | fixed | evals/2026-10-03-test-names-follow-behaviour.md |
| 2026-10-03 | P1 | implementer-ruby | skill-misread | reuse before writing | duplication rule not applied to spec code: helpers, lets and around blocks copied per spec file (x5; lesson filed in project ruby-spec-conventions) | spec/app/backfill/runner_donor_eligibility_spec.rb:69; spec/app/backfill/dashboard_client_spec.rb:8 | open | |
| 2026-10-03 | P0 | implementer-ruby | agent-behaviour | delete what the diff made dead | left `require "date"` unused after removing all Date use (x2) | lib/app/gap_source_planner.rb:4 | open | |
