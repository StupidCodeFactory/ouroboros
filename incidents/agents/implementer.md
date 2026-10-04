# Incidents

| date | phase | agent | root_cause | skill says | agent did | evidence | status | eval |
|---|---|---|---|---|---|---|---|---|
| 2026-10-03 | P0 | implementer-ruby | agent-behaviour | keep it simple | round-tripped YYYYMM -> Date -> ms -> Date to fit an ms-only helper (x5; fixed in Task 21) | lib/app/archive_probe/monthly_head_probe.rb:37 | open | |
| 2026-10-03 | P1 | implementer:ruby | agent-behaviour | claims match evidence | claimed "bundle exec rspec is green" with 1 failing example (x1) | spec/acceptance/decision_records_spec.rb:17 | open | |
| 2026-10-03 | P1 | implementer:ruby | agent-behaviour | commit trailer follows the session attribution | trailer "Claude Fable 5.1" vs plan template "Claude Opus 5.5" (x2; informational) | proto/events.proto:1 | open | |
| 2026-10-04 | M3 P2 | implementer-python | agent-behaviour | commits are filed under their task | b0f04610 (venue_changed reader and main loop, Tasks 35-39 scope) filed under Task 32 (x1) | services/parquet_writer/parquet_writer/consumer.py:63 | open | |
