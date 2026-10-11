#!/bin/sh
"$(dirname "$0")/snapshot.sh" | jq -e -f "$(dirname "$0")/stacked_pr.jq" >/dev/null
