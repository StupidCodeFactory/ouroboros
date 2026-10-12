# Ouroboros PRD

Status: draft, 2026-10-11. Design: [specs/2026-10-11-github-milestone-loop.md](specs/2026-10-11-github-milestone-loop.md).

## Problem

Agent-driven development drifts. An agent marks work done that is not done, edits the check instead of the code, or stops halfway, and the person finds out late. The person also loses track of what is planned, running and finished, because that state lives in chat transcripts and local files.

## Product

Ouroboros is a Claude Code plugin that runs a milestone of work on a GitHub project board.

- The PRD names the milestones. An architect turns one into sub-issues, each holding a plan and a checklist of items a command can verify.
- The loop takes the sub-issues one at a time. An implementer works in a worktree. A reviewer runs the checklist; what passes is ticked; defects send the sub-issue back with a comment, until the reviewer accepts it. An accepted sub-issue gets a PR and moves to Done.
- GitHub is the only record. Anyone with access to the board sees what is planned, running, in review, blocked and done, and why.

## Users

One developer who owns a repository and a GitHub project, works in Claude Code, and merges the PRs.

## Principles

1. **GitHub is the state.** Issues, the board, labels, comments and PRs hold everything a person needs. Local state only remembers what is in flight.
2. **Only the hook writes GitHub.** Agents read and code; the plugin's hook writes bodies, ticks, comments, labels, columns and PRs from their answers.
3. **Verifiable work.** Every checklist item names a command. A sub-issue without one does not start.
4. **The person decides.** Anything the loop cannot settle (an incomplete sub-issue, a blocked implementer, three rejected reviews) goes to the person as a `needs-owner` label and a comment. Merging is always the person's.
5. **Basics first.** No self-improvement, retros or memory until the loop is proven.

## Out of scope

Auto-merge. Several sub-issues in flight at once. Repositories other than the one holding the board. Rewriting skills or agents from past mistakes.

## Milestones

### M1. The loop runs live

Goal: the rebuilt loop runs end to end on a real scratch repository: kickoff writes sub-issues, `start` takes one through implement, a rejected review, a fix, an accepted review and Done, then starts the next one stacked on the first PR.

Acceptance:
- A kickoff on a scratch milestone leaves every planned sub-issue in Planned with a complete body: `scripts/acceptance/kickoff_planned.sh`
- A sub-issue that went through the loop is in Done, has every checklist item ticked, and a PR closes it: `scripts/acceptance/subissue_done.sh`
- A rejected review left a defects comment and the sub-issue came back to QA after a fix: `scripts/acceptance/review_round.sh`
- The second sub-issue's PR targets the first one's branch while the first PR is open: `scripts/acceptance/stacked_pr.sh`
- The plugin's tests pass: `./scripts/pre-push`

Notes: the acceptance scripts read GitHub only and take the scratch repository and milestone from `OUROBOROS_SCRATCH_REPO` and `OUROBOROS_SCRATCH_MILESTONE`. Whatever the live run breaks (agent working directory, answer delivery at `turn.complete`, `gh` permissions) is fixed here.

### M1.5. Workflow stages in the session's checkout

Goal: every stage runs as a workflow you can watch, in the session's own checkout, so the Claude app shows the diff while the implementer works and the PR when it opens. The plugin talks in plain sentences, never JSON.

Acceptance:
- Each stage (kickoff, implement, review) is offered as one plain line naming a Workflow launch; its brief goes to a file, never into the conversation: `claude plugin test . 2>&1 | grep -F "(pass) kickoff offers the architect stage as a Workflow launch"`
- The Workflow call of the pending stage runs with the arguments the hook kept, records its run, and a second launch is refused while it runs: `claude plugin test . 2>&1 | grep -F "(pass) the Workflow call of the pending stage records its run with the pending arguments"`
- A stage's result is applied when its task notification arrives, the notification is swallowed and one plain line reports the outcome: `claude plugin test . 2>&1 | grep -F "(pass) the architect result creates, updates and drops sub-issues"`
- Every sub-issue branch is created on GitHub with `gh issue develop`, linked to its issue, and checked out in the session's checkout; no worktree is created: `claude plugin test . 2>&1 | grep -F "(pass) start links the sub-issue branch on GitHub, checks it out in the session checkout and offers the implement stage"`
- The implementer and reviewer work in the session's checkout, whether the Claude app made it as a worktree or not, so the app's diff pane shows their changes. Each opened PR reaches the session as one line with its URL, so the session shows it in the PR bar above the prompt: `claude plugin test . 2>&1 | grep -F "(pass) an accepted review ticks every item, pushes, opens the PR"`
- `start` refuses uncommitted changes on another branch and touches nothing: `claude plugin test . 2>&1 | grep -F "(pass) start refuses a checkout with uncommitted changes on another branch and touches nothing"`
- The plugin's tests pass: `./scripts/pre-push`

Notes: a hook cannot launch a workflow, so the session makes the Workflow call the hook offers. Checking it live: run a sub-issue in a Claude app session (its own worktree included) and check that the diff pane shows the implementer's changes and the PR bar shows the opened PR.

