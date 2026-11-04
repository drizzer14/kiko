#!/usr/bin/env bash
# make verify — the single end-of-work command for the developer and qa
# agents. Runs the gate (check:all), then the full jest suite in two parts, as
# ORDERED, FAIL-FAST stages: it stops at the first failing stage rather than
# running all of them regardless (this is NOT a run-all). Each stage's
# stdout/stderr stream straight to the terminal (inherited fds — never
# captured or piped) so a failing stage's structured WHAT/DETAILS/... block
# reaches the agent unaltered.
#
# Deliberately `set -uo pipefail`, NOT `set -e`: each stage's exit code is
# captured explicitly so this script can print its own stage-failure marker
# before exiting with that code.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
cd "$ROOT" || exit 2

# Stage 1 (check:all) starts the run: its first check is lint, so a format error still fails in
# seconds, and the gate's scans (check:security, check:rules) run at a load that was just read
# by the queue's start-load defer instead of about 30 minutes after it.
#
# Stage 1 also overlaps several checks that the Stop and SubagentStop medium tier runs (dup,
# knip, deps, typecheck, and more). Do NOT mistake that overlap for a bug and remove the stage —
# without stage 1, a `make verify` run that did not also fire the hooks would skip the gate
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

# Only `job-queue.sh verify ... --scoped` sets this. It is read once and unset: jest inherits the
# environment, and a stage that saw it would let semgrep-load-limits.test.ts's own verify.sh runs
# skip 2b and fail their full-mode pins; a verify nested in a stage would inherit a skip it never
# asked for.
SCOPED_REQUESTED="${KIKO_VERIFY_SCOPED-}"
unset KIKO_VERIFY_SCOPED

# Stage 2b is skipped only for a scoped verify whose branch changed no path the real-semgrep suites
# can read. Anything the function cannot prove runs 2b: every failure path returns 1 with the
# reason in FULL_RUN_REASON, so a doubt is never a skip. The list format is in the file itself.
TRIGGER_LIST="$DIR/semgrep-suite-triggers.txt"
TRIGGERS=()
EXCLUDES=()
FULL_RUN_REASON=""
SKIP_BASE=""
MERGE_BASE=""

# trim_line <text>: prints the text without leading and trailing whitespace.
trim_line() {
  local text="$1"
  text="${text#"${text%%[![:space:]]*}"}"
  printf '%s' "${text%"${text##*[![:space:]]}"}"
}

# load_triggers: fills TRIGGERS (prefix when it ends in /, else exact path) and EXCLUDES (the text
# after a leading !, kept as a case pattern). The pattern is only ever read into a variable, so no
# shell glob expands it. The suites of semgrep-jest-suites.txt are triggers too.
load_triggers() {
  local line
  if [ -f "$TRIGGER_LIST" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      line="$(trim_line "$line")"
      case "$line" in
        '' | '#'*) ;;
        '!'*) EXCLUDES+=("${line#!}") ;;
        *) TRIGGERS+=("$line") ;;
      esac
    done < "$TRIGGER_LIST"
  fi
  [ "${#TRIGGERS[@]}" -gt 0 ]
}

# is_trigger_path <path>: an exclude wins over every trigger.
is_trigger_path() {
  local exclude trigger
  for exclude in ${EXCLUDES[@]+"${EXCLUDES[@]}"}; do
    # The pattern stays unquoted on purpose: quoted, `case` would compare it as plain text.
    case "$1" in $exclude) return 1 ;; esac
  done
  for trigger in "${TRIGGERS[@]}" ${SEMGREP_SUITES[@]+"${SEMGREP_SUITES[@]}"}; do
    case "$trigger" in
      */) case "$1" in "$trigger"*) return 0 ;; esac ;;
      *) [ "$1" = "$trigger" ] && return 0 ;;
    esac
  done
  return 1
}

# merge_base_with <ref>: sets MERGE_BASE to the one merge base of HEAD and the ref.
merge_base_with() {
  local output
  MERGE_BASE=""
  output="$(git merge-base --all HEAD "$1")" || {
    FULL_RUN_REASON="git merge-base against $1 failed"
    return 1
  }
  case "$output" in
    '')
      FULL_RUN_REASON="HEAD has no merge base with $1"
      return 1
      ;;
    *$'\n'*)
      FULL_RUN_REASON="HEAD has more than one merge base with $1"
      return 1
      ;;
  esac
  MERGE_BASE="$output"
}

