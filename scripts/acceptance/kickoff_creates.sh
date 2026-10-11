#!/bin/sh
exec node --experimental-strip-types --no-warnings "$(dirname "$0")/kickoff_record.mjs" creates "$@"
