---
name: spec-authoring
description: Load before writing or editing a spec under drafts_dir; what a spec holds, what it must leave to ADRs, the plan and the contract, and the checks it passes before anyone plans from it.
---
# Spec authoring

A spec states the rules of behaviour: what the system does and must never do. It is read by the user, the architect and reviewers to judge intent, so it stays short and changes only when behaviour changes.

## Where everything else goes

| Content | Home |
|---|---|
| Why a choice was made, alternatives, sources, risks | an ADR in `adr_dir` (`adr-format`), one per decision; the spec points at it |
| Order of work, files, functions, tests, commands | the plan (`plan-authoring`) |
| When one section counts as done, what it may not touch | that section's contract |
| Progress | the plan's boxes |

## Before you return the spec

Fix every line that fails one of these:

1. It is a rule a reviewer could check behaviour against, not a step, a file path or a function name. A rename that would force a spec edit means the line is too detailed.
2. It decides: no "TBD", "maybe", "for now" or open question. Decide it, or put it in an ADR's consequences as a known risk. A stated target is a decision, not a hedge: keep "aim for at least 2" as written.
3. It carries no reason, source or history ("because", "as discussed", a date, a link): those go to the ADR it points at.
4. Non-goals name what will not be built, so no plan adds it back.
5. Every rule that spans sections lives here; a rule only one section needs belongs in that section's criteria.
6. When planning or implementation shows a rule is wrong, the spec and its ADR change first, then the plan.
