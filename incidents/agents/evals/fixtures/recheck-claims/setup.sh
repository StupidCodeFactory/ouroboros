#!/bin/sh
set -e
target="$1"
cp -R "$(dirname "$0")/." "$target"
cd "$target"
rm setup.sh
git init -q
git add months.py test_months.py
git -c user.name=fixture -c user.email=fixture@example.com commit -qm "feat: months_between"
printf 'def months_between(start, end):\n    years = end // 100 - start // 100\n    return years * 12 + (end %% 100 - start %% 100) + (1 if years == 0 else 0)\n' > months.py
git -c user.name=fixture -c user.email=fixture@example.com commit -qam "fix: months_between counts both ends" -m "Fixes the off-by-one finding at months.py:3. python -m unittest test_months: Ran 2 tests, OK."
