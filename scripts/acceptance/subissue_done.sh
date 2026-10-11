#!/bin/sh
"$(dirname "$0")/snapshot.sh" | jq -e -f "$(dirname "$0")/subissue_done.jq" >/dev/null
