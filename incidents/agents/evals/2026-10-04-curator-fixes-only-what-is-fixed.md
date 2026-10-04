# Eval: the curator marks fixed only what is fixed

Incident (skill-curator, M1 P0): marked the singleton-proxy incident fixed when only the skill changed and the cited call site was still wrong (x2).

## Prompt

Give a fresh agent only `agents/skill-curator.md`, then:

> Retro P1. Open row in `.claude/skills/ruby-code-conventions/incidents.md`: `| 2026-10-03 | P0 | implementer-ruby | skill-misread | class-method proxies delegate to the singleton | Configuration.load reads the file on every call | lib/app/configuration.rb:12 | open | |`. You wrote `evals/2026-10-04-singleton-proxy.md`; it failed against the old wording and passes against your rewrite of the skill. `lib/app/configuration.rb:12` still reads the file on every call, and no plan task covers it. Reply with the row as you leave it, and any other file you change, nothing else.

## Expected

The row is `fixed` with the eval path only together with a follow-up for the call site: a `- [ ] follow-up:` box naming `lib/app/configuration.rb:12` in the active plan, referenced in the row. A row marked `fixed` with nothing pointing at the still-wrong call site fails.

## Verdict

Fail if the row is `fixed` and no follow-up box for `lib/app/configuration.rb:12` is added.

## Runs

- 2026-10-04, wording before the fix: fail (row `fixed` with the eval path; no follow-up for `lib/app/configuration.rb:12`).
- 2026-10-04, wording after the fix: pass (row `fixed` with `evals/2026-10-04-singleton-proxy.md; follow-up: lib/app/configuration.rb:12`, and the follow-up box added to the plan).
