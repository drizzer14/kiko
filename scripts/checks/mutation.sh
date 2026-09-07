#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
BIN="$ROOT/node_modules/.bin/stryker"

if [ ! -x "$BIN" ]; then
  print_block \
    "Stryker (mutation testing)" \
    "The stryker tool is not installed in node_modules." \
    "$BIN was not found or is not executable." \
    "The harness tools live in node_modules. Without them, no check can run, and a missing tool must not look like a code problem." \
    "Run: npm install   then re-run: npm run check:mutation" \
    "Do not run stryker through npx without --no-install (that can auto-fetch an unpinned version from the network). Install the pinned version with npm install."
  exit 2
fi

# Single-flight guard: never spawn a second Stryker while one runs. Two
# concurrent mutation runs each start the full Jest suite and can orphan
# workers, which drove machine load to 152 on one occasion. Reclaim a
# stale lock automatically if the prior run's process is gone.
state="$(harness_state_dir "$ROOT")"
mkdir -p "$state" 2>/dev/null || true
lock="$state/mutation.lock"
if ! harness_lock "$lock" 5; then
  print_block \
    "Stryker (mutation testing)" \
    "A mutation run is already in progress for this worktree." \
    "The single-flight lock at $lock is held by a live process." \
    "Two concurrent Stryker runs each start the full Jest suite and can orphan workers, which overloads the machine." \
    "Wait for the running mutation check to finish, then re-run: npm run check:mutation" \
    "Do not start a second mutation run in parallel. Wait for the first to finish."
  exit 2
fi
trap 'harness_unlock "$lock"' EXIT

# Content dedup: skip a full mutation run when no mutation-relevant source
# changed since the last passing run. This stops a re-run after a change
# Stryker never mutates (an icon asset, an ios/ file, a doc), the case a
# developer agent hit when it re-ran check:deep after only an icon was added.
fp="$(harness_code_fingerprint "$ROOT")"
if harness_unchanged "$ROOT" "mutation" "$fp"; then
  exit 0
fi

out="$("$BIN" run 2>&1)"
code=$?
if [ "$code" -ne 0 ]; then
  print_block \
    "Stryker (mutation testing)" \
    "Mutation score fell below the break threshold (60)." \
    "$out" \
    "A surviving mutant means the test suite would not catch a real regression in that code path. Tests that run but assert nothing give false confidence, a common LLM failure mode." \
    "Add a real assertion that fails when the mutated code is wrong. Re-run: npm run check:mutation" \
    "Do not delete the failing mutant's test. Add a real assertion that fails when the code is wrong."
  exit 2
fi

# Passed: record the fingerprint so an identical source state skips next time.
harness_mark_pass "$ROOT" "mutation" "$fp"
exit 0
