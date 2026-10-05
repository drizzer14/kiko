#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"

# The table path is the caller's, relative to where the caller stands (npm runs a script at the
# package root and keeps the caller's folder in INIT_CWD), so it is made absolute before the cd
# below moves us to the repository root.
table=""
if [ "$#" -eq 1 ]; then
  case "$1" in
    /*) table="$1" ;;
    *) table="${INIT_CWD:-$PWD}/$1" ;;
  esac
fi
cd "$ROOT" || exit 2

fail() {
  # $1 what  $2 details
  print_block \
    "Closure table" \
    "$1" \
    "$2" \
    "A closure table that names a range, a fix commit that is not in HEAD's history, or a pinning test that is not in the tree closes an id nothing fixed: a range or a task-title row hides an id that no commit touched." \
    "Write one row per id (Id | Status | Fix sha | Pinning test file:line | Fails on pre-fix source). Cite a commit that is an ancestor of HEAD and a test path:line that exists. An id with no sha or no test stays OPEN; a test not shown to fail on the pre-fix source is CLOSED-UNPROVEN. Re-run: npm run check:closure -- <table.md>" \
    "Do not expand a range by hand-waving, invent a sha or a line number, or weaken the check. Fix the table."
  exit 2
}

if [ "$#" -ne 1 ]; then
  fail "Usage: closure-table.sh <table.md> takes exactly one Markdown closure table file." \
    "Got $# arguments."
fi

out="$(node "$DIR/closure-table.js" "$table" 2>&1)"
code=$?
case "$code" in
  0) : ;;
  1) fail "The closure table $1 has rows that do not hold up." "$out" ;;
  *) fail "The closure-table checker could not run, so the check fails closed." "$out" ;;
esac

exit 0
