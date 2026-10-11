# Sections, verified gates and GitHub-native milestones

Date: 2026-10-11. Status: draft.

Decisions and their reasons: ADRs 0001 to 0008 in `docs/adr/`. This file holds only the rules.

## Goals

1. GitHub is where work is planned, tracked and closed. A milestone is one issue; each task is one sub-issue of it, carrying its own contract. There is no plan file.
2. One unit of work, the **section**: the open sub-issues of one milestone that share a Phase. One workflow run per section, from branch to PR.
3. A section cannot start implementing without a **contract** of runnable checks for what it must do and what it must not do.
4. The plugin, not an agent, decides whether a section or a milestone is done, by running the checks itself, and it is the only writer of checklist ticks.
5. No agent may weaken a check or the contract. A weak or weakened check stops the run and asks the user, with 1 to 5 proposals (aim for more than one).
6. After the user merges a section's PR, the next open section starts by itself. After the last one, the milestone closes once its acceptance checks pass.
7. No project-specific value appears in the plugin's code; every one comes from `.claude/ouroboros.json`, with defaults.

## Non-goals

- Auto-merging, or any change to `merge_policy`. The user's merge stays the only human gate.
- Automatic fix rounds after a failed final gate: a red gate stops at once.
- Re-running the section's checks against reverted production code.
- A plan file, or a local mirror of the issues.
- Editing any issue other than milestone issues and their sub-issues.
- Creating board columns, fields or labels: the project sets them up.
- Migration code in the plugin: a throwaway skill does it (section 12).
- Replacing the retro, incidents, eager skills, chains, handoffs or the review stage; they carry over unchanged unless named here.

## Design

### 1. Milestones

- A milestone issue is any issue in the board's milestones column. Ouroboros owns its body.
- The body has three `##` sections, in order: Goal, Brief, Acceptance. Acceptance is a `- [ ]` checklist; each item names one command that passes on exit 0.
- Kickoff writes the whole body. The owner changes a milestone by rerunning kickoff.
- The milestone's definition is the PRD section whose heading matches the issue title. No match stops kickoff and lists the headings found.

### 2. Tasks

- Each task is one sub-issue of its milestone. The sub-issue's number is the task's identity.
- The body has seven `##` sections, in order, none empty:
  - **Goal**: the outcome in one or two sentences.
  - **Plan**: outside-in steps, the files it touches, and the PRD sections to read.
  - **Checklist**: `- [ ]` items, each verifiable by a command or a spec.
  - **Completion condition**: the exact commands and outputs that mean done.
  - **Stop conditions**: when to stop and escalate instead of continuing.
  - **Must not**: the forbidden list, from the brief and the project's guardrails.
  - **Phase**: `P<n>`, and `Depends on:` the sub-issues it needs, or `none`.
- The board's Phase field always equals the body's Phase.
- A task depends only on sub-issues of the same milestone in the same or an earlier Phase.
- The plugin never writes a sub-issue body that misses a section or leaves one empty.
- A milestone holds at most 100 sub-issues; a plan with more stops kickoff and asks the user to split the milestone.

### 3. Kickoff

`/ouroboros kickoff <issue>` plans or replans one milestone.

- It replaces the `milestone-kickoff` workflow: the architect plans, and no checks are written until a section starts.
- Refused while a run of that milestone is in flight, or when the issue is not in the milestones column.
- The architect reads the PRD section, the milestone body and every sub-issue, and returns the milestone body and the task list. Each task names the open sub-issue it revises, or none for a new task.
- A task list that names a closed sub-issue, or an issue outside the milestone, is rejected whole.
- The hook applies the list:
  - a task that revises an open sub-issue updates its body, Phase and dependencies in place;
  - a new task becomes a new sub-issue of the milestone;
  - an open sub-issue the list does not name is closed as "not planned", with a comment saying kickoff dropped it;
  - a closed sub-issue is never reopened, edited or commented on.
- Every open sub-issue ends on the board in the planned column with its Phase field set.
- The answer lists the sub-issues created, updated, dropped and left closed, by number.

### 4. Sections

- A section is the open sub-issues of one milestone with the same Phase. The next section is the lowest Phase with an open sub-issue whose dependencies outside the section are all closed.
- The user types only issue numbers; Phase values come from kickoff.
- Slug: `<milestone slug>-p<n>`, where the milestone slug is its title lowercased, non-alphanumerics folded to `-`, cut to 50 characters.
- Branch: `<branch_prefix><slug>` (default prefix `work/`) from the default branch's origin tip, in its own worktree. PR title: `<milestone title> P<n>`. Checkpoint commit subject: `section(<slug>): <summary>`.
- Launching a section moves its sub-issues to the in-progress column.

