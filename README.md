# ouroboros

**The dev loop that eats its own mistakes.**

A Claude Code plugin that runs a disciplined, self-improving development loop. Every phase's failures are logged, turned into evals, and rewritten into the skills and agents that caused them, so the next phase starts smarter:

- **Workflows** (`workflows/`): `milestone-kickoff`, `phase`, `milestone-exit`. The main session runs one workflow per phase; each phase implements every task with outside-in TDD (tasks whose brief `touches` are disjoint run in parallel, each in its own worktree, and are merged back in plan order; a merge conflict means a sequential retry of the later task, never a hand-resolved merge), then the reviewer (correctness) and the architect (structure) review the whole phase diff once in parallel; fix rounds (at most three review rounds and two fix rounds in all) send each finding to its task (fixes of tasks whose diffs share no file run side by side in worktrees and merge back like the tasks did) and re-check only the findings, with only the reviewers that raised them until the last round and without re-reading the brief or their skills; then it checkpoints. The conductor, not an agent, accepts a checkpoint: the reported checkpoint sha must be HEAD with a `phase(PN):` subject, and every box of the tasks the phase ran must be ticked; otherwise the phase escalates. A task whose boxes are all ticked is never launched again. Merges follow `merge_policy` in `.claude/ouroboros.json`: `ask` (the default) opens the phase PR into the default branch, reports it and holds the next phase until you merge it; `/ouroboros resume` checks the PR with `gh` and starts the next phase on a fresh branch from the updated default branch, so no merge or rebase of the old branch is ever needed. `architect` opens no phase PRs; the architect merges the milestone PR at exit once every gate is green. Nothing merges or rebases in the main session while a workflow is writing to the worktree.
- **Agents** (`agents/`): architect, auditor, reviewer, implementer, skill-curator, adr-scribe. Persistent memory lives in each project's `.claude/agent-memory/`.
- **Skills** (`skills/`): generic process skills that the loop rewrites after every phase when an agent misreads or misuses them, each change proven by an eval.
- **Hooks** (`hooks/`): incident capture, retro gate, agent rollover, ADR scribe, planning lessons, status line, and the conductor: a state machine in `.claude/ouroboros/state.json` that files every workflow result under `.claude/ouroboros/results/`, files every skill-gap, skill-misread, skill-misuse and agent-behaviour finding of a phase result as an incident (workflow-started reviewers never reach the main session), appends review findings about code outside a task's diff to the plan as a `### Task <id>-<PN>-follow-ups` task tagged with the next phase (untagged after the last phase), starts the retro after every phase result, and hands the next `Workflow` launch to the main session as one line. `/ouroboros status | pause | resume | escalations | kickoff <milestone> [<spec> <plan>] [goal]` answer from that state without the model. Resume and kickoff first drop a pending launch whose work already ran (a recorded result, or a brief on disk with every phase carrying tasks; a `phase(PN)` commit with no open box in PN) and say why. `/ouroboros adopt <task-id> <workflow> [phase]` records a run started outside the conductor as in flight, and `/ouroboros set phase <PN>` / `set status <status>` repair the position; each prints the state before and after, so state.json never needs hand edits. `/ouroboros collect <output-file>` files a workflow result whose notification never reached the conductor: the in-flight run's result moves the loop on exactly as its notification would have (incidents, follow-ups, retro); any other run's result only files its incidents. With only a milestone, kickoff discovers the drafts under `drafts_dir`: the newest file with `### Task` headings and checkboxes that names the milestone is the plan, and its `Spec:` line (or the file sharing its name) is the spec. Kickoff refuses to start without a `.claude/ouroboros.json`.

Project-specific configuration lives in the project's `.claude/ouroboros.json` and its own domain skills.

