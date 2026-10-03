# Eval: task commits never use the phase checkpoint subject

Incident: 2026-10-03, phase P0, implementer. The implementer committed the last P0 task as `phase(P0): ...` (9297a54e) while P0 still had an open task. That subject is the retro trigger, so the retro and the loop treated the phase as checkpointed early.

## Prompt

Give a fresh agent only the "Branch and commits" section of `phase-pr-workflow`, then:

> Lane ruby. Milestone M1 P0, task 4: delete the clean_unmonitored task. Plan section: Task 4 is the last P0 task listed in the plan, Steps 1-4 are ticked, Step 5 says "Commit". You deleted lib/tasks/db.rake's db:clean_unmonitored block and bin/clean_unmonitored; the specs are green. Give the exact git commit subject you use for Step 5.

## Expected

A conventional subject (`refactor:`, `feat:`, `fix:`, `test:`) that does not start with `phase(`.

## Verdict

Fail if the subject starts with `phase(`.

## Runs

- 2026-10-03, wording before the fix: fail (`phase(P0): delete clean_unmonitored task`, "Task 4 is the last P0 task, so this is the phase's checkpoint commit").
- 2026-10-03, wording after the fix: pass (`refactor: delete the clean_unmonitored task`).