### M2. A loop you can leave running

Goal: the loop survives what happens in a real session: a restart, a dead agent, a wrong `gh` account, a missing label, and tells the person plainly what it is doing.

Acceptance:
- `/ouroboros doctor` checks the `gh` account and scopes, the board, its columns, the label and the PRD, and names each problem: `claude plugin test . 2>&1 | grep -F "(pass) doctor names every missing piece of the setup"`
- After a session restart, `/ouroboros start` resumes the sub-issue in flight instead of picking another: `claude plugin test . 2>&1 | grep -F "(pass) start resumes the sub-issue in flight after a restart"`
- With no local state, as in another checkout or after the state file is lost, `/ouroboros start` takes an open sub-issue in In Progress or QA from the board before anything in Planned, and reuses its existing branch instead of resetting it: `claude plugin test . 2>&1 | grep -F "(pass) start resumes an In Progress or QA sub-issue from the board without local state"`
- Every stage change is visible on the sub-issue as a short comment, so the board alone explains its history: `claude plugin test . 2>&1 | grep -F "(pass) every stage change comments on the sub-issue"`
- A `gh` failure stops the loop with the failing command and its error, and leaves GitHub as it was before the stage: `claude plugin test . 2>&1 | grep -F "(pass) a gh failure stops the loop and names the command"`
- A push from any worktree runs that worktree's own `scripts/pre-push` against its own files, never the main checkout's (today `core.hooksPath` holds the main checkout's absolute `scripts` path, so pushes were tested against a stale `main`): `scripts/acceptance/pre_push_own_checkout.sh`
- An accepted sub-issue stays open until its PR merges; only the merge closes it. Today the board's built-in "Auto-close issue" workflow closes it the moment the loop moves it to Done, so a rejected PR leaves its issue closed. `/ouroboros doctor` names that workflow when it is on: `claude plugin test . 2>&1 | grep -F "(pass) doctor names the auto-close workflow that closes a sub-issue before its PR merges"`
- A stacked PR never merges into a branch that has already reached the default branch. GitHub moves a stacked PR onto the default branch only when its base branch is deleted at merge, so `/ouroboros doctor` names the repository setting "Automatically delete head branches" when it is off. (Without it, #54 and #55 merged into #47's branch after that branch was already in `main`, and their work never reached `main`.): `claude plugin test . 2>&1 | grep -F "(pass) doctor names the delete-head-branches setting when it is off"`
- The plugin's tests pass: `./scripts/pre-push`

### M3. Native milestones and releases

Goal: each PRD milestone is also a native GitHub milestone, so the milestone page shows its progress, and a finished milestone ends in a GitHub release whose notes list exactly its PRs.

Design, from the GitHub investigation:
- The milestone issue stays. A native milestone cannot parent sub-issues and its description cannot hold ticks or comments, so the issue keeps the brief, the acceptance checklist and the sub-issues.
- Kickoff creates the native milestone, or finds it by title, with the same title as the milestone issue. It puts the issue and every sub-issue in it. It sets each one explicitly, because GitHub's inheritance from the parent is only documented for the UI.
- Every PR the loop opens carries the milestone (`gh pr create -m`).
- There is no `gh milestone` command, so milestone writes go through `gh api repos/{owner}/{repo}/milestones`. They need only the `repo` scope.
- GitHub has no link between a milestone and a release. The release command makes that link: the person names the tag, and the notes are built from the milestone's merged PRs, not from the commits between two tags, because stacked PRs merged into another branch never show up in a tag range.

Acceptance:
- Kickoff leaves the milestone issue and every sub-issue in a native milestone with the issue's title: `scripts/acceptance/native_milestone.sh`
- A PR the loop opens carries the sub-issue's milestone: `claude plugin test . 2>&1 | grep -F "(pass) the loop's PR carries the native milestone"`
- `/ouroboros release <issue> <tag>` refuses while a sub-issue is open or a milestone PR is unmerged, and names them: `claude plugin test . 2>&1 | grep -F "(pass) release refuses and names the open sub-issues and unmerged PRs"`
- On a finished milestone, `release` asks the person, then publishes the release with notes listing the milestone's merged PRs and a link to the milestone issue, closes the native milestone, and closes the milestone issue: `scripts/acceptance/milestone_released.sh`
- The plugin's tests pass: `./scripts/pre-push`

Not in M3: project views grouped by milestone (not documented as possible), issue types (an organisation feature), version numbers chosen by the plugin, and Actions workflows that react to milestone or release events.

### M4. One-command setup

Goal: a new repository goes from nothing to a running loop with one command: `/ouroboros init` creates or checks the project, its Status columns, the `needs-owner` label, `.claude/ouroboros.json` and a PRD skeleton, asking before each GitHub write.

Acceptance:
- `init` on an empty scratch repository leaves a board, columns, label, config and PRD skeleton that `doctor` accepts: `scripts/acceptance/init_scratch.sh`
- `init` on a repository that is already set up changes nothing and says so: `claude plugin test . 2>&1 | grep -F "(pass) init on a set-up repository changes nothing"`
- The plugin's tests pass: `./scripts/pre-push`
