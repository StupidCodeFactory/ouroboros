# Ouroboros: the GitHub milestone loop

Status: draft, 2026-10-11. Replaces `2026-10-10-sections-and-verified-gates.md` and ADRs 0001 to 0008.

## 1. What it does

A GitHub project board drives all work. A PRD names the milestones. An architect turns a milestone into sub-issues; each sub-issue holds an implementation plan and a checklist of verifiable items. The loop then works the sub-issues one at a time: implement, review, fix until the reviewer is satisfied, done, next.

Nothing else ships. No plan files, phases, retros, incidents, eager skills, ADR scribe, skill curator, cheat stage or rollover.

## 2. The board

One GitHub project with a single-select `Status` field and five columns (names configurable):

| Column | Holds |
|---|---|
| Milestones | milestone issues |
| Planned | sub-issues ready or waiting |
| In Progress | the sub-issue being implemented or fixed |
| QA | the sub-issue under review |
| Done | sub-issues the reviewer accepted |

One label, `needs-owner` (configurable), marks an issue waiting on the human.

Config: `.claude/ouroboros.json`, key `github` (`repo`, `project`, `status_field`, `columns`, `labels`), plus `prd` (default `docs/prd.md`).

## 3. Issue shapes

Milestone issue body: `## Goal`, `## Brief`, `## Acceptance`.

Sub-issue body:

```
## Goal
<one paragraph>

## Plan
<steps>
Files: `path/a`, `dir/**`

## Checklist
- [ ] <what holds>: `<command that passes once it holds>`

## Depends on
none | #12, #13
```

A sub-issue is **ready** when every section is present, the plan ends in a non-empty `Files:` line, the checklist has at least one item, and every item names a command.

## 4. The loop

Only the plugin hook writes GitHub: issue bodies, ticks, comments, labels, columns, PRs. Agents read and code; they return structured results.

1. **Kickoff** `/ouroboros kickoff <milestone-issue>`. The hook reads the milestone's PRD section and offers the architect stage. The architect returns the milestone body and the sub-issues. The hook writes the body, creates or updates the sub-issues, closes dropped ones as not planned, and puts every open sub-issue in Planned. A rerun revises rather than duplicates.
2. **Start** `/ouroboros start <milestone-issue>`. The hook picks the lowest-numbered sub-issue in Planned whose dependencies are Done or closed.
   - If it is not ready (section 3), the hook labels it `needs-owner`, comments what is missing, and stops. The human fixes the issue, removes the label and runs `start` again.
   - Otherwise the hook reuses the issue's linked branch or creates one with `gh issue develop`, checks it out in the session's checkout (refusing uncommitted changes on another branch), moves the sub-issue to In Progress and offers the implement stage.
3. **Implement**. The implementer works in the session's checkout on branch `work/<n>-<slug>`, following the plan and making each checklist command pass. It returns the branch and head commit, or a blocker (a question for the human).
   - Blocker: the hook labels `needs-owner`, comments the question, stops.
   - Done: the hook moves the sub-issue to QA and offers the review stage on the same branch.
4. **Review**. The reviewer runs every checklist command in the checkout and reads the diff against the plan. It returns, per checklist item, pass or fail with evidence, plus a list of defects.
   - The hook ticks every item that passed and unticks any that failed.
   - All pass, no defects: the hook pushes the branch, opens a PR with `Closes #<n>`, moves the sub-issue to Done, and starts the next sub-issue (step 2).
   - Otherwise: the hook comments the failed items and defects on the sub-issue, moves it back to In Progress, and spawns the implementer again with the defects. After 3 review rounds without acceptance, it escalates (`needs-owner`, comment) and stops.
5. **End**. When no sub-issue is left in Planned, the hook reports the milestone finished and stops.

Commands: `kickoff <n>`, `start <n>`, `status`, `stop`.

## 5. Code

| Path | Role |
|---|---|
| `hooks/register.ts` | the `/ouroboros` command, stage launches and their results, GitHub and git IO, the prompt header |
| `hooks/loop.ts` | pure rules: next ready sub-issue, readiness, branch names, review outcome and ticks |
| `hooks/prompts.ts` | the brief of each stage |
| `workflows/stage.js` | the one stage workflow: the stage's agent on its brief, answering to a schema |
| `hooks/github/` | board ids, gh commands, issue body parse and render, kickoff diff |
| `agents/` | `architect`, `implementer`, `reviewer` |

A hook cannot launch a workflow itself, so the hook writes the stage's brief to `.claude/ouroboros/briefs/`, keeps the launch in its state and submits one plain line, `ouroboros: next, <stage> #<n> round <r>. Launch it: Workflow name=ouroboros:stage`. The session calls the Workflow tool; the hook substitutes the stage's arguments, records the task id and refuses a second launch while one runs. When the task notification arrives, the hook reads the workflow's result from its output file, applies it, swallows the notification and reports one plain line. A missing result escalates. State lives in `.claude/ouroboros/state.json`; there are no worktrees.

## 6. Branches and PRs

The first sub-issue branches from the default branch. When a sub-issue is accepted, its branch becomes the stack tip: the next sub-issue branches from the tip while the tip's PR is still open, and its PR targets the tip. Once the tip's PR is merged, the next one branches from the default branch again. The human merges the stack in order; the loop never waits on a merge.
