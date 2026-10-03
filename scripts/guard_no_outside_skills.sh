#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
hits=$(grep -rniE 'caveman|ponytail|superpowers|mattpocock' agents hooks skills workflows README.md --exclude=incidents.md)
[ -z "$hits" ] && exit 0
printf '%s\n' "$hits"
exit 1
