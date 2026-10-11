---
name: migrate-plan-to-issues
description: Load when the user asks to migrate a project from the plan-file flow to GitHub-native milestones; one-off, deleted after the migration ships.
---
# Migrate a project to GitHub-native milestones

Run each step in order. After each step, show the user what changed and wait for a go before the next. Every step is safe to rerun: it looks before it creates.

Pass `-R <owner>/<repo>` to every `gh issue` command. Never write tokens, secrets or transcript text into an issue body or comment.

## 1. Confirm the PRD

- Look for the PRD in the repository: `git ls-files | grep -i prd`, skipping `.claude/worktrees/`.
- Ask the user to confirm the one you found, or to name one when you found none or several. Stop on a no.
- Its milestones are the `###` headings under its `## Milestones` heading that open with a milestone code (`M0.`, `MX.`, `M1.`, ...).

## 2. The board

- Ask which project board to use, or whether to create one (`gh project create --owner <owner> --title <title>`, then `gh project link`).
- Ask for the columns, in order. Default: Milestones, Planned, In Progress, QA, Done.
- Before changing the Status field, save every item's status: `gh project item-list <n> --owner <owner> --limit 500 --format json` into the scratchpad.
- Agree with the user how each old Status option maps to a new column. A renamed option is a mapping, not a new column.
- Replace the options in one call; this clears every item's Status:
  `gh api graphql -f query='mutation($f:ID!,$o:[ProjectV2SingleSelectFieldOptionInput!]){updateProjectV2Field(input:{fieldId:$f,singleSelectOptions:$o}){projectV2Field{... on ProjectV2SingleSelectField{options{id name}}}}}'`
- Set each saved item's status again through the mapping: `gh project item-edit --id <item> --project-id <project> --field-id <status> --single-select-option-id <option>`.
- Make sure a text field named Phase exists: `gh project field-create <n> --owner <owner> --name Phase --data-type TEXT`.
- Check: the item count is unchanged, and the count per new column equals the mapped counts from the saved file.

## 3. Milestone issues

For each PRD milestone, in PRD order:

- Title: the heading text without `###` (for example `M0. Foundations`). Skip it when an open issue with that title already exists.
- Body: the whole PRD section under that heading, verbatim.
- Create it, add it to the board (`gh project item-add`), and set its Status to the milestones column.

## 4. Existing issues become sub-issues

- For each open issue in a classic GitHub milestone, find the milestone issue whose code matches (classic `M1 Wizard without Meta` matches `M1. ...`).
- Skip an issue that already has a parent. Add the others: `gh api -X POST repos/<owner>/<repo>/issues/<milestone issue>/sub_issues -F sub_issue_id=<issue id>`, using the issue's numeric `id`, not its number.
- An issue that was in the old first column moves to the planned column; every other issue keeps its column.
- A milestone takes at most 100 sub-issues; stop and tell the user before passing that.
- Check: `gh api repos/<owner>/<repo>/issues/<milestone issue>/sub_issues --paginate --jq length` equals the classic milestone's open issue count.

## 5. Configuration

Write the keys the user chose into `.claude/ouroboros.json`: `prd`, and under `github` the `repo`, `project`, `status_field`, `phase_field` and `columns`. Show the diff; the user commits it.

Planning comes next, outside this skill: `/ouroboros kickoff <milestone issue>` revises the sub-issues and adds tasks.
