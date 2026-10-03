# Incidents

| date | phase | agent | root_cause | skill says | agent did | evidence | status | eval |
|---|---|---|---|---|---|---|---|---|
| 2026-10-03 | P0 | auditor | agent-behaviour | the check pins its title | "dashboard reads fail loudly" acceptance spec only greps lib/ for net/http; stays green if a rescue-all returns [] (x1) | spec/acceptance/dashboard_reads_spec.rb:8 | open | |
| 2026-10-03 | P0 | auditor | agent-behaviour | memory points at live paths | auditor memory open-task line names renamed spec files (x1) | .claude/agent-memory/auditor.md:13 | open | |
