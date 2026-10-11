# implementer-docs memory

- Run scripts from the checkout root with `node --experimental-strip-types --no-warnings`; .mjs files import `hooks/github/*.ts` with the `.ts` extension (pattern: scripts/check_workflow_mirrors.mjs).
- Build task-body fixtures with `renderTaskBody` from hooks/github/contract.ts instead of hand-writing markdown; `contractGaps` is the only validity check.
- scripts/acceptance/scratch_milestone.mjs owns env checks (`requireEnv`, exit 2) and the read-only sub-issue listing; acceptance scripts import it rather than calling gh themselves. Exit codes: 2 missing input, 1 any gap, 0 clean.
- Inside a worktree the rtk hook rewrites `git` and the sandbox refuses it; call `/usr/bin/git` directly, one git command per Bash call, no `&&` chains with git.
- The Write tool cannot reach the main checkout; the plan file and handoff copies there are written with Bash (sed, cp).
- Lane test is ./scripts/pre-push (~5s), lint is ./scripts/guard_no_outside_skills.sh; neither discovers scripts/acceptance/*.test.mjs, run those with `node ... --test` explicitly.
