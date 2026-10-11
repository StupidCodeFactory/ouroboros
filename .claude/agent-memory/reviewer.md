# Reviewer memory

- Node here is 22.x: `node --test <directory>` fails with "Cannot find module"; pass files or a quoted glob (`'scripts/acceptance/*.test.mjs'`).
- Entry-point guard `process.argv[1] === new URL(import.meta.url).pathname` silently skips main on percent-encoded paths (spaces); use `fileURLToPath(import.meta.url)`.
- ISO timestamps from GitHub (`...Z`, no millis) must be compared with `Date.parse`, not string `>`, against values written by node (`toISOString()` has millis).
