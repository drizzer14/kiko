#!/usr/bin/env bash
# Replay of the pre-write guard over every changed .ts/.tsx file the session
# changed, whatever wrote it — see guard-replay.js for which commits count,
# what BEFORE and AFTER are, and why. medium.sh runs it under its lock with
# `--stop-tier`, which adds the replay deadline; `npm run check:guard-replay`
# (also part of check:all) runs it with no deadline.
#
# Exit 0 (silent) on a pass. Exit 2 with the structured block when a change
# added a violation, when the Stop-tier deadline left files unchecked, and
# when the replay could not run at all (a git failure, a node crash): a replay
# that never ran must not read as a pass.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
cd "$ROOT"

runOptions=()
[ "${1:-}" = "--stop-tier" ] && runOptions=(--deadline)

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

# Read when the run starts: a commit made while this run is in flight is not
# reachable from the mark this run records, so the next run still replays it.
mark="$(harness_replay_mark "$ROOT")"
recordedMark="$(cat "$(harness_passfp_file "$ROOT" "guard-replay-mark")" 2>/dev/null)"

planErrors="$(mktemp)"
trap 'rm -f "$planErrors"' EXIT
plan="$(node "$DIR/guard-replay.js" plan ${recordedMark:+"$recordedMark"} 2>"$planErrors")" \
  || could_not_run "$(cat "$planErrors")"

if [ -z "$plan" ]; then
  harness_mark_pass "$ROOT" "guard-replay-mark" "$mark"
  exit 0
fi

# The plan pins each BEFORE (commit shas plus paths); the working-tree file
# is the AFTER; the guard, its Node checkers, and the prewrite rules are the
# engine.
fp="$( { printf '%s\n' "$plan"
        printf '%s\n' "$plan" | cut -f1 | while IFS= read -r file; do shasum "$file"; done
        cat "$DIR"/*.js "$DIR"/*.ts "$DIR/pre-write-guard.sh" "$DIR/guard-replay.sh" \
          "$ROOT/rules/semgrep-prewrite.yml" 2>/dev/null | shasum; } | harness_hash )"
if harness_unchanged "$ROOT" "guard-replay" "$fp"; then
  harness_mark_pass "$ROOT" "guard-replay-mark" "$mark"
  exit 0
fi

output="$(printf '%s\n' "$plan" | node "$DIR/guard-replay.js" run ${runOptions[@]+"${runOptions[@]}"} 2>&1)"
code=$?

if [ "$code" -eq 0 ]; then
  harness_mark_pass "$ROOT" "guard-replay" "$fp"
  harness_mark_pass "$ROOT" "guard-replay-mark" "$mark"
  exit 0
fi

if [ "$code" -eq 4 ]; then
  print_block \
    "Pre-write guard replay" \
    "The replay stopped at its Stop-tier deadline before replaying every changed file." \
    "$output" \
    "The Stop hook is killed at 300 s, and a killed hook ends the turn with no error and no check. Failing at the deadline keeps the unchecked files visible." \
    "Run: npm run check:guard-replay   It has no deadline, and its pass is recorded, so the next Stop skips the same files. Then fix anything it reports." \
    "Do not skip the Stop tier or delete the replay's state to get past this."
  exit 2
fi

[ "$code" -eq 2 ] || could_not_run "$output"

# Conflict markers of a merge still in progress do not parse, so the guard
# cannot check such a file; that is the unfinished merge, not a bypass.
if git rev-parse -q --verify MERGE_HEAD >/dev/null || [ -n "$(git ls-files -u)" ]; then
  print_block \
    "Pre-write guard replay" \
    "An unfinished merge is in progress (MERGE_HEAD or unmerged paths), and the replayed guard denies a changed file, most likely one that still holds conflict markers." \
    "$output" \
    "A file that still holds conflict markers does not parse, so no rule can check it. The Stop tier cannot pass until the merge is finished." \
    "Finish resolving the conflicts with Edit/Write (the pre-write guard checks each step), commit the merge, then re-run: npm run check:guard-replay. If you stopped to ask the user about the conflicts, say so; this failure is expected until then." \
    "Do not resolve the conflicts with Bash, python, or git checkout --ours/--theirs to get past this."
  exit 2
fi

print_block \
  "Pre-write guard replay" \
  "A change this session made bypassed the pre-write guard (for example a Bash or python write, or a commit of one), and the replayed guard denies it: the change added a violation, or the guard could not check the file (fail closed)." \
  "$output" \
  "The pre-write guard sees only Edit/Write/MultiEdit. This replay runs the same guard on every changed file against its content before the session changed it, so only a violation the change added fails; a pre-existing one does not." \
  "Fix each named violation with Edit/Write/MultiEdit, so the guard checks the fix, or add a justified override comment. Re-run: npm run check:guard-replay" \
  "Do not rewrite the file with Bash or python to get past this, and do not delete the replay's state. Fix the code."
exit 2
