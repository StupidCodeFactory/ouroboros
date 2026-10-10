# Sections and verified gates

Date: 2026-10-10. Status: draft for review.

## Problem

The loop makes the user drive its bookkeeping and takes agents at their word.

- Work is split into milestones (`M8`) and phases (`P19`). The user types both ids, every task heading carries a phase tag, and a milestone costs three runs (kickoff, phase, exit) for what is usually one unit of work. Most milestones have one or two phases, so the split buys little.
- Kickoff is its own run; the conductor then queues the phase as a second run, with a resume step in between.
- "Done" is mostly an agent's report: the checkpoint agent says the checks are green, nothing proves a check still tests what it tested when it was red, and nothing stops an agent from relaxing a check, widening its scope or touching files outside the task.

The user wants to move to auto-continue (the next unit starts by itself after the user merges), which is only safe once "done" is proven by something an agent cannot talk its way past.

## Guidance this follows

- Claude Code best practices: give the agent a check that returns pass or fail; a deterministic gate (a hook that runs the check) is stronger than an instruction; show evidence, not claims; a fresh reviewer checks that nothing outside the task's scope changed and flags only gaps that affect correctness or the stated requirements. <https://code.claude.com/docs/en/best-practices>
- Anthropic, "Harness design for long-running apps" (2026-03-24): before coding, the builder and a separate evaluator agree a contract of testable criteria; grading is separated from generation; the evaluator is tuned to be skeptical; any criterion below its threshold fails the unit. <https://www.anthropic.com/engineering/harness-design-long-running-apps>
- CLAUDE.md and prompt rules are guidance, not enforcement: whatever must always hold is a hook, a test or CI.
- `/goal` keeps a session working toward a condition that a separate small model judges after every turn, from the transcript only (it runs no commands). <https://code.claude.com/docs/en/goal>

## Goals

1. One unit of work, the **section**: a `##` heading in the plan with its `- [ ]` task boxes. No milestone or phase ids anywhere the user types or reads.
2. One workflow run per section, from branch to PR.
3. A section cannot start implementing without a **contract** of runnable checks for what it must do and what it must not do.
4. The plugin, not an agent, decides whether a section is done, by running the checks itself.
5. No agent may weaken a check or the contract. A weak or weakened check stops the run and asks the user, with 1 to 5 proposals (aim for more than one).
6. After the user merges a section's PR, the next open section starts by itself.

## Non-goals

- Auto-merging. The user's merge stays the only human gate.
- Automatic fix rounds after a failed final gate: a red gate stops at once.
- Re-running the section's checks against reverted production code (judged not worth the cost: red-before plus fingerprint covers it).
- Replacing the retro, incidents, eager skills, chains, handoffs or the review stage; they carry over unchanged unless named here.

## Design

### 1. Sections

- A section is a `##` heading of the plan that has `- [ ]` boxes under it (directly or under its `###` tasks). Its slug is the heading lowercased, non-alphanumerics folded to `-`, cut to 50 characters.
- The next section is the first, in file order, with an unticked box.
- Branch: `<branch_prefix><slug>` (default prefix `work/`) from the default branch's origin tip, in its own worktree. PR title: the heading. Checkpoint commit subject: `section(<slug>): <summary>`.
- Old plans keep working: an old `## Part C: M8 P19 tasks` heading is a section like any other, and phase tags in task headings are ignored.

### 2. The contract

Committed at `<drafts_dir>/contracts/<slug>.json` on the section branch, so it is part of the PR.

