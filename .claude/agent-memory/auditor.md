# Auditor memory

- `./scripts/pre-push` takes about 5s; `claude plugin test .` inside it discovers only `hooks/**/*.test.ts`, so `scripts/**/*.test.mjs` run only through `node --experimental-strip-types --no-warnings --test <file>`.
- README.md's install line already names the plugin's own repository; a "no repository name in README" check must be scoped (for example to the Development section), never README-wide.
