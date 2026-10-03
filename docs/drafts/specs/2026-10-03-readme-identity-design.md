# M1: README and visual identity

## Goal
Give ouroboros a visual identity and a README that sells the loop in one screen: a mark, a wordmark, a banner, and a README rebuilt around them.

## Identity
- Mark: an ouroboros (snake eating its tail) drawn as a loop. It reads as a cycle at 16px and as a snake at 256px.
- Wordmark: `ouroboros` in lowercase, one typeface, tight tracking.
- Palette: two colors plus neutral. Each color passes WCAG AA on both the GitHub light and dark backgrounds.
- Formats: hand-written SVG only, no raster files. Light and dark variants served through `<picture>` with `prefers-color-scheme`.
- Files: `assets/mark.svg`, `assets/mark-dark.svg`, `assets/banner.svg`, `assets/banner-dark.svg`, `assets/loop.svg` (diagram).

## README
- Banner at the top, then the tagline "The dev loop that eats its own mistakes."
- A loop diagram (`assets/loop.svg`): kickoff, phase (implement, review, fix, checkpoint), retro rewrites skills, back into the next phase.
- Sections: What it is, How the loop works, Install, Project setup, Commands, Development. Keep every fact the current README states. Move none of them to other files.
- Text is GitHub-flavored markdown and stays readable with images off: every image has alt text.

## Constraints
- `scripts/guard_no_outside_skills.sh` scans README.md: the README must not name any outside plugin or skill.
- No build step, no new dependency, no external image host.
- GitHub strips `<style>` and scripts from README HTML, so SVGs must be self-contained, with no external fonts. Convert the wordmark text to paths.

## Out of scope
Website, social cards, and changes to the plugin manifest.
