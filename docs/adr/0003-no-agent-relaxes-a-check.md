# 0003 No agent relaxes a check; it escalates with proposals
Status: Proposed
Date: 2026-10-10 / Milestone: sections and verified gates / Deciders: user

## Context
Agents tend to loosen a clause to reach their goal: narrow an assertion, skip a test, widen scope. A gate is only as strong as its weakest check.

## Decision
After the `checks(<slug>)` commit, checks and contract are frozen. A weak check, or an agent that wants one changed, stops the run and escalates to the user: the problem, the evidence, and 1 to 5 proposals (aiming for at least 2), each with cost and risk, one recommended. Only the user's answer amends the contract, recorded in its `amendments` and committed as `contract(<slug>)`. The `checks(<slug>)` commit itself is the fingerprint: the gate diffs check files and contract from it to HEAD.

## Alternatives
- Reviewer-only policing: advisory, not enforced.
- A hash store for fingerprints: redundant with the commit.
- Automatic fix rounds after a red final gate: rejected by the user; a red gate stops at once.

## Consequences
A genuinely broken check costs one user answer. Every relaxed check has a dated amendment and an ADR entry, so weakening is auditable.
