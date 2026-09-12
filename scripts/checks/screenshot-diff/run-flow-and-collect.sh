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
# the capture script cannot drift out of sync on the shot list. There is
# still NO standalone "by type" bar-chart shot: it duplicated the line
# chart's frame (statistics.screen.tsx stacks statistics-block-bar
# immediately below statistics-block-line, close enough that it already
# appears under the net-worth line in the line-chart shot's frame), so it
# stays dropped from this list entirely.
#
# There are exactly THREE Statistics shots, not four: a standalone
# category-donut shot (targeting `category-pie-center-total`) was tried and
# DROPPED (coordinator decision, 2026-09-12) because on the current app-wide
# bloom-glass, tab-press-scroll-fixed build it landed at the SAME frame as
# the trend-block shot (both the category donut and the trend chart below it
# fit on screen together at that scroll offset), producing a byte-identical
# duplicate of 08-statistics-expenses-by-category. See
# `.maestro/appstore-screenshots.yaml`'s comment above shot 08 for the full
# rationale, and for the OPS + COORDINATOR VERIFICATION requirement (confirm
# 06/07/08 are three visually distinct frames after a real capture, and
# adjust the 08 name if the landed content differs).
SCREENSHOT_NAMES=(
  01-home-networth
  02-home-transactions-scrolled
  03-accounts-grid
  04-account-detail
  05-holding-detail-ledger
  06-statistics-net-worth-line
  07-statistics-account-contribution
  08-statistics-expenses-by-category
  09-settings-main
  10-settings-system
)

# REGRESSION_RICH_NAMES (2026-09-12) — the shot list for `.maestro/
# regression.yaml`, a SEPARATE flow from the marketing one above (see that
# file's own header comment for the full rationale). 7 of these 11 names are
# shared with SCREENSHOT_NAMES (01, 03, 04, 05, 06, 09, 10 — the marketing
# shots that measured 0% mismatch on the stable-glass build); the 3 mid-scroll
# marketing shots (02/07/08) are deliberately NOT reproduced here (a
# non-deterministic shot is simply never captured, rather than captured and
# excluded — see regression.yaml's header comment); the 4 `r0N-` names are new
# BREADTH additions (forms + the categories screen) with no marketing
# equivalent. This is the single source of truth both
# `scripts/checks/screenshots.sh` (the check) and `scripts/screenshots-
# baseline.sh` (the baseline producer) read for the rich regression scenario.
REGRESSION_RICH_NAMES=(
  01-home-networth
  03-accounts-grid
  r01-add-account-form
  04-account-detail
  r02-add-holding-form
  05-holding-detail-ledger
  r03-add-transaction-form
  06-statistics-net-worth-line
  09-settings-main
  r04-categories
  10-settings-system
  # 2026-09-12 visual-regression expansion — filled edit forms, open sheets,
  # and selection controls. Captured interleaved in the flow (see
  # .maestro/regression.yaml); the r0N value is a unique label, not an order key.
  r05-edit-account-form
  r06-edit-holding-form
  r07-edit-transaction-form
  r08-transaction-category-sheet
  r09-transaction-date-sheet
  r10-transaction-time-sheet
  r11-transaction-category-override-sheet
  r12-add-holding-bond-form
)

# REGRESSION_EMPTY_NAMES (2026-09-12) — the shot list for `.maestro/
# regression-empty.yaml`: the app's empty states (no accounts/holdings/
# transactions). See that file's header comment for which testID or text each
# shot asserts before capturing.
REGRESSION_EMPTY_NAMES=(
  01-home-empty
  02-accounts-empty
  03-statistics-empty
)

# REGRESSION_LOCKED_NAMES (2026-09-12) — the shot list for `.maestro/
# regression-locked.yaml`: the single app-lock cold-launch gate frame.
REGRESSION_LOCKED_NAMES=(
  lock-gate
)

# run_flow_and_collect <flow_yaml> <dest_dir> [names]
#
# Runs the flow via `maestro test --debug-output <temp>`, streaming Maestro's
# combined output to stdout live (this helper is only ever used from the
# manual/deep tier, so streaming is allowed — see the kiko-linter skill's
# wrapper contract) and also saving it to "<dest_dir>/.maestro-output.log" for
# a caller that wants to quote it in a failure message. Then, for every name
# in <names> (see below), searches the `--debug-output` tree for
# "takeScreenshot/<name>.png" and copies the first match into
# "<dest_dir>/<name>.png". <dest_dir> is mkdir -p'd first. The temporary
# `--debug-output` tree is always removed before returning, success or not.
#
# <names> (optional, 3rd arg): a single space-separated string of bare shot
# names (no `.png` extension) — pass it as `"${SOME_NAMES_ARRAY[*]}"`. When
# omitted, defaults to `"${SCREENSHOT_NAMES[*]}"` (the 10 marketing names),
# preserving the original two-arg call shape for any caller that still wants
# the marketing set. This is a plain space-joined string, not an array
# reference, because this project's `#!/usr/bin/env bash` resolves to the
# system bash (3.2 on this machine, verified via `bash --version`), which has
# no nameref (`local -n`, bash 4.3+) or associative-array support — a plain
# string plus `local -a names; names=($names_arg)` word-split is the
# lowest-common-denominator way to pass a caller-chosen list through a
# positional argument. None of the screenshot names in any of the NAMES
# arrays above contain whitespace, so word-splitting is safe here.
#
# Returns Maestro's own exit code. A code 0 does NOT by itself mean every (or
# any) screenshot was captured — the caller must check <dest_dir>'s contents
# (a Maestro run that "succeeds" but captures nothing is exactly the failure
# mode both callers guard against separately).
run_flow_and_collect() {
  local flow="$1" dest="$2" names_arg="${3:-}" debug_dir maestro_out maestro_code name found
  local -a names

  if [ -n "$names_arg" ]; then
    # Deliberate word-split: $names_arg is always a space-joined list of bare,
    # hyphenated, whitespace-free screenshot names (see the NAMES arrays
    # above) — never arbitrary/unsanitized input.
    # shellcheck disable=SC2206
    names=($names_arg)
  else
    names=("${SCREENSHOT_NAMES[@]}")
  fi

  debug_dir="$(mktemp -d "${TMPDIR:-/tmp}/kiko-maestro-debug.XXXXXX")"
  mkdir -p "$dest"

  maestro_out="$(maestro test --debug-output "$debug_dir" "$flow" 2>&1)"
  maestro_code=$?
  printf '%s\n' "$maestro_out"
  printf '%s\n' "$maestro_out" > "$dest/.maestro-output.log"

  for name in "${names[@]}"; do
    found="$(find "$debug_dir" -type f -path '*/takeScreenshot/*' -name "${name}.png" 2>/dev/null | head -n 1)"
    if [ -n "$found" ]; then
      cp "$found" "$dest/${name}.png"
    fi
  done

  rm -rf "$debug_dir"
  return "$maestro_code"
}
