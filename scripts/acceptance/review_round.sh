#!/bin/sh
"$(dirname "$0")/snapshot.sh" | jq -e -f "$(dirname "$0")/review_round.jq" >/dev/null
