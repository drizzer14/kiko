#!/usr/bin/env bash
# Shared helper: run the App Store screenshot Maestro flow
# (.maestro/appstore-screenshots.yaml) and collect its named PNG captures
# into a destination directory. Sourced by BOTH scripts/checks/screenshots.sh
# (the regression check) and scripts/screenshots-capture.sh (the deliverable/
# baseline producer), so the "run the flow, then find the PNGs" logic cannot
# drift between the two — fix it here once, both callers pick it up.
#
# Maestro 2.10.0 constraint, verified by decompiling the installed
# maestro-orchestra.jar / maestro-cli-2.10.0.jar with javap (no doc source
# for this was available; the bytecode is the ground truth):
#
#   - `takeScreenshot` REFUSES any path that resolves outside this run's own
#     `takeScreenshot` artifact folder (ArtifactCollector.allocateCommandOutput's
#     confinement check — a resolved path that does not start with
#     `<artifactsDir>/takeScreenshot` throws "it resolves outside this run's
#     takeScreenshot output folder"). An absolute, OUTPUT_DIR-prefixed path
#     (the earlier design) always fails this: `Path.resolve()` on an absolute
#     argument discards the base entirely, so the confinement check always
#     fails. A BARE relative name is the only form that works.
#   - Maestro appends `.png` to that bare name itself
#     (Orchestra.takeScreenshotCommand does `command.path + ".png"` via a
#     `.png` string-concat template) — the flow must NOT include the
#     extension.
#   - The final file lands at
#     `<debug-output-dir>/.maestro/tests/<session-timestamp>/<flow-name>[_N]/takeScreenshot/<name>.png`
#     (TestDebugReporter.buildDefaultDebugOutputPath nests a session-timestamp
#     folder under `--debug-output`'s own argument, then
#     TestDebugReporter.resolveFlowDir nests a per-flow folder — deduplicated
#     with a `_2`, `_3`, ... suffix on a name collision — under THAT, and
#     `takeScreenshot` is the fixed collection-dir name
#     `ArtifactCollector` maps `ArtifactKind.TAKE_SCREENSHOT` to). The
#     session-timestamp and flow-folder segments are NOT predictable ahead of
#     a run, so this helper SEARCHES the whole `--debug-output` tree for
#     `takeScreenshot/<name>.png` by basename instead of hardcoding the path.
#
# The 10 canonical shot names are the SINGLE SOURCE OF TRUTH here — both
# callers read SCREENSHOT_NAMES from this file, so the flow, the check, and
# the capture script cannot drift out of sync on the shot list. Two Statistics
# shots were deliberately dropped, not just renamed:
#   - "by type" bar chart: it duplicated the line chart's frame
#     (statistics.screen.tsx stacks statistics-block-bar immediately below
#     statistics-block-line, close enough that it already appears under the
#     net-worth line in the line-chart shot's frame).
#   - account-contribution pie: unlike the category donut (which passes
#     `centerTotal`, so pie-chart.component.tsx renders its
#     `category-pie-center-total` inner element — a precise, deterministic
#     scroll stop), this donut passes no `centerTotal` and so has NO inner
#     center-total element at all (a real, observed failure: scrolling to
#     that id found nothing at runtime). Its only targetable element, its
#     block container (`statistics-block-pie`), sits too close to the
#     category donut's own container for `visibilityPercentage: 100` alone to
#     stop at two reliably distinct offsets (a real, observed failure: both
#     containers landed at the SAME near-bottom scroll offset, producing
#     byte-identical captures). With no reliable target available, the shot
#     was dropped entirely rather than shipping a flaky or duplicate capture.
SCREENSHOT_NAMES=(
  01-home-networth
  02-home-transactions-scrolled
  03-accounts-grid
  04-account-detail
  05-holding-detail-ledger
  06-statistics-net-worth-line
  07-statistics-expenses-by-category
  08-statistics-spending-trend
  09-settings-main
  10-settings-system
)

# run_flow_and_collect <flow_yaml> <dest_dir>
#
# Runs the flow via `maestro test --debug-output <temp>`, streaming Maestro's
# combined output to stdout live (this helper is only ever used from the
# manual/deep tier, so streaming is allowed — see the kiko-linter skill's
# wrapper contract) and also saving it to "<dest_dir>/.maestro-output.log" for
# a caller that wants to quote it in a failure message. Then, for every name
# in SCREENSHOT_NAMES, searches the `--debug-output` tree for
# "takeScreenshot/<name>.png" and copies the first match into
# "<dest_dir>/<name>.png". <dest_dir> is mkdir -p'd first. The temporary
# `--debug-output` tree is always removed before returning, success or not.
#
# Returns Maestro's own exit code. A code 0 does NOT by itself mean every (or
# any) screenshot was captured — the caller must check <dest_dir>'s contents
# (a Maestro run that "succeeds" but captures nothing is exactly the failure
# mode both callers guard against separately).
run_flow_and_collect() {
  local flow="$1" dest="$2" debug_dir maestro_out maestro_code name found

  debug_dir="$(mktemp -d "${TMPDIR:-/tmp}/kiko-maestro-debug.XXXXXX")"
  mkdir -p "$dest"

  maestro_out="$(maestro test --debug-output "$debug_dir" "$flow" 2>&1)"
  maestro_code=$?
  printf '%s\n' "$maestro_out"
  printf '%s\n' "$maestro_out" > "$dest/.maestro-output.log"

  for name in "${SCREENSHOT_NAMES[@]}"; do
    found="$(find "$debug_dir" -type f -path '*/takeScreenshot/*' -name "${name}.png" 2>/dev/null | head -n 1)"
    if [ -n "$found" ]; then
      cp "$found" "$dest/${name}.png"
    fi
  done

  rm -rf "$debug_dir"
  return "$maestro_code"
}
