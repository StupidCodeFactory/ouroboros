# Auditor memory

- `claude plugin test .` (inside `./scripts/pre-push`, about 5s) discovers only `hooks/**/*.test.ts`; run `scripts/**/*.test.mjs` with `node --experimental-strip-types --no-warnings --test <file or quoted glob>`.
- README.md's install line names the plugin's own repository; scope a "no repository name in README" check (for example to the Development section), never README-wide.