# newer_base <main base> <next base>: sets MERGE_BASE to the one that contains the other; returns 1
# with the reason when neither does or a git call fails (a status other than 0 or 1).
newer_base() {
  git merge-base --is-ancestor "$1" "$2"
  case $? in
    0)
      MERGE_BASE="$2"
      return 0
      ;;
    1) ;;
    *)
      FULL_RUN_REASON="git merge-base --is-ancestor failed"
      return 1
      ;;
  esac
  git merge-base --is-ancestor "$2" "$1"
  case $? in
    0)
      MERGE_BASE="$1"
      return 0
      ;;
    1) FULL_RUN_REASON="neither base contains the other" ;;
    *) FULL_RUN_REASON="git merge-base --is-ancestor failed" ;;
  esac
  return 1
}

# skip_stage_2b: returns 0 when 2b can be skipped (SKIP_BASE is the commit measured from).
skip_stage_2b() {
  local main_base next_base base head_commit listing first_trigger="" changed

  if [ "$SCOPED_REQUESTED" != 1 ]; then
    FULL_RUN_REASON="no --scoped flag: KIKO_VERIFY_SCOPED is not 1"
    return 1
  fi
  if ! load_triggers; then
    FULL_RUN_REASON="the trigger list holds no trigger line"
    return 1
  fi
  if ! git rev-parse --verify --quiet refs/heads/main > /dev/null; then
    FULL_RUN_REASON="there is no local main branch"
    return 1
  fi
  head_commit="$(git rev-parse HEAD)" || {
    FULL_RUN_REASON="git rev-parse HEAD failed"
    return 1
  }
  merge_base_with refs/heads/main || return 1
  base="$MERGE_BASE"
  if git rev-parse --verify --quiet refs/heads/next > /dev/null; then
    main_base="$base"
    merge_base_with refs/heads/next || return 1
    next_base="$MERGE_BASE"
    if [ "$main_base" = "$next_base" ]; then
      base="$main_base"
    else
      newer_base "$main_base" "$next_base" || return 1
      base="$MERGE_BASE"
    fi
  fi
  if [ "$base" = "$head_commit" ]; then
    FULL_RUN_REASON="HEAD is reachable from main or next, so a diff says nothing"
    return 1
  fi

  listing="$(mktemp)" || {
    FULL_RUN_REASON="mktemp failed"
    return 1
  }
  if ! git diff --name-only --no-renames -z "$base" HEAD > "$listing"; then
    rm -f "$listing"
    FULL_RUN_REASON="git diff failed"
    return 1
  fi
  while IFS= read -r -d '' changed; do
    if is_trigger_path "$changed"; then
      first_trigger="$changed"
      break
    fi
  done < "$listing"
  rm -f "$listing"
  if [ -n "$first_trigger" ]; then
    FULL_RUN_REASON="trigger path: $first_trigger"
    return 1
  fi
  SKIP_BASE="$base"
}

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
# unproven, so it fails here, before the gate, with a block instead of an "unbound variable" abort
# under bash 3.2.
if [ "${#SEMGREP_SUITES[@]}" -eq 0 ]; then
  {
    echo "✖ make verify FAILED before the gate: no suite is listed in scripts/checks/semgrep-jest-suites.txt"
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

run_stage 1 "gate" npm run check:all
code=$?
if [ "$code" -ne 0 ]; then
  echo "✖ make verify FAILED at stage 1 (gate) — exit code $code" >&2
  exit "$code"
fi

# The queued verify is the only full property sweep: a dev jest run draws 3 seeds per list
# (src/test-support/property-sweep.ts). Exported after the gate, so the gate's checks run as they
# do outside a verify; 2a and 2b both inherit it.
export KIKO_PROPERTY_SWEEP=full

# Stage 2a also puts a `semgrep` that fails with a message first on PATH (a tracked script, so
# the dir outlives this run): a suite that starts the real binary and is missing from the list
# fails in 2a instead of timing out under load. The gate and 2b keep the real PATH.
PATH="$DIR/semgrep-tripwire:$PATH" run_stage 2a "jest (all but the real-semgrep suites)" \
  npx jest "${PART_A_ARGUMENTS[@]}"
code=$?
if [ "$code" -ne 0 ]; then
  echo "✖ make verify FAILED at stage 2a (jest) — exit code $code" >&2
  exit "$code"
fi

if skip_stage_2b; then
  echo "── make verify: stage 2b SKIPPED (no trigger path changed since ${SKIP_BASE:0:12}) ──"
  echo "✔ make verify: gate and stage 2a passed; stage 2b skipped"
  exit 0
fi

echo "── make verify: stage 2b runs in full ($FULL_RUN_REASON) ──"
run_stage 2b "jest (real-semgrep suites, in band)" npx jest "${SEMGREP_SUITES[@]}" --runInBand
code=$?
if [ "$code" -ne 0 ]; then
  echo "✖ make verify FAILED at stage 2b (jest) — exit code $code" >&2
  exit "$code"
fi

echo "✔ make verify: gate and jest all passed"
exit 0
