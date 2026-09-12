#!/usr/bin/env bash
# screenshots:baseline:empty — produces/refreshes the check:screenshots:empty
# REGRESSION baseline set. A thin wrapper: sets the scenario's FLOW/DEST_DIR/
# NAMES env vars and execs the generalized core in scripts/screenshots-
# baseline.sh (see that file's own header comment for the full mechanism).
# Run it by hand once the EMPTY-scenario STABLE-glass build
# (ENVFILE=.env.screenshots.empty.stable) is installed on a booted, pinned
# simulator. Not a check, not hook-wired, not part of check:all/check:deep;
# never commits anything.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
# shellcheck source=/dev/null
source "$DIR/checks/screenshot-diff/run-flow-and-collect.sh"

export SCREENSHOT_FLOW="$ROOT/.maestro/regression-empty.yaml"
export SCREENSHOT_DEST_DIR="$ROOT/screenshots/regression-empty/6.9-inch/uk"
export SCREENSHOT_NAMES_OVERRIDE="${REGRESSION_EMPTY_NAMES[*]}"
export SCREENSHOT_RUN_CMD="npm run screenshots:baseline:empty"

exec bash "$DIR/screenshots-baseline.sh"