```json
{
  "section": "<heading>",
  "criteria": [
    { "id": "c1", "text": "what must be true, in the user's terms", "boxes": ["Task 142 Step 3"] }
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

- `criteria`: every outcome the section promises, each tied to the plan boxes it covers.
- `done_when`: one or more checks per criterion. `command` runs from the repository root and passes on exit 0. `files` are the check's own files.
- `may_change`: the only files the section may change (besides its checks and the plan).
- `protected`: files that may never change unless the contract lists them in `may_change` explicitly. Project defaults in `.claude/ouroboros.json` (`protected`), merged in.
- `invariants`: commands that are green at the start and must stay green.
- `no_new`: regexes that no added line may match. Project defaults in `.claude/ouroboros.json` (`no_new`), merged in.
- The project gate (each lane's `test` and `lint` from `.claude/ouroboros.json`, for every lane whose `owned_paths` match a changed file) always applies and is not part of the contract.

Who writes it: the architect drafts criteria and `must_not` with the brief; the auditor, playing the skeptical evaluator, writes the checks, challenges the criteria and commits the checks red together with the contract. The architect never writes checks; the implementers never write the contract.

### 3. Contract validation (hook, before any implementer runs)

The hook rejects the contract, and the run stops before implementing, when any of these holds:

1. No `done_when` entry, a criterion with no check, or a plan box of the section not covered by any criterion.
2. Empty `may_change`, or a project with no lane `test` command.
3. Red for the wrong reason: the hook runs every `done_when` command; each must exit non-zero, and the runner's output must show at least one example run and an assertion failure (not a load error, syntax error, missing file, or zero examples). Per-runner patterns live in the plugin (rspec, pytest, jest/vitest, go test) with a project override `red_patterns`.
4. An invariant that is red at the start.
5. Assertion lint on the check files: no assertion at all, assertions only of truthiness, nil or "raises nothing", the unit under test mocked, or a pending or skipped example. Per-language patterns in the plugin, extendable per project.

Then two agent stages, still before implementing:

6. Cheat attempt: a fresh agent that did not write the checks gets the contract and the checks and, in a throwaway worktree, tries to make them pass without meeting the criteria (hard-coded values, stubs, special-casing the fixture). It returns the diffs it tried. The hook runs `done_when` on each diff; any check that turns green on a cheat is weak, with that diff as evidence.
7. Coverage review: the same agent says, per criterion, whether its checks would catch the criterion being only partly met. Any "no" is weak.

When all pass, the checks and the contract are committed alone as `checks(<slug>)`; that commit is the fingerprint. The gate compares every check file and the contract at HEAD with that commit (`git diff <red sha>..HEAD`), so no hash store is needed.

### 4. No relaxing, and escalation

An agent may not, at any stage after the fingerprint:

- edit or delete a check file, or narrow an assertion;
- change the contract (widen `may_change`, drop a criterion, an invariant or a `no_new` pattern, unprotect a path);
- skip, filter or reconfigure the gate (`--only`, `-k`, tags, config edits that exclude files).

The hook enforces this on every agent `Edit`/`Write`/`Bash` that touches a fingerprinted file or the contract: the call is refused with "contract change needs the user" and the agent is told to escalate.

An escalation is raised when contract validation finds a weak check, when an agent's call is refused as above, or when an agent decides a check is wrong. It:

- stops the run (no further stages, nothing merged, auto-continue halted);
- is drafted by the agent that hit it and checked by the architect;
- reaches the user as one message: the problem (which criterion and check, why it is weak or why the agent wants it changed, the evidence: cheat diff, runner output, lint hit, refused call) and 1 to 5 proposals, aiming for at least two, each a concrete change with its cost and risk, one marked recommended;
- is answered with `/ouroboros answer <n>` or free text. The hook records the answer as an entry in `amendments` (`{ at, by: "user", escalation, change }`), applies it (or hands it to the auditor to apply), re-validates the contract (section 3), re-fingerprints, commits `contract(<slug>): <change>` and resumes the run.

The final gate rejects any contract or check change that has no matching user amendment.

### 5. The section workflow (`ouroboros:section`)

Replaces `milestone-kickoff`, `phase`, `milestone-exit` and `kickoff-phase`.

1. Branch: fresh branch and worktree (haiku).
2. Brief and contract: the architect drafts the brief and the contract's criteria and `must_not`; the auditor writes and commits the checks and the contract red.
3. Validation: the hook's checks (section 3 items 1 to 5), then the cheat and coverage agent (items 6 and 7), then the fingerprint. A failure escalates.
4. Implement: chains, handoffs and slots as today. Implementers get the contract; their prompts state the no-relaxing rule.
5. Review: reviewer and architect on the diff, flagging only correctness, requirement gaps and scope breaks; fix rounds as today.
6. Final gate (hook, section 6).
7. PR: on a pass, a ready PR whose body is generated from the gate evidence; on a fail, a draft PR listing the failures.

### 6. The final gate (hook)

Runs in the section's worktree on the final commit, never trusting an agent's report:

1. Every `done_when` command exits 0.
2. Every invariant exits 0.
3. The project gate (lane `test` and `lint` for every lane whose `owned_paths` match a changed file) exits 0.
4. Scope: every file in `git diff --name-only <merge-base>..HEAD` matches `may_change` (or is a check file, the contract or the plan), and none matches `protected` unless listed in `may_change`.
5. `no_new`: no added line of the diff matches a pattern.
6. Fingerprints: every check file and the contract match the recorded fingerprint, or changed only through a user amendment.
7. Plan: every box of the section is ticked.

It prints one fixed block into the transcript, which is also the PR body's evidence section:

```
GATE PASS section "<heading>" at <sha>
  done_when  c1 bundle exec rspec spec/acceptance/x_spec.rb  exit 0
  invariant  bundle exec rspec spec/acceptance                exit 0
  lane ruby  test exit 0, lint exit 0
  scope      14 files, all inside may_change, none protected
  no_new     0 hits
  checks     unchanged since <red sha> (0 amendments)
  plan       9/9 boxes
