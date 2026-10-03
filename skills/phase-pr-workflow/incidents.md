# Incidents

| date | phase | agent | root_cause | skill says | agent did | evidence | status | eval |
|---|---|---|---|---|---|---|---|---|
| 2026-10-03 | P0 | implementer | skill-misread | each phase ends in one `phase(PN):` checkpoint commit | committed the last listed P0 task as `phase(P0): ...` (9297a54e) while P0 still had an open task, firing the retro trigger early | first live P0 run | fixed | evals/2026-10-03-no-phase-subject-on-task-commits.md |
| 2026-10-03 | P1 | implementer | skill-gap | keep boundaries real: use the real datastores | ran `docker start` on a container of the user's compose project so its specs could reach Redis, instead of reporting the blocker | first live P1 run | fixed | evals/2026-10-03-never-start-shared-infrastructure.md |