### 5. The contract

Committed at `<drafts_dir>/contracts/<slug>.json` on the section branch, so it is part of the PR.

```json
{
  "section": "<milestone title> P<n>",
  "criteria": [
    { "id": "c1", "text": "what must be true, in the user's terms", "items": ["#142/3"] }
  ],
  "done_when": [
    { "criterion": "c1", "command": "bundle exec rspec spec/acceptance/x_spec.rb", "files": ["spec/acceptance/x_spec.rb"], "proves": "one line" }
  ],
  "must_not": {
    "may_change": ["lib/price_feed/backfill/**", "spec/**"],
    "protected": ["db/migrations/**"],
    "invariants": [{ "command": "bundle exec rspec spec/acceptance", "proves": "nothing already green turns red" }],
    "no_new": ["rubocop:disable", "\\bxit\\b", "skip\\(", "--no-verify"]
  },
  "amendments": []
}
```

- `criteria`: every outcome the section promises, each tied to the checklist items it covers (`#<sub-issue>/<item number>`).
- `done_when`: one or more checks per criterion. `command` runs from the repository root and passes on exit 0. `files` are the check's own files.
- `may_change`: the only files the section may change (besides its checks and the contract).
- `protected`: files that may never change unless the contract lists them in `may_change` explicitly. Project defaults in `.claude/ouroboros.json` (`protected`), merged in.
- `invariants`: commands that are green at the start and must stay green.
- `no_new`: regexes that no added line may match. Project defaults in `.claude/ouroboros.json` (`no_new`), merged in.
- The project gate (each lane's `test` and `lint` from `.claude/ouroboros.json`, for every lane whose `owned_paths` match a changed file) always applies and is not part of the contract.

Who writes it: the architect drafts criteria and `must_not` from the sub-issues' Checklist, Completion condition and Must not; the auditor, playing the skeptical evaluator, writes the checks, challenges the criteria and commits the checks red together with the contract. The architect never writes checks; the implementers never write the contract.

### 6. Contract validation (hook, before any implementer runs)

The hook rejects the contract, and the run stops before implementing, when any of these holds:

1. No `done_when` entry, a criterion with no check, or a checklist item of the section's sub-issues not covered by any criterion.
2. Empty `may_change`, or a project with no lane `test` command.
3. Red for the wrong reason: the hook runs every `done_when` command; each must exit non-zero, and the runner's output must show at least one example run and an assertion failure (not a load error, syntax error, missing file, or zero examples). Per-runner patterns live in the plugin (rspec, pytest, jest/vitest, go test) with a project override `red_patterns`.
4. An invariant that is red at the start.
5. Assertion lint on the check files: no assertion at all, assertions only of truthiness, nil or "raises nothing", the unit under test mocked, or a pending or skipped example. Per-language patterns in the plugin, extendable per project.

Then two agent stages, still before implementing:

6. Cheat attempt: a fresh agent that did not write the checks gets the contract and the checks and, in a throwaway worktree, tries to make them pass without meeting the criteria (hard-coded values, stubs, special-casing the fixture). It returns the diffs it tried. The hook runs `done_when` on each diff; any check that turns green on a cheat is weak, with that diff as evidence.
7. Coverage review: the same agent says, per criterion, whether its checks would catch the criterion being only partly met. Any "no" is weak.

When all pass, the checks and the contract are committed alone as `checks(<slug>)`; that commit is the fingerprint. The gate compares every check file and the contract at HEAD with that commit (`git diff <red sha>..HEAD`), so no hash store is needed.

### 7. No relaxing, and escalation

An agent may not, at any stage after the fingerprint:

- edit or delete a check file, or narrow an assertion;
- change the contract (widen `may_change`, drop a criterion, an invariant or a `no_new` pattern, unprotect a path);
- skip, filter or reconfigure the gate (`--only`, `-k`, tags, config edits that exclude files);
- edit a sub-issue or milestone body.

The hook enforces this on every agent `Edit`/`Write`/`Bash` that touches a fingerprinted file, the contract or an issue body: the call is refused with "contract change needs the user" and the agent is told to escalate.

An escalation is raised when contract validation finds a weak check, when an agent's call is refused as above, when an agent hits a sub-issue's stop condition, or when an agent decides a check is wrong. It:

- stops the run (no further stages, nothing merged, auto-continue halted);
- is drafted by the agent that hit it and checked by the architect;
- reaches the user as one message: the problem (which criterion and check, why it is weak or why the agent wants it changed, the evidence: cheat diff, runner output, lint hit, refused call) and 1 to 5 proposals, aiming for at least two, each a concrete change with its cost and risk, one marked recommended;
- on GitHub: labels each affected sub-issue `needs-owner` and comments the problem and the proposals on it; the sub-issue stays in its column. The comment holds no environment values, tokens, secrets or transcript text;
- is answered with `/ouroboros answer <n>` or free text. The hook records the answer as an entry in `amendments` (`{ at, by: "user", escalation, change }`), applies it (or hands it to the auditor to apply), re-validates the contract (section 6), re-fingerprints, commits `contract(<slug>): <change>`, removes the label and resumes the run.

The final gate rejects any contract or check change that has no matching user amendment.

### 8. The section workflow (`ouroboros:section`)

Replaces `phase`, `kickoff-phase` and `milestone-exit`.

1. Branch: fresh branch and worktree (haiku).
2. Brief and contract: the architect drafts the section brief and the contract's criteria and `must_not` from the milestone brief and the section's sub-issues; the auditor writes and commits the checks and the contract red.
3. Validation: the hook's checks (section 6 items 1 to 5), then the cheat and coverage agent (items 6 and 7), then the fingerprint. A failure escalates.
4. Implement: chains, handoffs and slots as today. Implementers get the contract and their sub-issues; their prompts state the no-relaxing rule.
5. Review: reviewer and architect on the diff, flagging only correctness, requirement gaps and scope breaks; fix rounds as today.
6. Final gate (hook, section 9).
7. PR: on a pass, a ready PR whose body is generated from the gate evidence; on a fail, a draft PR listing the failures.

### 9. The final gate (hook)

Runs in the section's worktree on the final commit, never trusting an agent's report:

1. Every `done_when` command exits 0.
2. Every invariant exits 0.
3. The project gate (lane `test` and `lint` for every lane whose `owned_paths` match a changed file) exits 0.
4. Scope: every file in `git diff --name-only <merge-base>..HEAD` matches `may_change` (or is a check file or the contract), and none matches `protected` unless listed in `may_change`.
5. `no_new`: no added line of the diff matches a pattern.
6. Fingerprints: every check file and the contract match the recorded fingerprint, or changed only through a user amendment.
7. Checklist: every checklist item of the section's sub-issues is covered by a criterion whose checks all passed.

On a pass, the hook ticks every covered item in the sub-issue bodies, one issue at a time, the PR body carries `Closes #<n>` for every sub-issue of the section, and the sub-issues move to the QA column. On a fail, nothing is ticked and the PR closes nothing.

It prints one fixed block into the transcript, which is also the PR body's evidence section:

```
GATE PASS section "<milestone title> P<n>" at <sha>
  done_when  c1 bundle exec rspec spec/acceptance/x_spec.rb  exit 0
  invariant  bundle exec rspec spec/acceptance                exit 0
  lane ruby  test exit 0, lint exit 0
  scope      14 files, all inside may_change, none protected
  no_new     0 hits
  checks     unchanged since <red sha> (0 amendments)
  checklist  9/9 items in #142, #143, #145
```

`GATE FAIL` lists every failing line with the tail of its output. A fail stops at once: draft PR, run marked failed, auto-continue halted, user notified.

### 10. Driving the run with `/goal`, and auto-continue

- `/ouroboros start <issue>` finds the milestone's next section and sets: `the gate for section "<milestone title> P<n>" printed GATE PASS or GATE FAIL, or an escalation for it is open; stop after 3 workflow launches`. The goal's turn launches `ouroboros:section`.
- While the workflow runs, `/goal` evaluation waits (background work). When the result arrives, the conductor runs the final gate, which prints its block; the evaluator reads that line, which only the hook writes.
- Met with `GATE PASS`: the PR waits for the user. Met with `GATE FAIL` or an open escalation: the user is told and nothing continues.
- When the conductor sees the PR merged (the existing throttled `gh` check, or `/ouroboros resume`), it checks the section's sub-issues are closed, moves them to the done column, and sets the next section's goal the same way. When no section is open, it runs milestone exit. It stops on `/ouroboros pause`.

### 11. Milestone exit (hook)

Runs after the last section merges, or on `/ouroboros exit <issue>`:

1. Every sub-issue of the milestone is closed.
2. Every acceptance command exits 0 on the default branch's origin tip.

The hook ticks each acceptance item whose command passed. When both hold, it closes the milestone issue and moves it to the done column. Otherwise it leaves the issue open and answers with every open sub-issue and every failing acceptance item.

### 12. Commands

`kickoff <issue>`, `start <issue>`, `exit <issue>`, `status`, `pause`, `resume`, `answer <n|text>`, `escalations`, `collect`, `adopt`. `--phase` and `set phase` are removed.

### 13. Configuration (`.claude/ouroboros.json`)

New keys, all optional except `github.project`:

```json
{
  "prd": "docs/prd.md",
  "github": {
    "repo": "<owner>/<name> of the origin remote",
    "project": "<board title>",
    "status_field": "Status",
    "phase_field": "Phase",
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

Lanes keep `owned_paths`, `test`, `lint`; a project with no lane `test` cannot start a section.

### 14. Migration

- The skill `migrate-plan-to-issues` moves one plan-file milestone to a milestone issue with sub-issues (ADR 0008). It ships for one release.
- Old state (`milestone`, `current`, `phases`) is ignored; `start` reads the milestone's sub-issues fresh.
- The removed workflows stay one release as thin aliases that print the replacing command, then go.
- README rewritten around milestone issues, sections, the contract and the gate.

## Milestones

Each acceptance item names the command that proves it. `scripts/acceptance/<check>.sh` runs against a scratch milestone issue in a test repository given by `OUROBOROS_SCRATCH_REPO`; the milestone that needs a check writes it first.

### M1. Kickoff on GitHub

Goal: `/ouroboros kickoff <issue>` plans a milestone issue into sub-issues, each carrying the seven-section contract, and keeps them in line with the plan on every rerun; the board follows.

Acceptance:
- [ ] Kickoff creates one sub-issue per task under the milestone issue: `scripts/acceptance/kickoff_creates.sh` exits 0.
- [ ] Every sub-issue body has all seven sections, none empty: `scripts/acceptance/contract_sections.sh` exits 0.
- [ ] A rerun with one task changed, one added and one removed updates, creates and closes as "not planned", never touches a closed sub-issue, and duplicates none: `scripts/acceptance/kickoff_rerun.sh` exits 0.
- [ ] Every open sub-issue is in the planned column with its Phase field set: `scripts/acceptance/board_planned.sh` exits 0.
- [ ] No project value in the plugin's code: `./scripts/guard_no_outside_skills.sh` exits 0.
- [ ] The plugin's tests pass: `./scripts/pre-push` exits 0.

### M2. Sections run from sub-issues

Goal: `/ouroboros start <issue>` runs the milestone's next section from its sub-issues: contract, validation, implementation, review and the final gate, ending in a PR that closes them.

Acceptance:
- [ ] Launching a section moves its sub-issues to in progress: `scripts/acceptance/section_in_progress.sh` exits 0.
- [ ] A passing gate ticks every covered checklist item, the PR body carries `Closes #n` for each sub-issue, and they move to QA: `scripts/acceptance/section_gate_pass.sh` exits 0.
- [ ] An escalation labels the sub-issue `needs-owner` and comments the question on it: `scripts/acceptance/section_escalation.sh` exits 0.
- [ ] The plugin's tests pass: `./scripts/pre-push` exits 0.

### M3. Milestone exit and auto-continue

Goal: after the user merges a section's PR, its sub-issues reach Done and the next section starts by itself; after the last one, the milestone issue closes once its acceptance checks pass.

Acceptance:
- [ ] A merged section's sub-issues are closed and in the done column, and the next section's goal is set: `scripts/acceptance/auto_continue.sh` exits 0.
- [ ] Exit refuses while a sub-issue is open or an acceptance command fails, and names each blocker: `scripts/acceptance/exit_refuses.sh` exits 0.
- [ ] Exit closes the milestone issue and moves it to done when everything holds: `scripts/acceptance/exit_closes.sh` exits 0.
- [ ] The plugin's tests pass: `./scripts/pre-push` exits 0.

### M4. Retire the plan-file flow

Goal: nothing reads or writes a plan file any more; the old workflows, commands and the migration skill are gone, the agents and skills speak milestone issues and sections, and the release ships.

Acceptance:
- [ ] No workflow, hook or skill refers to a plan file, a phase tag or a removed command: `scripts/acceptance/no_plan_file.sh` exits 0.
- [ ] The plugin validates: `claude plugin validate .claude-plugin/plugin.json` exits 0.
- [ ] The plugin's tests pass: `./scripts/pre-push` exits 0.
