# 0001 Sections replace milestones and phases
Status: Proposed
Date: 2026-10-10 / Milestone: sections and verified gates / Deciders: user, architect

## Context
Users typed milestone and phase ids (`M8`, `P19`), every task heading carried a phase tag, and a milestone cost three runs (kickoff, phase, exit). Most milestones had one or two phases, so the split added steps without adding safety. The milestone owned the acceptance checks and the phase owned a PR; users could not tell the two apart.

## Decision
A plan's `##` heading with checkbox tasks is a section: one workflow run, one PR. No ids are typed or shown; branch and PR title come from the heading. Old `M`/`P` headings are read as sections.

## Alternatives
- Keep milestones, drop phases: still two layers for one unit of work.
- Keep both, hide the ids: same three runs per milestone.

## Consequences
Kickoff, phase and exit workflows retire. Acceptance checks move from milestone to section, which needs the per-section contract (0002).
