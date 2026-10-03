# ouroboros

**The dev loop that eats its own mistakes.**

A Claude Code plugin that runs a disciplined, self-improving development loop. Every phase's failures are logged, turned into evals, and rewritten into the skills and agents that caused them, so the next phase starts smarter:

- **Workflows** (`workflows/`): `milestone-kickoff`, `phase`, `milestone-exit`. The main session runs one workflow per phase; each phase implements with outside-in TDD, reviews in parallel (reviewer, architect, auditor), fixes for at most three rounds, then checkpoints.
- **Agents** (`agents/`): architect, auditor, reviewer, implementer, skill-curator, adr-scribe. Persistent memory lives in each project's `.claude/agent-memory/`.
- **Skills** (`skills/`): generic process skills that the loop rewrites after every phase when an agent misreads or misuses them, each change proven by an eval.
- **Hooks** (`hooks/`): incident capture, retro gate, agent rollover, ADR scribe, planning lessons, status line.

Project-specific configuration lives in the project's `.claude/ouroboros.json` and its own domain skills.

Status: under construction, first used on a price-feed ingestion refactor.
