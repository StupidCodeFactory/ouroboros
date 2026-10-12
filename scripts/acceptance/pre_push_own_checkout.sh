#!/bin/sh
set -e
real_pre_push="$(cd "$(dirname "$0")/.." && pwd -P)/pre-push"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
tmp=$(cd "$tmp" && pwd -P)
git init -q --bare "$tmp/remote.git"
git init -q -b main "$tmp/main"
cd "$tmp/main"
git config user.email t@t && git config user.name t
mkdir scripts && cp "$real_pre_push" scripts/pre-push
git add . && git commit -qm init
git remote add origin "$tmp/remote.git"
git config core.hooksPath "$tmp/main/scripts"
git worktree add -q -b feature "$tmp/wt"
cd "$tmp/wt"
printf '#!/bin/sh\npwd -P > "%s/marker"\n' "$tmp" > scripts/pre-push
git commit -qam stub
git push -q origin feature 2>/dev/null
[ "$(cat "$tmp/marker" 2>/dev/null)" = "$tmp/wt" ]
