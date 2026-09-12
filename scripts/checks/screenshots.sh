#!/usr/bin/env bash
# check:screenshots — App Store screenshot visual-regression gate. This wrapper
# is MANUAL/DEEP TIER, same class as scripts/checks/mutation.sh: it needs a
# booted, pinned iOS simulator with a screenshot-mode build already installed
# (that step is the ops agent's job, never this wrapper's), so it is NOT wired
# to any hook and is NOT part of check:all or check:deep. It follows the
# streaming half of the wrapper contract (kiko-linter skill): it MAY print
# live progress to stdout because it is run by hand, but it still prints the
# structured print_block and exits 2 on any failure.
#
# GENERALIZED CORE (2026-09-12): this script is the shared engine for all
# THREE regression scenarios (rich/empty/locked) — see CLAUDE.md's
# "check:screenshots" section for the full scenario table. Its defaults below
# reproduce the ORIGINAL rich-only behavior unchanged when run with no env
# overrides (`npm run check:screenshots`); `scripts/checks/screenshots-
# empty.sh` and `scripts/checks/screenshots-locked.sh` are thin wrappers that
# set these env vars for their own scenario and then exec this same file, so
# the diff/fail-closed/print_block logic lives in exactly one place:
#   SCREENSHOT_FLOW            path to the .maestro/*.yaml flow to run
#   SCREENSHOT_BASELINE_DIR    committed baseline dir to diff against
#   SCREENSHOT_NAMES_OVERRIDE  space-separated bare shot names (3rd arg to
#                              run_flow_and_collect); see that helper's own
#                              comment for why this is a plain string, not an
#                              array reference
#   SCREENSHOT_EXCLUDE_CSV     comma-separated shot names to SKIP in the
#                              pixel-diff (empty by default — see the
#                              EXCLUDE_FROM_DIFF note below)
#   SCREENSHOT_CHECK_LABEL     the print_block title, so a failure block
#                              reads as "...empty state..." /
#                              "...locked..." rather than a generic label
#
# What it does:
#   1. Runs the Maestro flow via the shared run_flow_and_collect helper
#      (screenshot-diff/run-flow-and-collect.sh, also used by
#      scripts/screenshots-capture.sh and scripts/screenshots-baseline.sh so
#      none of them can drift): a fresh `--debug-output` temp tree per run,
#      with each named PNG it captures copied into a fresh mktemp -d capture
#      directory — never a path inside the repo, so no .gitignore entry is
#      needed for it.
#   2. Pixel-diffs every captured PNG EXCEPT any named in
#      SCREENSHOT_EXCLUDE_CSV against the committed baseline of the same name
#      under SCREENSHOT_BASELINE_DIR (NOT screenshots/appstore/6.9-inch/uk/ —
#      that is the marketing deliverable set, captured from a different,
#      non-deterministic build; see this repo's CLAUDE.md "check:screenshots"
#      section for the full marketing-vs-regression split and why), via the
#      pure comparePng core in scripts/checks/screenshot-diff/compare-png.js
#      (invoked as a CLI — see that file's require.main guard). This check
#      therefore only ever makes sense run against a STABLE-glass build
#      (an `ENVFILE=.env.screenshots*.stable` variant) — a real bloom-glass
#      build will fail it on drift alone, by design.
#   3. Fails on any DIFFED image over tolerance, any missing baseline (for a
#      diffed name), any missing captured file (for a diffed name), or a run
#      that captured ZERO PNGs at all (a Maestro run that silently produced
#      nothing must never read as a pass).
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
# shellcheck source=/dev/null
source "$DIR/screenshot-diff/run-flow-and-collect.sh"
ROOT="$(cd "$DIR/../.." && pwd)"