```

`GATE FAIL` lists every failing line with the tail of its output. A fail stops at once: draft PR, run marked failed, auto-continue halted, user notified.

### 7. Driving the run with `/goal`, and auto-continue

Spike (2026-10-10, Claude Code 2.1.295): a plugin hook can set a goal with `$.command.run({ command: 'goal', args })` called from `$.clock.after`; the goal starts a turn by itself and clears when met. `$.prompt.submit` with text starting `/` is refused by the host.

- `/ouroboros start [plan]` finds the next open section and sets: `the gate for section "<heading>" printed GATE PASS or GATE FAIL, or an escalation for it is open; stop after 3 workflow launches`. The goal's turn launches `ouroboros:section`.
- While the workflow runs, `/goal` evaluation waits (background work). When the result arrives, the conductor runs the final gate, which prints its block; the evaluator reads that line, which only the hook writes.
- Met with `GATE PASS`: the PR waits for the user. Met with `GATE FAIL` or an open escalation: the user is told and nothing continues.
- When the conductor sees the PR merged (the existing throttled `gh` check, or `/ouroboros resume`), it sets the next section's goal the same way. It stops when no section is open, or on `/ouroboros pause`.
- Commands: `start [plan]`, `status`, `pause`, `resume`, `answer <n|text>`, `escalations`, `collect`, `adopt`. `kickoff`, `--phase`, `set phase` and `exit` are removed.

### 8. Configuration (`.claude/ouroboros.json`)

New keys, all optional:

- `protected`: default protected globs.
- `no_new`: default forbidden patterns for added lines.
- `red_patterns`: per-runner overrides for "red for the right reason".
- `branch_prefix` default changes to `work/`.

Lanes keep `owned_paths`, `test`, `lint`; a project with no lane `test` cannot start a section.

### 9. Migration

- Old state (`milestone`, `current`, `phases`) is ignored; `start` reads the plan fresh.
- Old plans work: any `##` heading with open boxes is a section.
- The removed workflows stay one release as thin aliases that print the `start` command, then go.
- README rewritten around sections, the contract and the gate.

## Testing

- Unit tests (bun, hooks): section parsing and next-section choice; slugging; contract schema validation; red-for-the-right-reason per runner on recorded outputs; assertion lint per language; scope fence and protected paths on synthetic diffs; `no_new` on added lines only; fingerprint match and amendment matching; gate block formatting; refusal of edits to fingerprinted files; escalation message with 1 to 5 proposals; goal condition text; auto-continue on a merged PR.
- Workflow simulation (existing harness): a section run end to end with mocked agents, including a weak check found by the cheat stage, a refused relaxation, a red final gate, and a user amendment resuming the run.
- Live check in one project before release: one real section from contract to PR.

## Risks

- Runner output formats vary: "red for the right reason" needs per-runner patterns and will miss exotic runners; the fallback is to escalate when the output cannot be classified, never to pass.
- The cheat stage costs one agent per section and can miss a cheat; it narrows the risk, the fingerprint and the user's merge still stand behind it.
- Refusing edits to check files can block a legitimate fix to a broken check; that is intended, and the escalation makes it one answer from the user.
- `/goal` from a hook is not documented; the spike proved it on 2.1.295. If a later build drops it, the conductor's own launch path (today's) still chains sections; only the per-turn evaluator is lost, and the gate is unaffected.
- Refusing an agent's edit to a fingerprinted file needs `tool.call` hooks to fire inside workflow agents, which is not yet proven. The implementation plan starts with that spike; if they do not fire, the edit is caught at the final gate (fingerprint mismatch), which stops the run and escalates, only later.
