---
name: checkbox-progress
description: Load before any planning or implementation work; the plan file's checkboxes are the only record of progress, read before starting and ticked as each step is verified.
---
# Checkbox progress

The plan file is the single source of truth for what is done. Conversation memory, agent memory and summaries are not: they are lost on compaction, rollover, resume and a new session. A step not ticked in the plan did not happen.

## Writing a plan

- Every task and every step is a checkbox: `- [ ]`. A task heading carries its steps as nested boxes.
- A task heading is `### Task <id>: <title> (PN)`; the trailing `(PN)` is the phase the task belongs to. A plan whose headings carry no phase tag is a single phase.
- Each step names its verification (the command to run and the expected result), so ticking it has a clear bar.
- Each phase ends with a box for its checkpoint commit.

## Before starting work

1. Read the plan file named in your prompt (or under `drafts_dir` from `.claude/ouroboros.json`). Drafts live in the main checkout's `drafts_dir`, the directory above `git rev-parse --path-format=absolute --git-common-dir`; never read or edit a worktree's copy.
2. Find the first unchecked box in your phase. That is where you are, whatever you remember.
3. Mirror that task's unchecked steps into the session task list so they stay visible while you work. The plan file still wins on any disagreement.

## While working

- Tick a box (`- [x]`) right after its verification passes, in the same commit as the work it covers.
- Never tick a box without its verification evidence. A failing step stays unchecked.
- Work discovered on the way becomes a new unchecked box under the current task (`- [ ] fix: …`, `- [ ] follow-up: …`) before you do it. Never do untracked work.
- Never delete an unchecked box. Work that is dropped is struck through with the reason: `- [ ] ~~step~~ dropped: reason`.

## After a break

After compaction, a memory rollover, a resume or a fix round, re-read the plan and restart from the first unchecked box. Never resume from a summary alone.

## Done

A phase is done only when every box in it is ticked or struck through with a reason. The auditor counts unchecked boxes in the phase and fails the checkpoint if any remain.
