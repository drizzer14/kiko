#!/usr/bin/env bash
# `postinstall` step: points core.hooksPath at the tracked githooks/ folder, so every commit runs
# githooks/pre-commit. The setting lives in the common git config, so one run covers the main
# checkout and every worktree of the repository.
#
# unset                  -> set it to githooks (a failed write: the standard block and exit 2)
# already githooks       -> nothing
# unreadable             -> the standard block and exit 2: only `git config --get` exit 1 is unset
# same folder, other     -> rewritten to githooks with one NOTICE line on stderr, exit 0: the value
# spelling                  resolves (realpath; a relative value against the repository root; git
#                           expands a leading ~) to the githooks folder of a worktree of THIS
#                           repository AND the last value is set in this repository's common
#                           config file (the relative githooks resolves in every worktree, an
#                           absolute path only in one). A global, config.worktree or include
#                           value, or another repository's folder, is a different case: the row
#                           below
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
write_wanted() {
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
}

# Prints the physical path of an existing folder, or fails. `cd -P` resolves every symlink, a
# trailing one included, and a path that is not a folder is not a hooks folder either.
resolve_folder() {
  (cd -P "$1" 2> /dev/null && pwd -P)
}

# Prints the physical path of a file's folder plus its name (the file itself may be a new path).
resolve_file() {
  local folder
  folder="$(resolve_folder "$(dirname "$1")")" || return 1
  printf '%s/%s\n' "$folder" "$(basename "$1")"
}

# Succeeds when the value of core.hooksPath is the githooks folder of a worktree of this
# repository, and the last value read comes from this repository's own common config file. A value
# from the global config, config.worktree, an include or the command line is not this repository's
# to rewrite, and neither is another repository's folder or another folder (.husky) of this one.
names_own_githooks_folder() {
  local origin_line origin common_config value folder worktree_line worktree_path
  origin_line="$(git -C "$ROOT" config --show-origin --get core.hooksPath 2> /dev/null)" || return 1
  origin="${origin_line%%$'\t'*}"
  case "$origin" in file:*) origin="${origin#file:}" ;; *) return 1 ;; esac
  case "$origin" in /*) ;; *) origin="$ROOT/$origin" ;; esac
  common_config="$(git -C "$ROOT" rev-parse --git-common-dir 2> /dev/null)" || return 1
  case "$common_config" in /*) ;; *) common_config="$ROOT/$common_config" ;; esac
  origin="$(resolve_file "$origin")" || return 1
  common_config="$(resolve_file "$common_config/config")" || return 1
  [ "$origin" = "$common_config" ] || return 1

  # --type=path expands a leading ~ the way git itself reads the setting; $current stays raw for
  # the messages.
  value="$(git -C "$ROOT" config --type=path --get core.hooksPath 2> /dev/null)" || return 1
  value="${value%/}"
  case "$value" in /*) ;; *) value="$ROOT/$value" ;; esac
  value="$(resolve_folder "$value")" || return 1
  while IFS= read -r worktree_line; do
    case "$worktree_line" in
      'worktree '*)
        worktree_path="${worktree_line#worktree }"
        folder="$(resolve_folder "$worktree_path/$WANTED")" || continue
        [ "$folder" = "$value" ] && return 0
        ;;
    esac
  done < <(git -C "$ROOT" worktree list --porcelain 2> /dev/null)
  return 1
}

if [ -z "$current" ]; then
  write_wanted
  exit 0
fi
[ "$current" = "$WANTED" ] && exit 0

if names_own_githooks_folder; then
  write_wanted
  printf 'NOTICE: core.hooksPath was %s, the githooks folder of this repository; rewrote it to %s.\n' \
    "$current" "$WANTED" >&2
  exit 0
fi

print_block \
  "core.hooksPath is not githooks" \
  "git config core.hooksPath is set to something else, so the tracked githooks/ folder would not run." \
  "core.hooksPath is '$current'. Find where it is set: git config --show-origin --get-all core.hooksPath" \
  "The pre-commit typecheck is the tracked githooks/ folder. Another hooks path means another hook system, and the two would not both run." \
  "Merge your hooks into githooks/ by hand, then ask the user to run git config --unset core.hooksPath (add --global when the origin is the global config; agents are denied it), and run: npm ci" \
  "Do not overwrite the setting from this script, and do not skip postinstall (npm ci --ignore-scripts) to get past it."
exit 2
