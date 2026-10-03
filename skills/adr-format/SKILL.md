---
name: adr-format
description: Load when writing, updating or pruning Architecture Decision Records under the project's adr_dir.
---
# ADR format

ADRs replace specs and plans as the durable record. Specs and plans under `drafts_dir` are working drafts; once a milestone merges, its ADRs hold everything worth keeping and the drafts are pruned. Read `adr_dir` and `drafts_dir` from `.claude/ouroboros.json`.

Write one ADR per decision area at `<adr_dir>/NNNN-<slug>.md` (zero-padded four-digit sequence) and regenerate `<adr_dir>/README.md` as the index (number, title, status, milestone).

## Template

```
# NNNN Title
Status: Proposed | Accepted | Superseded by NNNN
Date / Milestone / Deciders (agents and user)
Context        why the decision was needed (from the spec)
Decision       what was chosen (from the spec)
Alternatives   what was rejected and why
Implementation how it was built: phases, tasks, key files, interfaces (from the plan)
Verification   success rules and milestone checks it is held to, with evidence links
Outcome        what shipped, milestone PR, deviations from the plan and why
Consequences   what it costs, what it enables
```

## Rules

- Never edit an `Accepted` ADR in substance; write a new ADR that supersedes it and set the old one to `Superseded by NNNN`.
- The architect's design brief carries a `decisions` JSON block (`[{title, context, decision, alternatives, consequences}]`); open one `Proposed` ADR per entry.
- While an ADR is `Proposed`, spec and plan edits update its Context, Decision and Implementation.
- On milestone merge fill Outcome and Verification and set `Accepted`.
- Prune drafts only after `Accepted` and only after the auditor's coverage check passed (every spec section and plan task of that milestone is reflected in an ADR). Never prune on a failed coverage check.
