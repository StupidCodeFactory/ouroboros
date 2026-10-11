# Verified gates and GitHub-native milestones

Date: 2026-10-11. Status: draft.

Decisions and their reasons: ADRs 0001 to 0008 in `docs/adr/`. This file holds only the rules.

## Goals

1. GitHub is where work is planned, tracked and closed. A milestone is one issue; each task is one sub-issue of it, and the sub-issue's body is its contract. There is no plan file.
2. One unit of work: one sub-issue, one workflow run, one PR.
3. A sub-issue cannot start implementing until every checklist item has a runnable check that is red for the right reason.
4. The plugin, not an agent, decides whether a sub-issue or a milestone is done, by running the checks itself, and it is the only writer of checklist ticks.
5. No agent may weaken a check or a contract. A weak or weakened check stops the run and asks the user, with 1 to 5 proposals (aim for more than one).
6. After the user merges a sub-issue's PR, the next ready sub-issue starts by itself. After the last one, the milestone closes once its acceptance checks pass.
7. No project-specific value appears in the plugin's code; every one comes from `.claude/ouroboros.json`, with defaults.

## Non-goals

- Auto-merging, or any change to `merge_policy`. The user's merge stays the only human gate.
- Automatic fix rounds after a failed final gate: a red gate stops at once.
- Re-running checks against reverted production code.
- Running several sub-issues of one milestone at the same time.
- Phases, sections, or a contract file beside the sub-issue.
- A plan file, or a local mirror of the issues.
- Editing any issue other than milestone issues and their sub-issues.
- Creating board columns, fields or labels: the project sets them up.
- Migration code in the plugin: a throwaway skill does it (section 12).
- Replacing the retro, incidents, eager skills, chains, handoffs or the review stage; they carry over unchanged unless named here.

## Design

### 1. Milestones

- A milestone issue is any issue in the board's milestones column. Ouroboros owns its body.
- The body has three `##` sections, in order: Goal, Brief, Acceptance. Acceptance is a `- [ ]` checklist; each item ends with `: ` and one command in backticks, which passes on exit 0.
- Kickoff writes the whole body. The owner changes a milestone by rerunning kickoff.
- The milestone's definition is the PRD section whose heading matches the issue title. No match stops kickoff and lists the headings found.

### 2. Tasks: the sub-issue is the contract

- Each task is one sub-issue of its milestone. The sub-issue's number is the task's identity.
- The body has seven `##` sections, in order, none empty:
  - **Goal**: the outcome in one or two sentences.
  - **Plan**: outside-in steps and the PRD sections to read, with one line `Files: ` listing, in backticks, every path or glob the task may change.
  - **Checklist**: `- [ ]` items, each ending with `: ` and one command in backticks that fails before the task and passes once the item holds.
  - **Completion condition**: `- ` items, each one command in backticks that must pass when the task is done, whether or not it passed before (the full suite, the linters).
  - **Stop conditions**: when to stop and escalate instead of continuing.
  - **Must not**: the forbidden list, from the brief and the project's guardrails.
  - **Depends on**: the sub-issues of the same milestone it needs closed first, as `#a, #b`, or `none`.
- Dependencies never form a cycle.
- The plugin never writes a sub-issue body that misses a section, leaves one empty, or has a checklist or completion item without a command.
- A milestone holds at most 100 sub-issues; a plan with more stops kickoff and asks the user to split the milestone.

### 3. Kickoff

`/ouroboros kickoff <issue>` plans or replans one milestone.

- It replaces the `milestone-kickoff` workflow: the architect plans, and no checks are written until a sub-issue starts.
- Refused while a run of that milestone is in flight, or when the issue is not in the milestones column.
- The architect reads the PRD section, the milestone body and every sub-issue, and returns the milestone body and the task list. Each task names the open sub-issue it revises, or none for a new task; a new task's dependencies may name another new task by its place in the list.
- A task list that names a closed sub-issue, an issue outside the milestone, or the same sub-issue twice, or that holds a contract gap or a dependency cycle, or a dependency on a sub-issue it drops, is rejected whole.
- The hook applies the list:
  - a task that revises an open sub-issue updates its title and body in place;
  - a new task becomes a new sub-issue of the milestone;
  - an open sub-issue the list does not name is closed as "not planned", with a comment saying kickoff dropped it;
  - a closed sub-issue is never reopened, edited or commented on.
