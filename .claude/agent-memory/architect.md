# Architect memory

- Scripts under `scripts/` import `hooks/**/*.ts` directly with `node --experimental-strip-types --no-warnings` (node 22; pattern: `scripts/check_workflow_mirrors.mjs`); `node --test` takes files or a quoted glob, never a directory (MODULE_NOT_FOUND).
- An ESM entry guard compares `realpathSync(process.argv[1])` with `fileURLToPath(import.meta.url)`, never `new URL(...).pathname` (percent-encodes spaces, so `main` never runs).
- The only lane is `docs`; nothing owns `scripts/**` or `hooks/**`, so tasks there fall back to it.
- GitHub settings defaults live in `githubConfigOf` (`hooks/github/gh_commands.ts`); reuse it, never re-declare column or field names.
