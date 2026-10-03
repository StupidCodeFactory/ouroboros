---
name: findings-contract
description: Load when reviewing or auditing; the fenced findings JSON block every reviewer, architect and auditor result must end with.
---
# Findings contract

When your caller gives you a result schema with `findings`, return them there and print no fenced block. Otherwise end every review or audit with one fenced JSON block tagged `findings`:

```findings
{"findings": [{"file": "src/orders/sync.rb", "line": 12, "summary": "…", "root_cause": "code-bug|skill-gap|skill-misread|skill-misuse|agent-behaviour", "skill": "<skill-name>", "agent": "implementer:<lane>"}]}
```

- `file` and `line` point at the code; `summary` is one sentence a fix can act on.
- `root_cause` is exactly one of the five values below. `skill` names the skill at fault (omit for `code-bug` and `agent-behaviour`); `agent` is `<name>` or `<name>:<lane>`.
- An empty review still ends with `{"findings": []}`.

## Root causes

| root_cause | Meaning | Example |
|---|---|---|
| `code-bug` | the code is wrong and no skill or agent definition caused it | an off-by-one in a pagination window; no skill discusses window ends |
| `skill-gap` | no skill covers the situation the agent faced | the agent invented a dedup key because no skill names one |
| `skill-misread` | the skill covers it clearly and the agent read it wrong | the skill says "reschedule, never sleep" and the agent slept |
| `skill-misuse` | the agent read the skill correctly and applied it where it does not apply | the agent applied a concurrency-test rule to a plain unit test |
| `agent-behaviour` | the agent definition, not a skill, produced the fault | the implementer merged a PR although its definition forbids merging |

Hooks append `skill-gap`, `skill-misread` and `skill-misuse` findings to the named skill's `incidents.md` and `agent-behaviour` findings to the agent's incidents, status `open`. `code-bug` findings go back to the implementer.