- Every open sub-issue ends on the board in the planned column.
- The answer lists the sub-issues created, updated, dropped and left closed, by number.

### 4. Running a sub-issue

- The next sub-issue is the lowest-numbered open sub-issue in the planned column whose dependencies are all closed.
- The user types only issue numbers.
- Branch: `<branch_prefix><number>-<slug>` (default prefix `work/`), where the slug is the title lowercased, non-alphanumerics folded to `-`, cut to 50 characters; from the default branch's origin tip, in its own worktree. The PR targets the default branch, never another task's branch, and its title is the sub-issue title.
- Launching it moves the sub-issue to the in-progress column.

### 5. Checks red first (before any implementer runs)

1. The auditor, playing the skeptical evaluator, writes the checks each checklist command runs, and commits them alone as `checks(#<number>)`. That commit is the fingerprint.
2. The hook rejects the start, and the run escalates, when any of these holds:
   1. a checklist item's command exits 0: red for no reason;
   2. red for the wrong reason: the runner's output shows no example run or no assertion failure (a load error, syntax error, missing file, or zero examples). Per-runner patterns live in the plugin (rspec, pytest, jest/vitest, go test, the Claude Code plugin test runner) with a project override `red_patterns`;
   3. assertion lint on the check files: no assertion at all, assertions only of truthiness, nil or "raises nothing", the unit under test mocked, or a pending or skipped example. Per-language patterns in the plugin, extendable per project;
   4. a `Files:` line that is empty, or a project with no lane `test` command.
3. Cheat attempt: a fresh agent that did not write the checks gets the sub-issue and the checks and, in a throwaway worktree, tries to make them pass without meeting the items (hard-coded values, stubs, special-casing the fixture). It returns the diffs it tried. The hook runs the checklist commands on each diff; any that turns green on a cheat is weak, with that diff as evidence.
4. Coverage review: the same agent says, per checklist item, whether its check would catch the item being only partly met. Any "no" is weak.

### 6. No relaxing, and escalation

An agent may not, at any stage after the fingerprint:

- edit or delete a check file, or narrow an assertion;
- edit a sub-issue or milestone body;
- skip, filter or reconfigure the gate (`--only`, `-k`, tags, config edits that exclude files).

The hook enforces this on every agent `Edit`/`Write`/`Bash` that touches a fingerprinted file or an issue body: the call is refused with "contract change needs the user" and the agent is told to escalate.

An escalation is raised when the checks are rejected, when an agent's call is refused as above, when an agent hits the sub-issue's stop condition, or when an agent decides a check is wrong. It:

- stops the run (no further stages, nothing merged, auto-continue halted);
- is drafted by the agent that hit it and checked by the architect;
- reaches the user as one message: the problem (which item and check, why it is weak or why the agent wants it changed, the evidence: cheat diff, runner output, lint hit, refused call) and 1 to 5 proposals, aiming for at least two, each a concrete change with its cost and risk, one marked recommended;
- on GitHub: labels the sub-issue `needs-owner` and comments the problem and the proposals on it; the sub-issue stays in its column. The comment holds no environment values, tokens, secrets or transcript text;
- is answered with `/ouroboros answer <n>` or free text. The hook applies the answer to the sub-issue body or the checks, comments the amendment on the sub-issue, commits any check change as `contract(#<number>): <change>`, re-runs section 5, removes the label and resumes the run.

The final gate rejects any check change since the fingerprint that has no matching `contract(#<number>)` commit.

### 7. The task workflow (`ouroboros:task`)

Replaces `phase`, `kickoff-phase` and `milestone-exit`.

1. Branch: fresh branch and worktree (haiku).
2. Checks: the auditor writes and commits the checks red (section 5 item 1).
3. Validation: the hook's checks (section 5 item 2), then the cheat and coverage agent (items 3 and 4). A failure escalates.
4. Implement: chains, handoffs and slots as today. Implementers get the sub-issue body and the milestone brief; their prompts state the no-relaxing rule.
5. Review: reviewer and architect on the diff, flagging only correctness, requirement gaps and scope breaks; fix rounds as today.
6. Final gate (hook, section 8).
7. PR: on a pass, a ready PR whose body is `Closes #<number>` and the gate evidence; on a fail, a draft PR listing the failures.

