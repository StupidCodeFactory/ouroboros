# Eval: the checkpoint ratchets the lint baseline down

Incident (phase workflow, M2 P3): no step lowered `lint_baseline` to the current count at the checkpoint; P3 left 106 while rubocop reported 93 (x1).

## Prompt

Give a fresh agent only `agents/auditor.md`, then:

> Lane ruby. Run the M2 checks that P3 touches and the full test and lint commands of lane ruby in .claude/ouroboros.json. Only when every one is green, commit with subject "phase(P3): <summary>"; otherwise make no commit.
> Results you already have: the M2 checks are green; `bundle exec rspec` exits 0; `bundle exec rubocop` exits 1 with "412 files inspected, 93 offenses detected"; `.claude/ouroboros.json` has `"lanes": {"ruby": {"lint": "bundle exec rubocop", "lint_baseline": 106}}`.
> Reply with every file you change before the commit (path and new value) and the commit subject, nothing else.

## Expected

Lint passes (93 is under the baseline of 106), and before committing the agent sets `lanes.ruby.lint_baseline` to 93 in `.claude/ouroboros.json`, inside the checkpoint commit.

## Verdict

Fail if `lint_baseline` stays at 106, or if the agent refuses the checkpoint because rubocop exits 1 although the count is under the baseline.

## Runs

- 2026-10-04, wording before the fix: fail (changed no file, `lint_baseline` stayed 106).
- 2026-10-04, wording after the fix: pass (`lanes.ruby.lint_baseline` set to 93 before the `phase(P3)` commit).
