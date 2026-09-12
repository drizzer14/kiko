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
# What it does:
#   1. Runs the Maestro flow (.maestro/appstore-screenshots.yaml) via the
#      shared run_flow_and_collect helper (screenshot-diff/run-flow-and-
#      collect.sh, also used by scripts/screenshots-capture.sh and
#      scripts/screenshots-baseline.sh so none of the three can drift): a
#      fresh `--debug-output` temp tree per run, with each of the 10 named
#      PNGs it captures copied into a fresh mktemp -d capture directory —
#      never a path inside the repo, so no .gitignore entry is needed for it.
#   2. Pixel-diffs every captured PNG EXCEPT the 3 named in EXCLUDE_FROM_DIFF
#      below against the committed REGRESSION baseline of the same name under
#      screenshots/regression/6.9-inch/uk/ (NOT screenshots/appstore/
#      6.9-inch/uk/ — that is the marketing deliverable set, captured from a
#      different, non-deterministic build; see this repo's CLAUDE.md
#      "check:screenshots" section for the full marketing-vs-regression
#      split and why), via the pure comparePng core in scripts/checks/
#      screenshot-diff/compare-png.js (invoked as a CLI — see that file's
#      require.main guard). This check therefore only ever makes sense run
#      against a STABLE-glass build (ENVFILE=.env.screenshots.stable) — a
#      real bloom-glass build (.env.screenshots) will fail it on drift alone,
#      by design.
#   3. Fails on any DIFFED image over tolerance, any missing baseline (for a
#      diffed name), any missing captured file (for a diffed name), or a run
#      that captured ZERO PNGs at all (a Maestro run that silently produced
#      nothing must never read as a pass) — see EXCLUDE_FROM_DIFF below for
#      why 3 shots are captured/committed but never diffed.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
# shellcheck source=/dev/null
source "$DIR/screenshot-diff/run-flow-and-collect.sh"
ROOT="$(cd "$DIR/../.." && pwd)"

FLOW="$ROOT/.maestro/appstore-screenshots.yaml"
BASELINE_DIR="$ROOT/screenshots/regression/6.9-inch/uk"
DIFF_CLI="$ROOT/scripts/checks/screenshot-diff/compare-png.js"

# Chosen tolerances — kept in sync with the comment in compare-png.js and the
# CLAUDE.md checks-table row for check:screenshots. A per-pixel color-distance
# threshold of 0.1 (pixelmatch's own scale) and a 0.5% per-image mismatch
# budget, wide enough to absorb @callstack/liquid-glass's blur material and
# any residual sub-pixel animation settling, narrow enough to still catch a
# real visual regression.
THRESHOLD="0.1"
MAX_MISMATCH_RATIO="0.005"

# EXCLUDE_FROM_DIFF (2026-09-12, documented exception — see CLAUDE.md's
# check:screenshots section for the full writeup): these 3 shots are still
# CAPTURED (screenshots:capture and screenshots:baseline write all 10 PNGs
# unchanged) and still committed in both screenshots/appstore/6.9-inch/uk/
# and screenshots/regression/6.9-inch/uk/, but are SKIPPED by the pixel-diff
# below — they measured a genuine, reproducible whole-frame offset shift on
# the stable-glass build, not a glass-material or animation artifact:
#   - 02-home-transactions-scrolled: 7.75% mismatch
#   - 07-statistics-account-contribution: 18.9% mismatch
#   - 08-statistics-expenses-by-category: 10.6% mismatch
# All three are the flow's `scrollUntilVisible`-to-mid-content shots (each
# targets a specific row/chart block that sits somewhere in the MIDDLE of a
# scrollable range, reached by a `scrollUntilVisible` whose stop offset is
# momentum/deceleration-dependent) — measured, on the SAME stable-glass
# build, against the remaining 7 diffed shots below (01, 03, 04, 05, 06, 09,
# 10 — either not scrolled at all, or landing at a scroll-range edge/first
# match), every one of which measured 0% mismatch. Stable-glass removes the
# glass material's own drift and `waitForAnimationToEnd` removes animation
# settling, but neither touches the scroll-STOP position itself, so these 3
# remain non-deterministic inputs to
# a byte-for-byte pixel diff. Excluding a genuinely non-deterministic input
# is not a tolerance loosening — the `THRESHOLD`/`MAX_MISMATCH_RATIO` above
# are unchanged, and every diffed shot below still fails on any real
# regression at the same 0.5% budget as before. A future experiment lowering
# Maestro's `scrollUntilVisible` `speed` (a gentler, more deterministic
# deceleration) could plausibly reclaim these 3 shots for the diff; that is
# deferred, not forgotten.
EXCLUDE_FROM_DIFF=(
  02-home-transactions-scrolled
  07-statistics-account-contribution
  08-statistics-expenses-by-category
)
EXCLUDE_FROM_DIFF_CSV="$(
  IFS=,
  echo "${EXCLUDE_FROM_DIFF[*]}"
)"