Every agent of the workflow is labelled `<stage>:#<number>`, and each stage logs one line naming the sub-issue and what it is doing, so a running workflow shows which sub-issue and stage each agent serves.

### 8. The final gate (hook)

Runs in the task's worktree on the final commit, never trusting an agent's report:

1. Every checklist command exits 0.
2. Every completion command exits 0.
3. The project gate (lane `test` and `lint` for every lane whose `owned_paths` match a changed file) exits 0.
4. Scope: every file in `git diff --name-only <merge-base>..HEAD` matches the `Files:` line (or is a check file), and none matches `protected` (project config) unless the `Files:` line names it.
5. `no_new`: no added line of the diff matches a pattern from the project's `no_new`.
6. Fingerprint: no check file changed since `checks(#<number>)` except in `contract(#<number>)` commits.

On a pass, the hook ticks every checklist item in the sub-issue body and moves the sub-issue to the QA column. On a fail, nothing is ticked.

It prints one fixed block into the transcript, which is also the PR body's evidence section:

```
GATE PASS #<number> "<title>" at <sha>
  checklist   3/3  bin/rspec spec/requests/pages_spec.rb  exit 0
  completion  bin/rspec  exit 0
  lane ruby   test exit 0, lint exit 0
  scope       14 files, all inside Files, none protected
  no_new      0 hits
  checks      unchanged since <red sha> (0 amendments)
```

`GATE FAIL` lists every failing line with the tail of its output. A fail stops at once: draft PR, run marked failed, auto-continue halted, user notified.

### 9. Driving the run with `/goal`, and auto-continue

- `/ouroboros start <issue>` finds the milestone's next sub-issue and sets: `the gate for #<number> printed GATE PASS or GATE FAIL, or an escalation for it is open; stop after 3 workflow launches`. The goal's turn launches `ouroboros:task`.
- While the workflow runs, `/goal` evaluation waits (background work). When the result arrives, the conductor runs the final gate, which prints its block; the evaluator reads that line, which only the hook writes.
- Met with `GATE PASS`: the PR waits for the user. Met with `GATE FAIL` or an open escalation: the user is told and nothing continues.
- When the conductor sees the PR merged (the existing throttled `gh` check, or `/ouroboros resume`), it closes the sub-issue as completed if it is still open, moves it to the done column, and sets the next sub-issue's goal the same way. When no sub-issue is open, it runs milestone exit. It stops on `/ouroboros pause`.

### 10. Milestone exit (hook)

Runs after the last sub-issue merges, or on `/ouroboros exit <issue>`:

1. Every sub-issue of the milestone is closed.
2. Every acceptance command exits 0 on the default branch's origin tip.

The hook ticks each acceptance item whose command passed. When both hold, it closes the milestone issue and moves it to the done column. Otherwise it leaves the issue open and answers with every open sub-issue and every failing acceptance item.

### 11. Commands

`kickoff <issue>`, `start <issue>`, `exit <issue>`, `status`, `pause`, `resume`, `answer <n|text>`, `escalations`, `collect`, `adopt`. `--phase` and `set phase` are removed.

### 12. Configuration (`.claude/ouroboros.json`)

New keys, all optional except `github.project`:

```json
{
  "prd": "docs/prd.md",
  "github": {
    "repo": "<owner>/<name> of the origin remote",
    "project": "<board title>",
    "status_field": "Status",
    "columns": { "milestones": "Milestones", "planned": "Planned", "in_progress": "In Progress", "qa": "QA", "done": "Done" },
    "labels": { "needs_owner": "needs-owner" }
  },
  "protected": [],
  "no_new": [],
  "red_patterns": {},
  "branch_prefix": "work/"
}
```

- Values shown are the defaults; `github.project` has none, and kickoff refuses without it.
- A configured column, field or label missing on GitHub stops the command that needs it and names it.

Lanes keep `owned_paths`, `test`, `lint`; a project with no lane `test` cannot start a sub-issue.

