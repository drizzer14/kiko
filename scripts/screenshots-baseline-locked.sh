#!/usr/bin/env bash
# screenshots:baseline:locked — produces/refreshes the
# check:screenshots:locked REGRESSION baseline set. A thin wrapper: sets the
# scenario's FLOW/DEST_DIR/NAMES env vars and execs the generalized core in
# scripts/screenshots-baseline.sh (see that file's own header comment for the
# full mechanism). Run it by hand once the LOCKED-scenario STABLE-glass build
# (ENVFILE=.env.screenshots.locked.stable) is installed on a booted, pinned
# simulator. Not a check, not hook-wired, not part of check:all/check:deep;
# never commits anything.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
# shellcheck source=/dev/null
source "$DIR/checks/screenshot-diff/run-flow-and-collect.sh"

export SCREENSHOT_FLOW="$ROOT/.maestro/regression-locked.yaml"
export SCREENSHOT_DEST_DIR="$ROOT/screenshots/regression-locked/6.9-inch/uk"
export SCREENSHOT_NAMES_OVERRIDE="${REGRESSION_LOCKED_NAMES[*]}"
export SCREENSHOT_RUN_CMD="npm run screenshots:baseline:locked"

exec bash "$DIR/screenshots-baseline.sh"
