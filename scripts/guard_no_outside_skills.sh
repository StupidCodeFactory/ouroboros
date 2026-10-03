#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
PLUGIN_PATHS='agents hooks skills workflows scripts README.md'
outside_skills=$(grep -rniE 'caveman|ponytail|superpowers|mattpocock' agents hooks skills workflows README.md --exclude=incidents.md)
home_paths=$(grep -rnE '/(Users|home)/[A-Za-z0-9_-]+/' $PLUGIN_PATHS)
names_file=$(git rev-parse --git-path info/project-names 2>/dev/null)
project_names=''
[ -s "$names_file" ] && project_names=$(grep -rniFf "$names_file" $PLUGIN_PATHS)
hits=$(printf '%s\n%s\n%s\n' "$outside_skills" "$home_paths" "$project_names" | sed '/^$/d')
[ -z "$hits" ] && exit 0
printf '%s\n' "$hits"
exit 1
