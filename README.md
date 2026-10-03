# ouroboros

**The dev loop that eats its own mistakes.**

A Claude Code plugin that runs a disciplined, self-improving development loop. Every phase's failures are logged, turned into evals, and rewritten into the skills and agents that caused them, so the next phase starts smarter:

- **Workflows** (`workflows/`): `milestone-kickoff`, `phase`, `milestone-exit`. The main session runs one workflow per phase; each phase implements with outside-in TDD, reviews in parallel (reviewer, architect, auditor), fixes for at most three rounds, then checkpoints.
- **Agents** (`agents/`): architect, auditor, reviewer, implementer, skill-curator, adr-scribe. Persistent memory lives in each project's `.claude/agent-memory/`.
- **Skills** (`skills/`): generic process skills that the loop rewrites after every phase when an agent misreads or misuses them, each change proven by an eval.
- **Hooks** (`hooks/`): incident capture, retro gate, agent rollover, ADR scribe, planning lessons, status line.

Project-specific configuration lives in the project's `.claude/ouroboros.json` and its own domain skills.

Specs and plans are ordinary superpowers drafts: `### Task <id>: <title> (PN)` headings and `- [ ]` boxes under `drafts_dir` in the main checkout, read the same way from any worktree.

Progress is never kept in conversation memory: every plan task and step is a `- [ ]` checkbox, agents start from the first unchecked box and tick each one in the commit that verifies it (`skills/checkbox-progress`).

## Install

On any machine, add the marketplace and install:

```bash
claude plugin marketplace add StupidCodeFactory/ouroboros
claude plugin install ouroboros@ouroboros
```

The hooks are function hooks: set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in the `env` of `~/.claude/settings.json`. To develop the plugin, point `CLAUDE_CODE_PLUGIN_DIRS` at a checkout instead of installing it; never do both, or every hook runs twice.

## Project setup

Commit a `.claude/ouroboros.json` naming the lanes (owned paths, test and lint commands, lint baseline, lane skills), each agent's eager skills, `adr_dir` and `drafts_dir`. Put language and domain rules in the project's own `.claude/skills/`; the plugin's skills stay project-agnostic.

Status: under construction.
