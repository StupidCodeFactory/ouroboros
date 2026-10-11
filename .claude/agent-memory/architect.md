# Architect memory

- Node scripts under `scripts/` import `hooks/**/*.ts` directly with `node --experimental-strip-types --no-warnings` (node 22); see `scripts/check_workflow_mirrors.mjs`.
- `scripts/guard_no_outside_skills.sh` scans `agents hooks skills workflows scripts README.md`: no home paths, outside skill names or `.git/info/project-names` entries there.
- Only lane is `docs` (README.md, assets/**); nothing owns `scripts/**` or `hooks/**`, so tasks there fall back to it.
- GitHub settings defaults live in `githubConfigOf` (`hooks/github/gh_commands.ts`); reuse it, never re-declare column or field names.
- Node 22 `node --test <dir>` fails with MODULE_NOT_FOUND; pass files or a glob (`scripts/acceptance/*.test.mjs`). An ESM entry guard compares `realpathSync(process.argv[1])` with `fileURLToPath(import.meta.url)`, never `new URL(...).pathname` (percent-encodes spaces, so `main` silently never runs).
