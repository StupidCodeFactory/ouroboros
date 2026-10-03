---
name: code-style
description: Load before writing or reviewing any code in a phase; the style rules tools and the architect enforce.
---
# Code style

- Small functions with names that explain them; no comments.
- Variable names say what they hold: plural collections (`orders`, `pending_jobs`), singular items (`order`, `retry_job`), `_id` for identifiers, `_ms` for epoch milliseconds, `_at` for times, and the language's predicate idiom (`?` in Ruby, `is_`/`has_` in Python, `is`/`has` in TypeScript).
- Early returns and guard clauses; no nested if/else; no `else` after `return`.
- Extract shared code on the second real copy; never abstract for code that does not exist yet. A design pattern is used only when it removes code or branches.
- The lane's `lint` command from `.claude/ouroboros.json` enforces these rules mechanically. New code adds zero offenses; the count never exceeds the lane's `lint_baseline` and only goes down.
- Language-specific rules (linter cops, test idioms) live in the project's lane skills, never here.