FLOW="${SCREENSHOT_FLOW:-$ROOT/.maestro/regression.yaml}"
BASELINE_DIR="${SCREENSHOT_BASELINE_DIR:-$ROOT/screenshots/regression/6.9-inch/uk}"
NAMES_ARG="${SCREENSHOT_NAMES_OVERRIDE:-${REGRESSION_RICH_NAMES[*]}}"
CHECK_LABEL="${SCREENSHOT_CHECK_LABEL:-App Store screenshots — rich (Maestro + pixelmatch)}"
DIFF_CLI="$ROOT/scripts/checks/screenshot-diff/compare-png.js"

# Chosen tolerances — kept in sync with the comment in compare-png.js and the
# CLAUDE.md checks-table row for check:screenshots. A per-pixel color-distance
# threshold of 0.1 (pixelmatch's own scale) and a 0.5% per-image mismatch
# budget, wide enough to absorb @callstack/liquid-glass's blur material and
# any residual sub-pixel animation settling, narrow enough to still catch a
# real visual regression.
THRESHOLD="0.1"
MAX_MISMATCH_RATIO="0.005"

# EXCLUDE_FROM_DIFF (2026-09-12): empty by default for all three regression
# flows (rich/empty/locked) — none of them capture a mid-scroll,
# momentum-dependent shot anymore. The OLD marketing-derived rich flow
# (`.maestro/appstore-screenshots.yaml`, still used only by
# scripts/screenshots-capture.sh / scripts/screenshots-baseline.sh for the
# App Store deliverable set) DID need this exclusion for 3 shots
# (02-home-transactions-scrolled: 7.75% mismatch,
# 07-statistics-account-contribution: 18.9% mismatch,
# 08-statistics-expenses-by-category: 10.6% mismatch — each a
# `scrollUntilVisible`-to-mid-content shot whose stop offset is
# momentum/deceleration-dependent). `.maestro/regression.yaml` simply never
# captures those 3 shots at all (see that file's own header comment for the
# 2026-09-12 coordinator decision to prefer "don't capture" over
# "capture-then-exclude"), so this check no longer needs an exclusion list.
# The mechanism (compare-png.js's `excludeCsv` arg) still exists and is
# still exercised end-to-end by compare-png.test.js, in case a future shot
# needs it again — set SCREENSHOT_EXCLUDE_CSV to use it.
EXCLUDE_FROM_DIFF_CSV="${SCREENSHOT_EXCLUDE_CSV:-}"

# The npm script name quoted in every failure hint below — the rich default
# ("npm run check:screenshots") or whatever the scenario wrapper sets.
RUN_CMD="${SCREENSHOT_RUN_CMD:-npm run check:screenshots}"

# Fail closed: maestro must be resolvable on PATH. This wrapper does not pin a
# node_modules-vendored binary (unlike stryker/knip/depcheck) because Maestro
# is a standalone CLI the project has always installed outside npm — see
# docs/research/2026-09-10-simulator-screenshot-tests.md ("Maestro is already
# installed").
if ! command -v maestro >/dev/null 2>&1; then
  print_block \
    "$CHECK_LABEL" \
    "The maestro CLI is not on PATH." \
    "'command -v maestro' found nothing." \
    "Without Maestro this check cannot capture anything, and a missing tool must never look like a passing (or silently skipped) visual-regression run." \
    "Install Maestro (see docs/research/2026-09-10-simulator-screenshot-tests.md) and ensure it is on PATH, then re-run: $RUN_CMD" \
    "Do not report success when the capture step could not run at all."
  exit 2
fi

if [ ! -f "$FLOW" ]; then
  print_block \
    "$CHECK_LABEL" \
    "The Maestro flow is missing." \
    "$FLOW does not exist." \
    "Without the flow file there is nothing to capture, and a missing flow must never look like a passing run." \
    "Restore $FLOW, then re-run: $RUN_CMD" \
    "Do not report success when there is no flow to run."
  exit 2
fi