### 13. Migration

- The skill `migrate-plan-to-issues` moves one plan-file milestone to a milestone issue with sub-issues (ADR 0008). It ships for one release.
- Old state (`milestone`, `current`, `phases`) is ignored; `start` reads the milestone's sub-issues fresh.
- The removed workflows stay one release as thin aliases that print the replacing command, then go.
- README rewritten around milestone issues, sub-issue contracts and the gate.

## Milestones

Each acceptance item names the command that proves it. `scripts/acceptance/<check>` runs against a milestone issue given by `OUROBOROS_SCRATCH_REPO` and `OUROBOROS_SCRATCH_ISSUE`; the milestone that needs a check writes it first.

### M1. Kickoff on GitHub

Goal: `/ouroboros kickoff <issue>` plans a milestone issue into sub-issues, each carrying the seven-section contract, and keeps them in line with the plan on every rerun; the board follows.

Acceptance:
- [ ] Kickoff creates one sub-issue per task under the milestone issue: `scripts/acceptance/kickoff_creates.sh`
- [ ] Every sub-issue body has all seven sections, none empty, every checklist and completion item a command: `node --experimental-strip-types scripts/acceptance/contract_sections.mjs`
- [ ] A rerun with one task changed, one added and one removed updates, creates and closes as "not planned", never touches a closed sub-issue, and duplicates none: `scripts/acceptance/kickoff_rerun.sh`
- [ ] Every open sub-issue is in the planned column: `scripts/acceptance/board_planned.sh`
- [ ] No project value in the plugin's code: `./scripts/guard_no_outside_skills.sh`
- [ ] The plugin's tests pass: `./scripts/pre-push`

### M2. Sub-issues run one at a time

Goal: `/ouroboros start <issue>` runs the milestone's next ready sub-issue: checks red first, validation, implementation, review and the final gate, ending in a PR that closes it. Every agent of the task workflow is labelled with its stage and sub-issue. The cheat attempt and coverage review (section 5 items 3 and 4) are not part of M2; they ship with M3.

Acceptance:
- [ ] Every agent of the task workflow is labelled `<stage>:#<number>` and each stage logs a line: `claude plugin test . 2>&1 | grep -F "(pass) every task workflow agent is labelled with its stage and sub-issue"`
- [ ] Launching a sub-issue moves it to in progress: `scripts/acceptance/task_in_progress.sh`
- [ ] A passing gate ticks every checklist item, the PR body carries `Closes #n`, and the sub-issue moves to QA: `scripts/acceptance/task_gate_pass.sh`
- [ ] An escalation labels the sub-issue `needs-owner` and comments the question on it: `scripts/acceptance/task_escalation.sh`
- [ ] The plugin's tests pass: `./scripts/pre-push`

### M3. Milestone exit and auto-continue

Goal: after the user merges a sub-issue's PR, it reaches Done and the next ready sub-issue starts by itself; after the last one, the milestone issue closes once its acceptance checks pass. The cheat attempt and coverage review of the checks (section 5 items 3 and 4) join the validation.

Acceptance:
- [ ] A cheat diff that turns a checklist command green, or a coverage answer of no, escalates the check as weak: `scripts/acceptance/task_cheat.sh`
- [ ] A merged sub-issue is closed and in the done column, and the next one's goal is set: `scripts/acceptance/auto_continue.sh`
- [ ] Exit refuses while a sub-issue is open or an acceptance command fails, and names each blocker: `scripts/acceptance/exit_refuses.sh`
- [ ] Exit closes the milestone issue and moves it to done when everything holds: `scripts/acceptance/exit_closes.sh`
- [ ] The plugin's tests pass: `./scripts/pre-push`

### M4. Retire the plan-file flow

Goal: nothing reads or writes a plan file any more; the old workflows, commands and the migration skill are gone, the agents and skills speak milestone issues and sub-issue contracts, and the release ships.

Acceptance:
- [ ] No workflow, hook or skill refers to a plan file, a phase tag or a removed command: `scripts/acceptance/no_plan_file.sh`
- [ ] The plugin validates: `claude plugin validate .claude-plugin/plugin.json`
- [ ] The plugin's tests pass: `./scripts/pre-push`
