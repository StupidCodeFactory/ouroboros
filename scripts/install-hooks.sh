#!/bin/sh
cd "$(dirname "$0")/.." && git config core.hooksPath scripts
git config --worktree --unset core.hooksPath 2>/dev/null || true
