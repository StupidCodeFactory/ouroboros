#!/bin/sh
"$(dirname "$0")/snapshot.sh" | jq -e -f "$(dirname "$0")/kickoff_planned.jq" >/dev/null
