# Upstream requests

## Continue a workflow agent by id

**Ask:** let a workflow script continue an agent it started. For example, have `agent()` return the agent's id next to its result and add `agent.continue(id, prompt, opts)`, or accept `opts.continue: id`. The continued agent should keep its conversation and prompt cache.

**Why:** a phase workflow hands each blocking review finding back to the task that owns the code. Today the only option is a fresh fixer, which has lost everything the implementer learned: why the code has its shape, which tests prove what, and the gotchas it hit (test database setup, cassette quirks, type signatures). In one real phase of 8 tasks, implementers ended at 91k to 245k tokens each, 1.36M across the phase. Fix rounds often needed several cycles for the same task, because the fixer rebuilt the context and sometimes patched against the author's design. While the prompt cache is warm, continuing the author would cost little more than the new turn.

**What the plugin would do with it:** continue the author only when it is cheap:

- it finished less than about 50 minutes ago, inside the cache TTL;
- its context is under a limit (150k tokens by default);
- the task has had fewer than 2 fix attempts.

Otherwise it would fall back to a fresh fixer. The resume message would carry only the findings and the recheck rules. The plugin would also record tokens per fix, which `agent()` does not report today.

**Meanwhile:** each implementer leaves a handoff note of at most 300 words: its decisions, the gotchas it hit, its exact test commands, and the files it chose not to touch. The note is returned in the result and also written to disk, so it survives a killed session. Every fix prompt carries the note.
