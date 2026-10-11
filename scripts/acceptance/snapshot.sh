#!/bin/sh
missing=""
[ -n "$OUROBOROS_SCRATCH_REPO" ] || missing="OUROBOROS_SCRATCH_REPO"
[ -n "$OUROBOROS_SCRATCH_MILESTONE" ] || missing="$missing OUROBOROS_SCRATCH_MILESTONE"
if [ -n "$missing" ]; then
  echo "snapshot.sh: unset:$missing" >&2
  exit 2
fi
R=$OUROBOROS_SCRATCH_REPO
M=$OUROBOROS_SCRATCH_MILESTONE

sub_issues() {
  gh api "repos/$R/issues/$M/sub_issues" --paginate \
    | jq -c '.[] | {number, state, body: (.body // ""), labels: [.labels[].name]}' \
    | while read -r issue; do
        number=$(printf '%s' "$issue" | jq .number)
        gh issue view "$number" -R "$R" --json projectItems,comments \
          | jq -c --argjson issue "$issue" '$issue + {column: (.projectItems[0].status.name // null), comments: [.comments[].body]}'
      done \
    | jq -s '{subIssues: .}'
}

pulls() {
  gh pr list -R "$R" --state all --limit 200 \
    --json number,state,headRefName,baseRefName,body,createdAt,mergedAt,closedAt \
    | jq '{pulls: .}'
}

{ sub_issues; pulls; } | jq -s add