if [ ! -d "$BASELINE_DIR" ]; then
  print_block \
    "$CHECK_LABEL" \
    "No baseline screenshots exist yet." \
    "$BASELINE_DIR does not exist." \
    "This check compares a fresh capture against a committed baseline. With no baseline there is nothing to regress against, and a missing baseline must never look like a passing run." \
    "Produce the first baseline set (ops, from a real capture) and commit it under $BASELINE_DIR, then re-run: $RUN_CMD" \
    "Do not fabricate a baseline PNG, and do not skip the check silently."
  exit 2
fi

capture_dir="$(mktemp -d "${TMPDIR:-/tmp}/kiko-screenshots.XXXXXX")"
cleanup() { rm -rf "$capture_dir"; }
trap cleanup EXIT

printf 'Running Maestro flow (fresh --debug-output tree), collecting named PNGs into: %s\n' "$capture_dir"

run_flow_and_collect "$FLOW" "$capture_dir" "$NAMES_ARG"
maestro_code=$?

if [ "$maestro_code" -ne 0 ]; then
  print_block \
    "$CHECK_LABEL" \
    "The Maestro flow did not complete successfully." \
    "$(cat "$capture_dir/.maestro-output.log" 2>/dev/null)" \
    "A failed flow means the app never reached (or never rendered) some of the showcase screens, so any diff below would be comparing against incomplete or stale captures." \
    "Fix the flow or the app/build under test (a booted, pinned simulator with the matching scenario's screenshot-mode build installed, sim date 2026-09-10), then re-run: $RUN_CMD" \
    "Do not diff whatever partial captures exist after a failed run — treat a failed flow as a full failure."
  exit 2
fi

# A run that "succeeded" but captured nothing must never read as a pass — the
# flow silently no-op'ing (e.g. every takeScreenshot step skipped) is exactly
# the failure mode fail-closed guards against.
capture_count="$(find "$capture_dir" -maxdepth 1 -iname '*.png' | wc -l | tr -d ' ')"
if [ "$capture_count" -eq 0 ]; then
  print_block \
    "$CHECK_LABEL" \
    "The Maestro flow reported success but captured zero screenshots." \
    "$capture_dir contains no .png files after the run." \
    "A run that captures nothing and still exits 0 would silently defeat this entire check — every future regression would pass by default." \
    "Investigate why no takeScreenshot/<name>.png was found under the run's --debug-output tree (a renamed testID broke an assertVisible step, a navigation step failed silently, etc. — the Maestro output printed above has the detail), then re-run: $RUN_CMD" \
    "Do not treat a zero-capture run as a pass, and do not lower this to a warning."
  exit 2
fi

diff_out="$(node "$DIFF_CLI" "$BASELINE_DIR" "$capture_dir" "$THRESHOLD" "$MAX_MISMATCH_RATIO" "$EXCLUDE_FROM_DIFF_CSV")"
diff_code=$?
printf '%s\n' "$diff_out"

if [ "$diff_code" -ne 0 ]; then
  # SKIP lines (the EXCLUDE_FROM_DIFF set above) are expected, informational,
  # and never the cause of a non-zero diff_code — exclude them from the
  # "what failed" report so a real FAIL/MISSING/DIMENSION line is never
  # buried among them.
  failing="$(printf '%s\n' "$diff_out" | awk -F'\t' '$1 != "PASS" && $1 != "SKIP" { printf "  - %s: %s (%s)\n", $1, $2, $4 }')"
  print_block \
    "$CHECK_LABEL" \
    "One or more captured screenshots do not match their committed baseline." \
    "$failing" \
    "A baseline diff over tolerance means the App Store screenshot set — real marketing/deliverable assets — silently changed, or a UI regression shipped that a Jest/RNTL test cannot see (RNTL renders a virtual tree, not real device pixels)." \
    "Review each named screen. If the change is an intentional design update, recapture and update the baseline PNG(s) under $BASELINE_DIR. If it is a regression, fix the app. Re-run: $RUN_CMD" \
    "Do not raise maxMismatchRatio/threshold to force a pass, and do not update a baseline to hide an unreviewed regression."
  exit 2
fi

exit 0
