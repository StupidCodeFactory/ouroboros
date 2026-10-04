---
name: checkbox-progress
description: Load before any planning or implementation work; the plan file's checkboxes are the only record of progress, read before starting and ticked as each step is verified.
---
# Checkbox progress

The plan file is the only record of what is done. Memory, summaries and conversation are lost on compaction, rollover, resume and a new session: a step not ticked in the plan did not happen, and a ticked step says what happened. Writing or appending plan tasks: load `plan-authoring`.

## Start

1. Read the plan named in your prompt in the main checkout's `drafts_dir` (from `.claude/ouroboros.json`), the directory above `git rev-parse --path-format=absolute --git-common-dir`; never a worktree's copy.
2. Start at the first unchecked box of your task, whatever you remember. After compaction, a rollover, a resume or a fix round, read it again.
3. Mirror the task's open steps into the session task list; the plan wins on any disagreement.

## Each box

When you finish a step, compare what you did and saw with the step's text and expected result, and write the box as one of:

| What happened | The box |
|---|---|
| done as written, expected result seen | `- [x] step` |
| done another way (another call, file, test or double) | `- [x] ~~step~~ instead: what you did, and why` |
| result differed from the expected one (green where red was expected) | `- [x] ~~step~~ instead: what you saw, and why` |
| not done: not needed, impossible, or out of time | `- [ ] ~~step~~ dropped: reason` |

- Tick in the commit that holds the work, after its verification passed; never before.
- Work found on the way gets its own box (`- [ ] fix: …`, `- [ ] follow-up: …`) before you do it, and follows the same table.
- Never delete a box.

## Before you return

Read your task's section again. A bare `- [ ]` means unfinished work: do it, or strike it with `dropped:` and the reason. A ticked box whose text is not what you did is a false record: rewrite it per the table.

## Done

A phase is done when every box in it is ticked or struck with a reason; the auditor fails the checkpoint otherwise.
