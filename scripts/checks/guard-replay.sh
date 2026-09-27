#!/usr/bin/env bash
# Stop-tier replay of the pre-write guard over every .ts/.tsx file the session
# changed outside Edit/Write/MultiEdit — see guard-replay.js for what BEFORE
# and AFTER are and why. medium.sh runs it under its lock; it is also
# `npm run check:guard-replay` and part of check:all.
#
# Exit 0 (silent) on a pass. Exit 2 with the structured block when a change
# added a violation, and also when the replay could not run at all (a git
# failure, a node crash): a replay that never ran must not read as a pass.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
cd "$ROOT"

could_not_run() {
  # $1 details
  print_block \
    "Pre-write guard replay" \
    "The pre-write guard replay could not run, so no changed file was checked." \
    "$1" \
    "A replay that never ran must not look like a pass. A Bash or python write that added a violation would then reach a commit unchecked." \
    "Read the error above. Fix what it names (the git state, a missing node or semgrep), or report the harness bug. Re-run: npm run check:guard-replay" \
    "Do not skip the Stop tier or delete the replay's state to get past this."
  exit 2
}

# Read when the run starts: a commit made while this run is in flight is
# newer than the mark this run records, so the next run still replays it.
mark="$(harness_replay_mark "$ROOT")"
since="$(cat "$(harness_passfp_file "$ROOT" "guard-replay-mark")" 2>/dev/null)"
since="${since%% *}"

planErrors="$(mktemp)"
trap 'rm -f "$planErrors"' EXIT
plan="$(node "$DIR/guard-replay.js" plan ${since:+"$since"} 2>"$planErrors")" \
  || could_not_run "$(cat "$planErrors")"

if [ -z "$plan" ]; then
  harness_mark_pass "$ROOT" "guard-replay-mark" "$mark"
  exit 0
fi

# The plan pins each BEFORE (a commit sha plus a path); the working-tree
# file is the AFTER; the guard, its Node checkers, and the prewrite rules are
# the engine.
fp="$( { printf '%s\n' "$plan"
        printf '%s\n' "$plan" | cut -f1 | while IFS= read -r file; do shasum "$file"; done
        cat "$DIR"/*.js "$DIR"/*.ts "$DIR/pre-write-guard.sh" "$DIR/guard-replay.sh" \
          "$ROOT/rules/semgrep-prewrite.yml" 2>/dev/null | shasum; } | harness_hash )"
if harness_unchanged "$ROOT" "guard-replay" "$fp"; then
  harness_mark_pass "$ROOT" "guard-replay-mark" "$mark"
  exit 0
fi

output="$(printf '%s\n' "$plan" | node "$DIR/guard-replay.js" run 2>&1)"
code=$?

if [ "$code" -eq 0 ]; then
  harness_mark_pass "$ROOT" "guard-replay" "$fp"
  harness_mark_pass "$ROOT" "guard-replay-mark" "$mark"
  exit 0
fi

[ "$code" -eq 2 ] || could_not_run "$output"

print_block \
  "Pre-write guard replay" \
  "A change this session made bypassed the pre-write guard (for example a Bash or python write, or a commit of one), and the replayed guard denies it: the change added a violation, or the guard could not check the file (fail closed)." \
  "$output" \
  "The pre-write guard sees only Edit/Write/MultiEdit. This replay runs the same guard on each changed file against its content before the session changed it, so only a violation the change added fails; a pre-existing one does not." \
  "Fix each named violation with Edit/Write/MultiEdit, so the guard checks the fix, or add a justified override comment. Re-run: npm run check:guard-replay" \
  "Do not rewrite the file with Bash or python to get past this, and do not delete the replay's state. Fix the code."
exit 2
