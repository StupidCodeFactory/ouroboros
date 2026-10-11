# 0001 One sub-issue is one run and one PR
Status: Proposed
Date: 2026-10-10, revised 2026-10-11 / Milestone: sections and verified gates / Deciders: user, architect

## Context
Users typed milestone and phase ids (`M8`, `P19`), every task heading carried a phase tag, and a milestone cost three runs (kickoff, phase, exit). The first draft made a plan file's `##` heading the unit of work; the second made it a Phase group of a milestone's sub-issues. Walking the flow end to end showed the Phase group added a field, a grouping rule and a section contract on top of sub-issues that already carry their own contract and dependencies.

## Decision
The unit of work is one sub-issue: one workflow run, one PR that closes it. Order comes only from its Depends on section; the next sub-issue is the lowest-numbered open one whose dependencies are closed. There are no phases or sections, and no Phase field. The milestone stays as the issue that groups sub-issues (0006): kickoff plans it, and exit is a hook check that closes it.

## Alternatives
- A `##` heading of the plan file: the plan file is gone (0005).
- A Phase group of sub-issues per run: a second grouping beside dependencies, and a contract that repeats the sub-issues.
- One PR per milestone: too large to review.

## Consequences
Each sub-issue pays a run's fixed costs (branch, review, PR), so kickoff sizes sub-issues as one coherent change. Sub-issues of one milestone run one at a time.
