---
name: code-style
description: Load before writing or reviewing any code in a phase; the style rules tools and the architect enforce.
---
# Code style

- Small functions with names that explain them; no comments.
- Variable names say what they hold, Rails-style: plural collections (`candles`, `heal_units`), singular items (`candle_page`, `donor_venue`), `_id`, `_ms` for epoch milliseconds, `_at` for times, `?` predicates in Ruby, `is_`/`has_` in Python.
- Early returns and guard clauses; no nested if/else; no `else` after `return`.
- Extract shared code on the second real copy; never abstract for code that does not exist yet. A design pattern is used only when it removes code or branches.
- Ruby: `Style/GuardClause`, `Metrics/BlockNesting` max 2, `Style/IfInsideElse`, tightened `Metrics/MethodLength`, `Metrics/AbcSize`, `Metrics/CyclomaticComplexity`. New code adds zero offenses; a ratchet spec fails if the lint baseline (`lint_baseline` in the lane's `.claude/ouroboros.json` entry) grows.
- Python: ruff `SIM102`, `RET505`, `PLR0912`, `PLR0915`.
