# implementer-docs memory

- Run scripts from the checkout root with `node --experimental-strip-types --no-warnings`; .mjs files import `hooks/github/*.ts` with the `.ts` extension (pattern: `scripts/check_workflow_mirrors.mjs`).
- The lane's test and lint never run `scripts/acceptance/*.test.mjs`; run them with `node --experimental-strip-types --no-warnings --test 'scripts/acceptance/*.test.mjs'` (Node 22 rejects a directory argument).
- Build task-body fixtures with `renderTaskBody` (`hooks/github/contract.ts`), never hand-written markdown; `contractGaps` is the only validity check.
- `scripts/acceptance/scratch_milestone.mjs` owns every gh call and env check (`requireEnv`, `scratchEnv`, `scratchSubIssues`, `commentsOf`, `statusOf`); acceptance scripts import it. Exit codes: 2 missing input, 1 any gap, 0 clean.
