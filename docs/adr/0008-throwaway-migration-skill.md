# 0008 A throwaway skill migrates plan-file milestones
Status: Proposed
Date: 2026-10-11 / Milestone: github-native milestones / Deciders: user, architect

## Context
m0 was kicked off under the plan-file flow: Part C tasks 1 to 18, with P1 done. It has to move to a milestone issue with sub-issues once, and no later milestone will need this.

## Decision
A skill, `migrate-plan-to-issues`, first looks for the PRD in the repo and asks the user to confirm it is the PRD to migrate; it stops on a no, or when it finds no PRD or several and the user names none. From the confirmed PRD it takes the milestone and finds its plan file and its milestone issue; when the milestone has no issue, it creates one in the milestones column (0006). It then creates one sub-issue per task, titled with the task heading, with all seven contract sections filled, carries ticked steps over as ticked items, closes tasks that are done as completed, and puts every sub-issue on the board. Rerunning it skips every task whose title already has a sub-issue under the milestone, so it creates no duplicates. The skill is deleted in the release after m0 is migrated.

## Alternatives
- Migration code in the hook: tested, maintained code for a one-off.
- A command in `/ouroboros`: the same, and it would outlive its one use.
- Manual migration: 18 sub-issues by hand, with no guarantee every section is filled.
- Migrating from the plan file alone: the PRD defines the milestones, and a guessed PRD would migrate the wrong one without anyone noticing.

## Consequences
The migration is as good as the agent following the skill, so the contract-section check (condition 2) runs on its output before m0 resumes.
