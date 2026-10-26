#!/usr/bin/env bash
# make verify — the single end-of-work command for the developer and qa
# agents. Runs the three checks (lint, the full
# jest suite, the full gate) as ORDERED, FAIL-FAST stages: it stops at the
# first failing stage rather than running all three regardless (this is NOT
# a run-all). Each stage's stdout/stderr stream straight to the terminal
# (inherited fds — never captured or piped) so a failing stage's structured
# WHAT/DETAILS/... block reaches the agent unaltered.
#
# Deliberately `set -uo pipefail`, NOT `set -e`: each stage's exit code is
# captured explicitly so this script can print its own stage-failure marker
# before exiting with that code.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
cd "$ROOT" || exit 2

# Stage 3 (check:all) RE-RUNS lint as part of its own fast+medium tier. The
# standalone stage-1 lint below is an intentional, cheap early fail-fast: it
# catches a format/lint error in seconds, before spending minutes on the full
# jest suite and the rest of the gate.
#
# Stage 3 (check:all) also overlaps several checks that the Stop and
# SubagentStop medium tier runs (dup, knip, deps, typecheck, and more). Do NOT
# mistake that overlap for a bug and remove the stage — without stage 3, a
# `make verify` run that did not also fire the hooks would skip the gate
# entirely. The overlap does not REDO work across repeated sequential runs,
# because every check records a fingerprint of its own inputs on a PASS and
# skips the next identical run (the dedup helpers in scripts/checks/_lib.sh).
# That fingerprint dedup addresses repeat work only, not concurrency.
run_stage() {
  local num="$1" name="$2"
  shift 2
  echo "── make verify: stage $num ($name) ──"
  "$@"
}

run_stage 1 "lint" npm run check:lint
code=$?
if [ "$code" -ne 0 ]; then
  echo "✖ make verify FAILED at stage 1 (lint) — exit code $code" >&2
  exit "$code"
fi

# The suites that start the real semgrep run alone (2b), in band: beside the rest of the suite
# (2a) on every core they starve semgrep of CPU and its 5 s per-rule timer fires. The list is
# one file, shared with the pin in __tests__/semgrep-load-limits.test.ts. A --testPathIgnorePatterns
# on the command line REPLACES the config's own list, so the config's patterns are read back and
# passed again; each listed suite gets an anchored, dot-escaped pattern so it can swallow no
# other path (a bare path would also match `x.test.tsx` beside `x.test.ts`).
SEMGREP_SUITE_LIST="$DIR/semgrep-jest-suites.txt"
SEMGREP_SUITES=()
while IFS= read -r suite; do
  case "$suite" in
    '' | '#'*) ;;
    *) SEMGREP_SUITES+=("$suite") ;;
  esac
done < <(cat "$SEMGREP_SUITE_LIST" 2>/dev/null)

# A missing, empty or comments-only list would run no suite in 2b and leave the real-semgrep suites
# unproven, so it fails here with a block instead of an "unbound variable" abort under bash 3.2.
if [ "${#SEMGREP_SUITES[@]}" -eq 0 ]; then
  {
    echo "✖ make verify FAILED before stage 2: no suite is listed in scripts/checks/semgrep-jest-suites.txt"
    echo "  The list is missing, empty or holds only comments, so stage 2b would run nothing."
    echo "  Restore the list: one exact __tests__ path per line for every suite that runs the real semgrep."
  } >&2
  exit 2
fi

PART_A_ARGUMENTS=()
while IFS= read -r pattern; do
  PART_A_ARGUMENTS+=("--testPathIgnorePatterns=$pattern")
done < <(node -e 'for (const pattern of require("./jest.config.js").testPathIgnorePatterns) console.log(pattern)')
for suite in "${SEMGREP_SUITES[@]}"; do
  PART_A_ARGUMENTS+=("--testPathIgnorePatterns=<rootDir>/${suite//./\\.}\$")
done

# The queued verify is the only full property sweep: a dev jest run draws 3 seeds per list
# (src/test-support/property-sweep.ts). Exported once here, so 2a and 2b both inherit it.
export KIKO_PROPERTY_SWEEP=full

# Stage 2a also puts a `semgrep` that fails with a message first on PATH (a tracked script, so
# the dir outlives this run): a suite that starts the real binary and is missing from the list
# fails in 2a instead of timing out under load. 2b keeps the real PATH.
PATH="$DIR/semgrep-tripwire:$PATH" run_stage 2a "jest (all but the real-semgrep suites)" \
  npx jest "${PART_A_ARGUMENTS[@]}"
code=$?
if [ "$code" -ne 0 ]; then
  echo "✖ make verify FAILED at stage 2a (jest) — exit code $code" >&2
  exit "$code"
fi

run_stage 2b "jest (real-semgrep suites, in band)" npx jest "${SEMGREP_SUITES[@]}" --runInBand
code=$?
if [ "$code" -ne 0 ]; then
  echo "✖ make verify FAILED at stage 2b (jest) — exit code $code" >&2
  exit "$code"
fi

run_stage 3 "gate (check:all)" npm run check:all
code=$?
if [ "$code" -ne 0 ]; then
  echo "✖ make verify FAILED at stage 3 (gate) — exit code $code" >&2
  exit "$code"
fi

echo "✔ make verify: lint, jest, and gate all passed"
exit 0
