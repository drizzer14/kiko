#!/usr/bin/env bash
# `postinstall` step: points core.hooksPath at the tracked githooks/ folder, so every commit runs
# githooks/pre-commit. The setting lives in the common git config, so one run covers the main
# checkout and every worktree of the repository.
#
# unset                  -> set it to githooks
# already githooks       -> nothing
# any other value        -> the standard block and exit 2: two hook systems must be merged by hand
# not a repository root  -> silent exit 0: no commit is possible from there, so there is nothing
#                           to guard (a scratch copy without .git, a source tarball)
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=/dev/null
source "$DIR/checks/_lib.sh"
ROOT="$(cd "$DIR/.." && pwd -P)"
WANTED="githooks"

# A copy without its own .git inside another repository would resolve to that repository, and the
# setting would land in its config, so the toplevel must be this folder itself.
toplevel="$(git -C "$ROOT" rev-parse --show-toplevel 2> /dev/null)" || exit 0
[ "$(cd "$toplevel" && pwd -P)" = "$ROOT" ] || exit 0

current="$(git -C "$ROOT" config --get core.hooksPath 2> /dev/null)"
if [ -z "$current" ]; then
  git -C "$ROOT" config core.hooksPath "$WANTED"
  exit 0
fi
[ "$current" = "$WANTED" ] && exit 0

print_block \
  "core.hooksPath is not githooks" \
  "git config core.hooksPath is set to something else, so the tracked githooks/ folder would not run." \
  "core.hooksPath is '$current'. Find where it is set: git config --show-origin --get-all core.hooksPath" \
  "The pre-commit typecheck is the tracked githooks/ folder. Another hooks path means another hook system, and the two would not both run." \
  "Merge your hooks into githooks/ by hand, then unset yours (git config --unset core.hooksPath), and run: npm ci" \
  "Do not overwrite the setting from this script, and do not skip postinstall (npm ci --ignore-scripts) to get past it."
exit 2