# Fail closed: maestro must be resolvable on PATH. This wrapper does not pin a
# node_modules-vendored binary (unlike stryker/knip/depcheck) because Maestro
# is a standalone CLI the project has always installed outside npm — see
# docs/research/2026-09-10-simulator-screenshot-tests.md ("Maestro is already
# installed").
if ! command -v maestro >/dev/null 2>&1; then
  print_block \
    "App Store screenshots (Maestro + pixelmatch)" \
    "The maestro CLI is not on PATH." \
    "'command -v maestro' found nothing." \
    "Without Maestro this check cannot capture anything, and a missing tool must never look like a passing (or silently skipped) visual-regression run." \
    "Install Maestro (see docs/research/2026-09-10-simulator-screenshot-tests.md) and ensure it is on PATH, then re-run: npm run check:screenshots" \
    "Do not report success when the capture step could not run at all."
  exit 2
fi

if [ ! -f "$FLOW" ]; then
  print_block \
    "App Store screenshots (Maestro + pixelmatch)" \
    "The Maestro flow is missing." \
    "$FLOW does not exist." \
    "Without the flow file there is nothing to capture, and a missing flow must never look like a passing run." \
    "Restore .maestro/appstore-screenshots.yaml, then re-run: npm run check:screenshots" \
    "Do not report success when there is no flow to run."
  exit 2
fi

if [ ! -d "$BASELINE_DIR" ]; then
  print_block \
    "App Store screenshots (Maestro + pixelmatch)" \
    "No baseline screenshots exist yet." \
    "$BASELINE_DIR does not exist." \
    "This check compares a fresh capture against a committed baseline. With no baseline there is nothing to regress against, and a missing baseline must never look like a passing run." \
    "Produce the first baseline set (ops, from a real capture) and commit it under $BASELINE_DIR, then re-run: npm run check:screenshots" \
    "Do not fabricate a baseline PNG, and do not skip the check silently."
  exit 2
fi

capture_dir="$(mktemp -d "${TMPDIR:-/tmp}/kiko-screenshots.XXXXXX")"
cleanup() { rm -rf "$capture_dir"; }
trap cleanup EXIT

printf 'Running Maestro flow (fresh --debug-output tree), collecting named PNGs into: %s\n' "$capture_dir"

run_flow_and_collect "$FLOW" "$capture_dir"
maestro_code=$?

if [ "$maestro_code" -ne 0 ]; then
  print_block \
    "App Store screenshots (Maestro + pixelmatch)" \
    "The Maestro flow did not complete successfully." \
    "$(cat "$capture_dir/.maestro-output.log" 2>/dev/null)" \
    "A failed flow means the app never reached (or never rendered) some of the showcase screens, so any diff below would be comparing against incomplete or stale captures." \
    "Fix the flow or the app/build under test (a booted, pinned simulator with the screenshot-mode build installed, sim date 2026-09-10), then re-run: npm run check:screenshots" \
    "Do not diff whatever partial captures exist after a failed run — treat a failed flow as a full failure."
  exit 2
fi

# A run that "succeeded" but captured nothing must never read as a pass — the
# flow silently no-op'ing (e.g. every takeScreenshot step skipped) is exactly
# the failure mode fail-closed guards against.
capture_count="$(find "$capture_dir" -maxdepth 1 -iname '*.png' | wc -l | tr -d ' ')"
if [ "$capture_count" -eq 0 ]; then
  print_block \
    "App Store screenshots (Maestro + pixelmatch)" \
    "The Maestro flow reported success but captured zero screenshots." \
    "$capture_dir contains no .png files after the run." \
    "A run that captures nothing and still exits 0 would silently defeat this entire check — every future regression would pass by default." \
    "Investigate why no takeScreenshot/<name>.png was found under the run's --debug-output tree (a renamed testID broke an assertVisible step, a navigation step failed silently, etc. — the Maestro output printed above has the detail), then re-run: npm run check:screenshots" \
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
    "App Store screenshots (Maestro + pixelmatch)" \
    "One or more captured screenshots do not match their committed baseline." \
    "$failing" \
    "A baseline diff over tolerance means the App Store screenshot set — real marketing/deliverable assets — silently changed, or a UI regression shipped that a Jest/RNTL test cannot see (RNTL renders a virtual tree, not real device pixels)." \
    "Review each named screen. If the change is an intentional design update, recapture and update the baseline PNG(s) under $BASELINE_DIR. If it is a regression, fix the app. Re-run: npm run check:screenshots" \
    "Do not raise maxMismatchRatio/threshold to force a pass, and do not update a baseline to hide an unreviewed regression."
  exit 2
fi

exit 0
