# Reviewer memory

- Node is 22.x: `node --test <directory>` fails with "Cannot find module"; pass files or a quoted glob.
- An entry-point guard `process.argv[1] === new URL(import.meta.url).pathname` skips main on percent-encoded paths (spaces); use `fileURLToPath(import.meta.url)`.
- Compare GitHub ISO timestamps (`...Z`, no millis) with node-written ones (`toISOString()`, millis) through `Date.parse`, never string `>`.
