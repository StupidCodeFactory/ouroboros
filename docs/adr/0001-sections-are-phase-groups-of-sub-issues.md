# 0001 A section is one Phase of a milestone's sub-issues
Status: Proposed
Date: 2026-10-10, revised 2026-10-11 / Milestone: sections and verified gates / Deciders: user, architect

## Context
Users typed milestone and phase ids (`M8`, `P19`), every task heading carried a phase tag, and a milestone cost three runs (kickoff, phase, exit). Most milestones had one or two phases, so the split added steps without adding safety. The milestone owned the acceptance checks and the phase owned a PR; users could not tell the two apart. The first draft made a plan file's `##` heading the section; once the issues replaced the plan file (0005), the milestone issue and its sub-issues became the structure to build on.

## Decision
A section is the open sub-issues of one milestone issue that share a Phase: one workflow run, one PR. The user types only issue numbers; kickoff sets the Phase values, and they show on the board and in sub-issue bodies. The milestone stays as the issue that groups sections (0006): kickoff plans it, and exit is a hook check that closes it, no longer a workflow. The phase and milestone-exit workflows retire.

## Alternatives
- A `##` heading of the plan file as the section: the plan file is gone (0005).
- Keep milestones, drop phases: one PR per milestone is too large for most milestones.
- Keep kickoff, phase and exit as three workflows with hidden ids: same three runs per milestone.

## Consequences
Acceptance checks split: per section in its contract (0002), per milestone in the milestone body (0006). Phase ids still exist, but only kickoff writes them.
