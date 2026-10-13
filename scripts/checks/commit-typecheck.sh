#!/usr/bin/env bash
# Body of githooks/pre-commit and githooks/pre-merge-commit: runs `tsc --noEmit` on a temporary
# copy of the STAGED index, so each commit typechecks by itself. Typecheck only: the rest of
# check:all takes minutes and already runs on the Stop tier, so a commit gate that ran it would
# make every commit slow.
#
# The copy is the commit's own tree (`git checkout-index` of the index git hands the hook), so an
# unstaged fix cannot make a bad commit pass and an unstaged or untracked broken file cannot make a
# good commit fail. It lives outside the worktree, so jest, knip, and tsc never see it.
#
# Silent on success. On a type error or a missing tool it prints the structured block to stderr and
# exits 2, which aborts the commit. A commit whose staged diff touches no file tsc reads exits 0
# without a run: the result then equals HEAD's. Bash 3.2-safe (the macOS system bash).
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
BIN="$ROOT/node_modules/.bin/tsc"
NAME="TypeScript on the staged commit (pre-commit)"
# tsc reads these and node_modules, and node_modules follows package(-lock).json.
SOURCE_FILES='\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json)$'

# Git may hand the hook a relative index path, which `cd` below would break.
if [ -n "${GIT_INDEX_FILE:-}" ]; then
  case "$GIT_INDEX_FILE" in
    /*) ;;
    *) GIT_INDEX_FILE="$PWD/$GIT_INDEX_FILE" ;;
  esac
  export GIT_INDEX_FILE
fi
cd "$ROOT" || exit 2

# --no-renames lists the old name of a renamed file too: a source file renamed to a non-source
# name removes a tsc input. -z keeps a non-ASCII name unquoted, so its extension still matches.
if git rev-parse -q --verify HEAD > /dev/null 2>&1; then
  base="HEAD"
else
  base="$(git hash-object -t tree /dev/null)"
fi
# A failed diff fails the assignment and the check runs: it never skips on a doubt, and neither
# does a grep error (exit 2): only grep's exit 1 (no match) skips. A here-string, not a pipe, feeds
# grep -q: an early exit would SIGPIPE the producer and read as no match.
if changed="$(git diff --cached --name-only --no-renames -z "$base" | tr '\0' '\n')"; then
  grep -Eq "$SOURCE_FILES" <<< "$changed"
  [ "$?" -eq 1 ] && exit 0
fi

block() {
  # $1 what  $2 details  $3 why  $4 howto
  print_block "$NAME" "$1" "$2" "$3" "$4" \
    "Do not commit with --no-verify or -n, do not pass -c core.hooksPath=..., and do not add @ts-expect-error, widen a type to any, or exclude a file from tsconfig.json to get green."
}

TOOLS_WHY="Each commit must typecheck by itself. A missing tool must not look like a clean commit, so the commit is refused."
if [ ! -x "$BIN" ]; then
  block \
    "The typescript compiler is not installed in node_modules." \
    "$BIN was not found or is not executable." \
    "$TOOLS_WHY" \
    "Run: npm ci   then commit again."
  exit 2
fi
if ! command -v node > /dev/null 2>&1; then
  block \
    "node is not on PATH, and tsc needs it." \
    "git ran this hook with PATH=$PATH" \
    "$TOOLS_WHY" \
    "Commit from a shell where node is on PATH (a GUI git client may not pass it), or install node."
  exit 2
fi

snapshot="$(mktemp -d "${TMPDIR:-/tmp}/kiko-typecheck.XXXXXX")" || {
  block \
    "Could not create the temporary folder for the staged copy." \
    "mktemp -d failed under ${TMPDIR:-/tmp}." \
    "$TOOLS_WHY" \
    "Free space or fix permissions on TMPDIR, then commit again."
  exit 2
}
cleanup() { rm -rf "$snapshot"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

tree="$snapshot/tree"
if ! mkdir "$tree" \
  || ! checkout_output="$(git checkout-index --all --prefix="$tree/" 2>&1)" \
  || ! ln -s "$ROOT/node_modules" "$tree/node_modules"; then
  block \
    "Could not write the staged copy of the index." \
    "${checkout_output:-git checkout-index or ln failed under $snapshot}" \
    "$TOOLS_WHY" \
    "Fix the error above, then commit again."
  exit 2
fi

# tsc is the subshell's own process (exec), so a signal that reaches this script waits for it and
# then runs the traps above, which remove the copy.
(cd "$tree" && exec "$BIN" --noEmit -p .) > "$snapshot/tsc.log" 2>&1
code=$?
if [ "$code" -ne 0 ]; then
  block \
    "tsc reported type errors in the staged files." \
    "$(cat "$snapshot/tsc.log")" \
    "A type error committed here lands on the branch, and the next commit has to carry the fix. The paths above are in the staged copy; they read as they do in the repository." \
    "Fix the type at its source and git add the fix: the check reads the index, so an unstaged fix does not count. To reproduce the working tree: npm run check:typecheck"
  exit 2
fi
exit 0
