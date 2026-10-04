# Incidents

| date | phase | agent | root_cause | skill says | agent did | evidence | status | eval |
|---|---|---|---|---|---|---|---|---|
| 2026-10-03 | P0 | auditor | agent-behaviour | the check pins its title | "dashboard reads fail loudly" acceptance spec only greps lib/ for net/http; stays green if a rescue-all returns [] (x1) | spec/acceptance/dashboard_reads_spec.rb:8 | open | incidents/agents/evals/2026-10-04-check-fails-on-what-its-title-names.md; not reproduced on current wording |
| 2026-10-03 | P0 | auditor | agent-behaviour | memory points at live paths | auditor memory open-task line names renamed spec files (x1) | .claude/agent-memory/auditor.md:13 | fixed | 8b2bf9b (the curator prunes agent memory that points at gone files) |
