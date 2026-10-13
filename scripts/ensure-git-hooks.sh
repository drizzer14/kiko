#!/usr/bin/env bash
# `postinstall` step: points core.hooksPath at the tracked githooks/ folder, so every commit runs
# githooks/pre-commit. The setting lives in the common git config, so one run covers the main
# checkout and every worktree of the repository.
#
# unset                  -> set it to githooks (a failed write: the standard block and exit 2)
# already githooks       -> nothing
# unreadable             -> the standard block and exit 2: only `git config --get` exit 1 is unset
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
read_status=$?
# Only exit 1 means the key is absent. Any other failure (an unreadable config, for example) says
# nothing about the setting, so it must not read as unset: the hook would stay uninstalled silently.
if [ "$read_status" -ne 0 ] && [ "$read_status" -ne 1 ]; then
  print_block \
    "core.hooksPath could not be read" \
    "git config --get core.hooksPath failed with exit $read_status, so the setting is unknown." \
    "$(git -C "$ROOT" config --get core.hooksPath 2>&1 > /dev/null)" \
    "Without the setting the tracked githooks/ folder does not run, and no commit is typechecked." \
    "Fix the git config error above (git config --show-origin --list shows the files), and run: npm ci" \
    "Do not skip postinstall (npm ci --ignore-scripts) to get past it."
  exit 2
fi
if [ -z "$current" ]; then
  if ! write_output="$(git -C "$ROOT" config core.hooksPath "$WANTED" 2>&1)"; then
    print_block \
      "core.hooksPath could not be set" \
      "git config core.hooksPath $WANTED failed, so the tracked githooks/ folder would not run." \
      "$write_output" \
      "Without the setting no commit is typechecked, and a green npm ci would hide that." \
      "Fix the git config error above (a leftover .git/config.lock is the usual cause), and run: npm ci" \
      "Do not skip postinstall (npm ci --ignore-scripts) to get past it."
    exit 2
  fi
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
