# Plan for M1: README and visual identity

**Spec:** `docs/drafts/specs/2026-10-03-readme-identity-design.md`

Lane: docs. Test with `./scripts/pre-push`.

### Task 1: mark and palette (P0)
- [ ] Pick the two-color palette and record its hex values and AA contrast ratios on `#ffffff` and `#0d1117` in the PR body
- [ ] Draw `assets/mark.svg` and `assets/mark-dark.svg` as self-contained SVGs, legible at 16px and 256px
- [ ] Check that both files render in a browser at 16px and 256px

### Task 2: wordmark and banner (P0)
- [ ] Draw `assets/banner.svg` and `assets/banner-dark.svg`: mark plus `ouroboros` wordmark as paths, no `<text>` and no external fonts
- [ ] Check that `grep -L '<text\|@import\|href="http' assets/*.svg` lists every SVG

### Task 3: loop diagram (P1)
- [ ] Draw `assets/loop.svg`: kickoff, phase (implement, review, fix, checkpoint), retro, next phase, readable in light and dark
- [ ] Check that every label in the diagram matches a workflow or stage name used in `workflows/`

### Task 4: README rewrite (P1)
- [ ] Rebuild `README.md` around the banner (`<picture>` with light and dark sources), tagline and loop diagram
- [ ] Keep every fact from the current README: install, function-hooks env, project setup JSON, kickoff discovery, effort map, workflow args, development
- [ ] Add alt text to every image
- [ ] Run `./scripts/pre-push` and confirm it passes