Specs and plans are ordinary markdown drafts: `### Task <id>: <title> (PN)` headings (or `(PN, <lane>)` to pin a task's lane) and `- [ ]` boxes under `drafts_dir` in the main checkout, read the same way from any worktree.

Incidents land where the curator can fix them: a project skill's in `<project>/.claude/skills/<skill>/incidents.md`; a plugin skill's or agent's in the plugin checkout only when it is a writable git checkout, otherwise in `<project>/.claude/ouroboros/plugin-incidents/<plugin>/{skills,agents}/` for the curator to turn into a patch. Agent names are folded onto the plugin agent that plays them (`implementer-ruby`, `implementer:ruby` and `architect-m1` are the implementer and the architect; the planner is the architect). A process finding that names no skill or agent goes to `plugin-incidents/<plugin>/unowned.md`, where the curator gives it an owner or closes it; none is dropped. Every loop workflow's findings are filed, its own top-level `findings` as well as its tasks'. Evidence is written relative to the project. Plan drift (a draft edited after kickoff) is not a skill incident: the ADR scribe notes it on the active ADR, and it never counts toward the retro gate.

Progress is never kept in conversation memory: every plan task and step is a `- [ ]` checkbox, agents start from the first unchecked box and tick each one in the commit that verifies it (`skills/checkbox-progress`).

## Install

On any machine, add the marketplace and install:

```bash
claude plugin marketplace add StupidCodeFactory/ouroboros
claude plugin install ouroboros@ouroboros
```

If the plugin gets loaded twice (an installed copy plus a stale `--plugin-dir` or dev link), the instance loaded first refuses the second at `plugin.register` and toasts both roots, so every hook runs once. The hooks are function hooks: set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in the `env` of `~/.claude/settings.json`. To develop the plugin, point `CLAUDE_CODE_PLUGIN_DIRS` at a checkout instead of installing it; never do both, or every hook runs twice.

## Project setup

Commit a `.claude/ouroboros.json` naming the lanes (owned paths, test and lint commands, lint baseline, lane skills), each agent's eager skills, the planning skills, `adr_dir` and `drafts_dir`. Put language and domain rules in the project's own `.claude/skills/`; the plugin's skills stay project-agnostic. ouroboros hardcodes no skill or plugin from outside itself: every skill an agent loads is named here.

```json
{
  "lanes": {
    "ruby": { "owned_paths": ["lib/**", "spec/**"], "test": "bundle exec rspec", "lint": "bundle exec rubocop", "lint_baseline": 0 }
  },
  "agents": {
    "architect": { "eager_skills": ["ouroboros:checkbox-progress", "ouroboros:code-style", "ouroboros:phase-pr-workflow", "ouroboros:findings-contract", "ouroboros:adr-format", "your-plugin:design"] },
    "implementer": {
      "eager_skills": ["ouroboros:checkbox-progress", "ouroboros:code-style", "ouroboros:phase-pr-workflow", "your-plugin:tdd"],
      "lanes": { "ruby": { "eager_skills": ["ruby-spec-conventions"] } }
    },
    "reviewer": { "eager_skills": ["ouroboros:checkbox-progress", "ouroboros:code-style", "ouroboros:findings-contract", "your-plugin:code-review"] },
    "auditor": { "eager_skills": ["ouroboros:checkbox-progress", "ouroboros:findings-contract"] },
    "adr-scribe": { "eager_skills": ["ouroboros:checkbox-progress", "ouroboros:adr-format"] },
    "skill-curator": { "eager_skills": ["your-plugin:writing-skills"] }
  },
  "planning_skills": ["your-plugin:brainstorm", "your-plugin:write-plan"],
  "eager_skills_max_chars": 60000,
  "effort": { "brief": "high", "implement": "high", "review": "high", "audit": "medium", "checkpoint": "low" },
  "adr_dir": "docs/adr",
  "drafts_dir": "docs/drafts"
}
```

`agents.<agent>.eager_skills` (plus `lanes.<lane>.eager_skills` for implementers) is the only source of skills an agent loads; an agent the project lists nothing for gets ouroboros's own process skills for its role. `planning_skills` names the skills whose prompt gets the planning lessons appended; empty or missing means the planning hook never fires. `drafts_dir` is where `isDraftPath` looks for `specs/` and `plans/`.

An optional `effort` map sets the reasoning effort per workflow stage; the conductor passes it to every workflow it launches as `args.effort`, and a stage left out inherits the session effort. Stages: `brief`, `implement`, `review`, `architect_review`, `audit`, `fix`, `planner`, `checkpoint`, `merge`; values: `low`, `medium`, `high`, `xhigh`, `max`.

Workflows take everything else through `args`: `milestone-kickoff` gets `{ milestone, goal, spec, plan }`, `phase` gets `{ milestone, phase, brief_dir, tasks }` with each task's `touches` from its brief slice (else, for a lane-tagged task, its lane's `owned_paths`, so tasks of different lanes still run side by side; globs overlap when one's fixed prefix contains the other's) and its `lane` (the heading's lane tag, else the lane whose `owned_paths` own most of its touched files), so one phase mixes lanes and checkpoints once after all of them (or `brief_path`, or an inline `brief` when no brief file exists; a long brief belongs in a file, never inline) (the conductor derives `tasks` from the plan's `(PN)` tags), `milestone-exit` gets `{ milestone }`. Workflow agents are the plugin's own (`ouroboros:<agent>`); skills reach them only through the project config's per-agent lists.

## Runtime state

ouroboros writes its runtime state under `.claude/ouroboros/` at the repository root. It is local to each checkout or worktree, and the conductor drops a `.claude/ouroboros/.gitignore` holding `*` so the directory ignores itself; to say so in the project too, add it to the project's `.gitignore`:

```gitignore
.claude/ouroboros/
```

- `state.json`: the conductor's loop state (milestone, phases, current phase, pending launch, run in flight, escalations).
- `results/`: the full result of every loop workflow, plus every oversized result of a plugin agent or loop workflow, each filed by task or tool-use id.
- `eager/`: each role's eager skills block (`<role>.md`, `implementer-<lane>.md`), written before a loop workflow launches and read by its agents first.
- `briefs/`: the architect brief of each milestone kickoff: `<milestone>/common.md` (forbidden list, review gates, shared constraints) and `<milestone>/<task id>.md` (where the task's code goes, what to reuse, the files it touches). Phases get the directory as `brief_dir` and each agent reads the common file plus its own task's slice. A kickoff that returned one plain-text brief files it as `<milestone>.md` and passes `brief_path`.
- `spawns.jsonl`: one line per agent spawn with the skills inlined and their hashes.

The committed `.claude/ouroboros.json` is configuration, not runtime state; keep it under version control.

## Development

Run `scripts/install-hooks.sh` once after cloning: the pre-push hook runs `scripts/guard_no_outside_skills.sh` (no outside skill or plugin names, no absolute home paths, and none of the project names listed one per line in the untracked `.git/info/project-names`), `scripts/check_workflow_mirrors.mjs` (the workflow scripts cannot import, so their inline copies of the tested phase logic in `hooks/phase_review.ts` must match it), the plugin tests and `plugin validate`, and refuses the push on any failure.

Status: under construction.
