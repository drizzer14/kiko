#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
cd "$ROOT" || exit 2

fail() {
  # $1 what  $2 details
  print_block \
    "Shipped migration changed" \
    "$1" \
    "$2" \
    "A migration under drizzle/migrations/ that already shipped has run on user devices. The runner (src/db/run-migrations.ts) counts applied migrations and never re-runs one, so an edit to its bytes, even a comment, never reaches a device that applied it." \
    "Restore each named .sql, snapshot or other file to its content at the named base commit (git show <base sha>:<path> > <path>; a deleted or renamed file the same way). For meta/_journal.json and migrations.js restore only the named entry or line to its base content and keep the appended entries and inserted lines; restoring the whole file would drop them. Then put the new behavior in a NEW migration. A new migration adds a new .sql, a new snapshot, one appended journal entry, and inserted migrations.js lines." \
    "Do not edit a shipped migration, not even a comment. There is no override and no exemption list. Do not restore with git checkout, git restore, git stash or git clean."
  exit 2
}

# The baseline is what already shipped: the merge-base of HEAD with each local
# branch of main and next. next is optional, main is not. Prints the base sha;
# returns 1 when the branch is missing or shares no history with HEAD (merge-base
# exit 1), and 2 when git itself failed (any other merge-base exit).
resolve_base() {
  local branch="$1" tip base code
  tip="$(git rev-parse -q --verify "refs/heads/$branch^{commit}" 2>/dev/null)" || return 1
  base="$(git merge-base HEAD "$tip" 2>/dev/null)"
  code=$?
  case "$code" in
    0) printf '%s\n' "$base" ;;
    1) return 1 ;;
    *) return 2 ;;
  esac
}

bases=()
mainBase="$(resolve_base main)"
mainCode=$?
case "$mainCode" in
  0) bases+=("$mainBase") ;;
  1) fail \
       "The shipped baseline could not be resolved: the local main branch is missing, or it shares no history with HEAD." \
       "Cannot tell which migrations shipped, so the check fails closed. Create or fetch the local branch main." ;;
  *) fail \
       "The shipped baseline could not be resolved: git merge-base failed against main." \
       "Cannot tell which migrations shipped, so the check fails closed." ;;
esac

nextBase="$(resolve_base next)"
nextCode=$?
case "$nextCode" in
  0) bases+=("$nextBase") ;;
  1) : ;;
  *) fail \
       "The shipped baseline could not be resolved: git merge-base failed against next." \
       "Cannot tell which migrations shipped, so the check fails closed." ;;
esac

# Inputs: the base shas, the name and git blob hash of every file under
# drizzle/migrations/ (one git process hashes the tree), and the checker. A
# failure to hash leaves the fingerprint empty, which never matches, so the
# check runs.
fp=""
if files="$(find drizzle/migrations -type f 2>/dev/null | LC_ALL=C sort)" \
  && hashes="$(printf '%s\n' "$files" | git hash-object --no-filters --stdin-paths 2>/dev/null)"; then
  fp="$( {
    printf '%s\n' "${bases[@]}"
    printf '%s\n' "$files"
    printf '%s\n' "$hashes"
    shasum "$DIR/shipped-migrations.js" 2>/dev/null
  } | harness_hash )"
fi
if harness_unchanged "$ROOT" "shipped-migrations" "$fp"; then
  exit 0
fi

out="$(node "$DIR/shipped-migrations.js" "$ROOT" "${bases[@]}" 2>&1)"
code=$?
case "$code" in
  0) : ;;
  1) fail \
       "A file under drizzle/migrations/ that already shipped was modified, deleted or renamed." \
       "$out" ;;
  *) fail \
       "The shipped-migrations checker could not run, so the check fails closed." \
       "$out" ;;
esac

harness_mark_pass "$ROOT" "shipped-migrations" "$fp"
exit 0
