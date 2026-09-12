#!/usr/bin/env bash
# screenshots:baseline — produces/refreshes the check:screenshots REGRESSION
# baseline set (stable, opaque glass; byte-stable by design). This is NOT a
# check: no print_block/_lib.sh, not hook-wired, not part of check:all or
# check:deep. Run it by hand once a STABLE-GLASS screenshot-mode build
# (ENVFILE=.env.screenshots.stable — NOT .env.screenshots) is installed on a
# booted, pinned simulator — see .maestro/appstore-screenshots.yaml's header
# comment for the exact prerequisites (simulator model, clock date, etc).
#
# Why a separate build/baseline from the marketing set (scripts/screenshots-
# capture.sh, screenshots/appstore/6.9-inch/uk/): the real 'clear' bloom
# glass (@callstack/liquid-glass) re-refracts whatever varying content sits
# behind it, so on chart/scroll-heavy screens a marketing-build capture
# drifts 2-10% run-to-run — useless as a pixelmatch regression baseline
# (check:screenshots would flake on tolerance alone). `.env.screenshots.stable`
# sets SCREENSHOT_STABLE_GLASS=true, which `isStableGlass()`
# (src/screenshot/screenshot-mode.ts) reads to swap every GlassSurface for a
# fixed, opaque, non-refracting design-system surface
# (src/design-system/components/glass-surface/glass-surface.component.tsx) —
# no live LiquidGlass sampling, so the same screen renders byte-identical
# pixels run to run. The marketing build (.env.screenshots) keeps the real
# bloom glass; it is never used for regression comparison.
#
# It runs the same flow as scripts/checks/screenshots.sh and
# scripts/screenshots-capture.sh, through the SAME shared helper
# (scripts/checks/screenshot-diff/run-flow-and-collect.sh) so the "run the
# flow, then find the PNGs" logic cannot drift between the three, then
# copies the 10 named PNGs it captured into screenshots/regression/6.9-inch/uk/
# (mkdir -p'd first), OVERWRITING whatever was there before. Those files are
# ONLY the check:screenshots regression baseline — never the App Store
# marketing deliverable (that is screenshots/appstore/6.9-inch/uk/, produced
# by scripts/screenshots-capture.sh from the real-glass build). This script
# never commits anything — review the diff before committing.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
FLOW="$ROOT/.maestro/appstore-screenshots.yaml"
DEST_DIR="$ROOT/screenshots/regression/6.9-inch/uk"

# shellcheck source=/dev/null
source "$DIR/checks/screenshot-diff/run-flow-and-collect.sh"

if ! command -v maestro >/dev/null 2>&1; then
  echo "ERROR: maestro is not on PATH. Install it, then re-run: npm run screenshots:baseline" >&2
  exit 1
fi

if [ ! -f "$FLOW" ]; then
  echo "ERROR: $FLOW does not exist — nothing to capture." >&2
  exit 1
fi

capture_dir="$(mktemp -d "${TMPDIR:-/tmp}/kiko-screenshots-baseline.XXXXXX")"
cleanup() { rm -rf "$capture_dir"; }
trap cleanup EXIT

echo "Running Maestro flow against the STABLE-glass build (fresh --debug-output tree), collecting named PNGs into a temp dir: $capture_dir"

run_flow_and_collect "$FLOW" "$capture_dir"
maestro_code=$?

capture_count="$(find "$capture_dir" -maxdepth 1 -iname '*.png' | wc -l | tr -d ' ')"
total_names="${#SCREENSHOT_NAMES[@]}"

if [ "$maestro_code" -ne 0 ] || [ "$capture_count" -eq 0 ]; then
  echo "ERROR: Maestro flow failed or captured nothing (exit $maestro_code, $capture_count of $total_names PNGs). See the output above. Nothing was written to $DEST_DIR." >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
copied=0
for name in "${SCREENSHOT_NAMES[@]}"; do
  if [ -f "$capture_dir/$name.png" ]; then
    cp "$capture_dir/$name.png" "$DEST_DIR/$name.png"
    copied=$((copied + 1))
  else
    echo "WARNING: $name.png was not captured — leaving any existing $DEST_DIR/$name.png untouched." >&2
  fi
done

echo "Copied $copied of $total_names named screenshots into $DEST_DIR"

if [ "$copied" -lt "$total_names" ]; then
  echo "WARNING: not all $total_names named screenshots were captured — check the Maestro output above for the step that stopped early, then re-run: npm run screenshots:baseline" >&2
  exit 1
fi

echo "Review the images under $DEST_DIR before committing — this script does not commit anything."
echo "Reminder: this must have run against the STABLE-glass build (ENVFILE=.env.screenshots.stable). A real-glass (.env.screenshots) capture written here will make check:screenshots flake on bloom-glass drift."
exit 0
