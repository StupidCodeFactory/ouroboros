---
name: plan-authoring
description: Load before writing or appending tasks to a plan file, and before returning a plan; task and step format, and the checks a plan passes before anyone implements it.
---
# Plan authoring

## Format

- A task heading is `### Task <id>: <title> (PN)`; `(PN, <lane>)` pins its lane. Ids are unique: number up from the highest id already in the plan.
- Every step is a `- [ ]` box naming its verification: the command and the result it expects.
- No task holds a checkpoint step. The phase workflow makes the `phase(PN):` checkpoint commit after every task of the phase is done; a box for it inside a task can never be ticked by that task and stalls the phase.

## Before you return the plan

Read every task once more and fix each that fails one of these:

1. A path a step moves, renames or deletes is named by its new path in every later step and Files list.
2. A step expects red only for behaviour that does not exist yet; tests for existing code expect green.
3. A behaviour change is never labelled a refactor: it gets a spec of the new behaviour first. "No spec edits" is for refactors only.
4. A step prescribes nothing that already exists (a helper, a constant, a test of the same behaviour): search first and name the existing one to reuse.
5. A snippet agrees with the acceptance spec it serves (status codes, keys, error behaviour).
6. A verification can fail when the claim is false: it exercises the case the step claims (a non-200 for "fails loudly"), not one that passes either way.
7. A done-bar is the task's goal (no offense left, the count named), never a relative one ("fewer offenses").
8. An expected output is what the command prints in this repository today, after the step.
9. A claim about another task ("turns green here") holds in plan order: everything it needs lands in this task or an earlier one.
