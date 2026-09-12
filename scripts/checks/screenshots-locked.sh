#!/usr/bin/env bash
# check:screenshots:locked — LOCKED-scenario visual-regression gate. A thin
# wrapper: it sets the scenario's FLOW/BASELINE_DIR/NAMES/LABEL env vars and
# execs the generalized core in scripts/checks/screenshots.sh (see that
# file's own header comment for the full mechanism and fail-closed
# guarantees, which this wrapper inherits unchanged). Needs a booted, pinned
# simulator with the LOCKED-scenario STABLE-glass build
# (`ENVFILE=.env.screenshots.locked.stable`) already installed (ops) — same
# manual/deep-tier class as `check:screenshots`, not wired to any hook and
# not part of check:all/check:deep.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/screenshot-diff/run-flow-and-collect.sh"
ROOT="$(cd "$DIR/../.." && pwd)"

export SCREENSHOT_FLOW="$ROOT/.maestro/regression-locked.yaml"
export SCREENSHOT_BASELINE_DIR="$ROOT/screenshots/regression-locked/6.9-inch/uk"
export SCREENSHOT_NAMES_OVERRIDE="${REGRESSION_LOCKED_NAMES[*]}"
export SCREENSHOT_CHECK_LABEL="App Store screenshots — locked (Maestro + pixelmatch)"
export SCREENSHOT_RUN_CMD="npm run check:screenshots:locked"

exec bash "$DIR/screenshots.sh"
