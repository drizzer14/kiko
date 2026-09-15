#!/usr/bin/env bash
# make verify — the single end-of-work command for the developer and qa
# agents. Runs the three checks they used to run separately (lint, the full
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

run_stage 2 "jest (full suite)" npx jest
code=$?
if [ "$code" -ne 0 ]; then
  echo "✖ make verify FAILED at stage 2 (jest) — exit code $code" >&2
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
