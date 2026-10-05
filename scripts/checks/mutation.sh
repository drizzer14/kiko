#!/usr/bin/env bash
# check:deep mutation step. This wrapper is MANUAL and NOT hook-wired, so the
# "silent on success" contract does not apply — it STREAMS Stryker's output.
#
# For a watching HUMAN it also (a) tees the combined Stryker output to a stable,
# tailable progress log under the out-of-repo per-worktree state dir and prints
# the exact `tail -f` command to watch it, and (b) prints an ETA derived from the
# history of past completed runs: a PER-MUTANT rate (seconds/mutant) times this
# run's actual mutant count, printed LIVE the moment Stryker reports that count
# (see the harness_mutation_* helpers in _lib.sh). This exists so a human can watch a multi-minute run
# directly — AGENTS must still NOT poll/tail it. The run's EXIT CODE is the only
# signal an agent waits on (0 = pass, 2 = fail); the log and ETA are for the
# human. None of the progress/ETA/history code may change the pass/fail result:
# every new step is guarded and a corrupt history just means "no estimate".
#
# `--list` prints the files this run would mutate and their count, then exits
# (2 above the cap) without Stryker, so a change set is sized with the gate's
# own filter instead of a hand count. It needs no Stryker binary and takes no
# lock, since it never starts a run. Any other argument exits 2. A changed file whose diff is
# only comments or whitespace is left out of the list (and printed as `skipped (comment-only)`).
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
# Stryker's own json reporter writes its report to a path RELATIVE to its own
# cwd (reports/mutation/mutation.json by default), so the change-set gate below
# must read it from the same place Stryker wrote it to, whatever cwd this
# wrapper was invoked from.
cd "$ROOT" || exit 2
MUTATION_REPORT="$ROOT/reports/mutation/mutation.json"
list=0
# A mistyped `--list` must not fall through to a full Stryker run, so any
# other argument is refused before the lock or Stryker.
for argument in "$@"; do
  if [ "$argument" != "--list" ]; then
    print_block \
      "Stryker (mutation testing)" \
      "Unknown argument: $argument" \
      "mutation.sh takes only --list (print the files it would mutate and their count, then exit)." \
      "An ignored argument would turn a mistyped --list into a real mutation run that takes the machine-wide lock for minutes." \
      "Run: bash scripts/checks/mutation.sh --list   (or with no argument, to run Stryker)" \
      "Do not pass other options; set the scope with KIKO_MUTATION_BASE instead."
    exit 2
  fi
  list=1
done
# The pinned Stryker binary. KIKO_MUTATION_BIN overrides it ONLY so this
# wrapper's streaming and exit-code behavior is testable against a fast stub
# binary (scripts/checks/mutation.test via __tests__/) without a multi-minute
# real mutation run. It defaults to the pinned node_modules binary, so
# production is unchanged and the pinned-version guarantee still holds.
BIN="${KIKO_MUTATION_BIN:-$ROOT/node_modules/.bin/stryker}"

if [ "$list" -eq 0 ] && [ ! -x "$BIN" ]; then
  print_block \
    "Stryker (mutation testing)" \
    "The stryker tool is not installed in node_modules." \
    "$BIN was not found or is not executable." \
    "The harness tools live in node_modules. Without them, no check can run, and a missing tool must not look like a code problem." \
    "Run: npm install   then re-run: npm run check:mutation" \
    "Do not run stryker through npx without --no-install (that can auto-fetch an unpinned version from the network). Install the pinned version with npm install."
  exit 2
fi

# Single-flight guard: never spawn a second Stryker while one runs — anywhere
# on the machine. The lock is GLOBAL: a fixed path NOT keyed by the worktree,
# so two DIFFERENT worktrees cannot each launch Stryker at the same time. Two
# concurrent mutation runs each start the full Jest suite and can orphan
# workers, which drove machine load to 152 on one occasion. If a LIVE run
# already holds the lock, FAIL FAST (exit 2) — do not block or silently queue.
# A stale lock (holder process gone) is reclaimed automatically.
if [ "$list" -eq 0 ]; then
  lock="$(harness_global_lock_dir)"
  mkdir -p "$(dirname "$lock")" 2>/dev/null || true
  if ! harness_try_lock "$lock" "$ROOT"; then
    print_block \
      "Stryker (mutation testing)" \
      "Another mutation run is active; refusing to start a second Stryker." \
      "The global single-flight lock at $lock is held by $(harness_lock_holder "$lock")." \
      "The mutation lock is machine-wide: only ONE Stryker may run at a time across all worktrees. Two concurrent runs each start the full Jest suite and can orphan workers, which overloads the machine." \
      "Wait for the active mutation run to finish, then re-run: npm run check:mutation" \
      "Do not start a second mutation run in parallel. Wait for the active one to finish."
    exit 2
  fi
  # Release the global lock on normal exit AND on INT/TERM, so a killed run never
  # strands the machine-wide lock. harness_unlock (rm -rf) is idempotent, so the
  # EXIT trap re-firing after an INT/TERM handler is harmless.
  trap 'harness_unlock "$lock"' EXIT
  trap 'harness_unlock "$lock"; exit 130' INT
  trap 'harness_unlock "$lock"; exit 143' TERM
fi

# A whole-release mutation run took 10 h 16 min and produced no result, so a run
# above this many source files never starts. It is a plain assignment on purpose:
# no env var may raise it.
MUTATION_FILE_CAP=30
CAP_REASON="A big mutation run takes hours and starves the machine (a whole-release run went 10 h 16 min with no result)."

# Reads candidate .ts/.tsx paths on stdin and prints the ones Stryker would
# mutate, excluding tests, fixtures, and test scaffolding (__mocks__/, e2e/,
# test-support/, __fixtures__/, *-test-helper.ts, *-test-fixtures.ts) and the
# test-less build config (drizzle.config.ts). It also
# drops zero/low-logic barrels (**/index.ts) + pure-static *.styles.ts,
# preserving the 2 logic-bearing styles
# (bottom-sheet.styles.ts, entity-icon-tile.styles.ts).
# These MUST be filtered here too: on a diff-scoped run --mutate REPLACES
# the config mutate[] wholesale (deepMerge replaces arrays, deep-merge.js:13),
# so the config negations in stryker.conf.json do NOT apply there. Kept
# bash-3.2-safe (no assoc arrays/namerefs) to match the rest of this script.
mutable_source_files() {
  local candidates reinc
  candidates="$(grep -Ev '(\.test\.tsx?$|-test-(helper|fixtures)\.tsx?$|(^|/)(__tests__|__mocks__|__fixtures__|e2e|test-support)/|(^|/)rules/fixtures/|(^|/)scripts/checks/|(^|/)i18n/locales/|(^|/)drizzle\.config\.ts$|\.d\.ts$)' || true)"
  [ -n "$candidates" ] || return 0
  reinc="$(printf '%s\n' "$candidates" | grep -E '((^|/)bottom-sheet\.styles\.ts$|(^|/)entity-icon-tile\.styles\.ts$)' || true)"
  candidates="$(printf '%s\n' "$candidates" | grep -Ev '((^|/)index\.ts$|\.styles\.ts$)' || true)"
  printf '%s\n' "$candidates" "$reinc" | grep -v '^[[:space:]]*$' | sort -u || true
}

# Diff-scope the mutation to the source files THIS branch changed, so the manual
# gate is cheap. Compare against the merge-base with $KIKO_MUTATION_BASE (default
# main) — i.e. "what this branch changed" — and mutate only those .ts/.tsx files.
# An explicit --mutate list overrides Stryker's whole-tree glob. A whole-project
# run is always far above MUTATION_FILE_CAP, so it is refused outright rather
# than counted, and so is a base that does not resolve: falling back to the
# whole project, or to "nothing to mutate", would hide the missing scope.
if [ -n "${KIKO_MUTATION_FULL:-}" ]; then
  print_block \
    "Stryker (mutation testing)" \
    "KIKO_MUTATION_FULL=1: a whole-project run is always above the cap ($MUTATION_FILE_CAP files)." \
    "KIKO_MUTATION_FULL=1 asks Stryker to mutate every source file in the project." \
    "$CAP_REASON" \
    "Unset KIKO_MUTATION_FULL and set KIKO_MUTATION_BASE to the change set's own base commit so only its files are mutated." \
    "No env override to skip the cap; do not raise the number to pass."
  exit 2
fi
base="${KIKO_MUTATION_BASE:-main}"
if ! merge_base="$(git -C "$ROOT" merge-base "$base" HEAD 2>/dev/null)" || [ -z "$merge_base" ]; then
  print_block \
    "Stryker (mutation testing)" \
    "KIKO_MUTATION_BASE=$base does not resolve to a commit." \
    "git merge-base $base HEAD failed in $ROOT, so the change set to mutate is unknown." \
    "Without a base there is no change set to mutate, and the gate must never fall back to a whole-project run or pass with nothing mutated." \
    "Set KIKO_MUTATION_BASE to the change set's own base commit (a branch, tag, or sha in this repository), then re-run: npm run check:mutation" \
    "Do not start Stryker directly to skip the cap."
  exit 2
fi
# An unreadable file list must never count as "nothing to mutate".
if ! diff_names="$(git -C "$ROOT" diff --name-only --diff-filter=d "$merge_base" HEAD -- '*.ts' '*.tsx' 2>/dev/null)"; then
  print_block \
    "Stryker (mutation testing)" \
    "Could not list the files changed since the merge-base with $base." \
    "git diff --name-only $merge_base HEAD failed in $ROOT." \
    "The gate would otherwise pass with no mutant run." \
    "Check that the repository can read commit $merge_base (a partial clone or a .git permission error), then re-run: npm run check:mutation" \
    "Do not start Stryker directly to skip the cap."
  exit 2
fi
changed="$(printf '%s\n' "$diff_names" | mutable_source_files)"

# A changed file whose diff against the merge-base touches only comments or whitespace has
# no new mutant to find, so it leaves the list HERE, once: Stryker's --mutate, the scorer, the
# fingerprint, the cap, and --list all read the same $changed (the scorer fails a report whose
# recorded scope differs from its file list). comment-only-changes.js decides from the
# TypeScript parse and prints a path only when it proved the file comment-only; any doubt, or
# a script that fails, prints nothing and the file stays. Its output is matched back against
# $changed, so a stray line cannot drop a file that was not a candidate. The arguments are
# built only for a non-empty list: an empty array is an unbound variable in bash 3.2.
#
# A comment-only source file is still KEPT when a changed test file beside it (same folder:
# foo.test.ts(x) or foo.<anything>.test.ts(x) for foo.ts(x)) is not itself comment-only: a test
# weakened together with a comment edit must still be mutated. A comment-only test edit cannot
# weaken a test. The test files come from their own diff (--no-renames, deletions included), and
# a deleted, new, or unparsable one is never printed by the script, so it counts as a real change.
# If that diff fails, nothing is skipped.
newline=$'\n'
skipped_report=""
kept_report=""

# Prints the changed test files of $test_names that sit beside the source file $1.
colocated_tests() {
  local stem="${1%.*}" test_name
  while IFS= read -r test_name; do
    case "$test_name" in
      "$stem".test.ts | "$stem".test.tsx) printf '%s\n' "$test_name" ;;
      "$stem".*.test.ts | "$stem".*.test.tsx)
        case "${test_name#"$stem"}" in
          */*) ;;
          *) printf '%s\n' "$test_name" ;;
        esac
        ;;
    esac
  done < <(printf '%s\n' "$test_names")
}

# True when $1 is a line of $comment_only, the script's proved-comment-only list.
proved_comment_only() {
  case "$newline$comment_only$newline" in
    *"$newline$1$newline"*) return 0 ;;
  esac
  return 1
}

if [ -n "$changed" ]; then
  comment_only=""
  if test_names="$(git -C "$ROOT" diff --name-only --no-renames "$merge_base" HEAD -- '*.test.ts' '*.test.tsx' 2>/dev/null)"; then
    candidate_arguments=()
    while IFS= read -r candidate; do
      [ -n "$candidate" ] || continue
      candidate_arguments+=("$candidate")
      while IFS= read -r test_name; do
        [ -n "$test_name" ] && candidate_arguments+=("$test_name")
      done < <(colocated_tests "$candidate")
    done < <(printf '%s\n' "$changed")

    comment_only="$(node "$DIR/comment-only-changes.js" "$merge_base" "${candidate_arguments[@]}" 2>/dev/null)" || comment_only=""
  fi

  kept=""
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    test_changed=0
    while IFS= read -r test_name; do
      [ -n "$test_name" ] || continue
      proved_comment_only "$test_name" || test_changed=1
    done < <(colocated_tests "$candidate")

    if ! proved_comment_only "$candidate"; then
      kept="${kept:+$kept$newline}$candidate"
    elif [ "$test_changed" -eq 1 ]; then
      kept="${kept:+$kept$newline}$candidate"
      kept_report="${kept_report}kept (colocated test changed): ${candidate}${newline}"
    else
      skipped_report="${skipped_report}skipped (comment-only): ${candidate}${newline}"
    fi
  done < <(printf '%s\n' "$changed")
  changed="$kept"
fi

file_count="$(printf '%s\n' "$changed" | grep -c . || true)"
if [ "$list" -eq 1 ]; then
  [ -n "$changed" ] && printf '%s\n' "$changed"
  printf '%s%s' "$skipped_report" "$kept_report"
  printf 'mutable files: %s (cap %s)\n' "$file_count" "$MUTATION_FILE_CAP"
else
  printf '%s%s' "$skipped_report" "$kept_report"
fi
if [ -z "$changed" ]; then
  # Nothing to mutate: the branch changed no mutable source file, or only comment/whitespace in
  # the ones it changed. Pass.
  [ -n "$skipped_report" ] && printf 'nothing to mutate: every changed source file is comment-only.\n'
  exit 0
fi
csv="$(printf '%s' "$changed" | tr '\n' ',')"
mutate_arg="--mutate=${csv%,}"

if [ "$file_count" -gt "$MUTATION_FILE_CAP" ]; then
  print_block \
    "Stryker (mutation testing)" \
    "$file_count files would be mutated (> $MUTATION_FILE_CAP)." \
    "Scope: the source files changed since the merge-base with $base." \
    "$CAP_REASON" \
    "Run it per small change set: set KIKO_MUTATION_BASE to that change set's own base commit so only its files are mutated." \
    "No env override to skip the cap; do not raise the number to pass."
  exit 2
fi
[ "$list" -eq 1 ] && exit 0

# Content dedup: skip a mutation run when no mutation-relevant source changed
# since the last passing run of the SAME scope. This stops a re-run after a
# change Stryker never mutates (an icon asset, an ios/ file, a doc). It runs
# only after every refusal above, and the scope (merge-base + file list) is part
# of the fingerprint, so a pass over a narrow change set never skips a wider or
# refused one at the same HEAD. An empty code fingerprint stays empty, so a
# state that cannot be fingerprinted always runs.
fp="$(harness_code_fingerprint "$ROOT")"
[ -n "$fp" ] && fp="$fp $merge_base $mutate_arg"
if harness_unchanged "$ROOT" "mutation" "$fp"; then
  exit 0
fi

# Everything below runs only when Stryker will ACTUALLY run (past every early
# exit). Tee Stryker's combined output to a STABLE, tailable progress log under
# the out-of-repo per-worktree state dir, truncated at the start of each run so
# `tail -f` shows the current run. The tee still duplicates to stdout LIVE and
# `out` still captures the full output for the failure block; PIPESTATUS[0] reads
# the producer's status through the tee (read immediately after the pipe). The
# ETA is a PER-MUTANT RATE from history (harness_mutation_rate) times the run's
# ACTUAL mutant count — a flat duration average is meaningless when diff-scoped
# runs span dozens to thousands of mutants — so the full ETA is printed LIVE by
# harness_mutation_eta_filter (the last pipe stage) the moment Stryker first
# reports the count. Before the run we can only announce that: with no usable
# history we print the plain no-estimate line. Create the empty log first so the
# watch command works immediately. All of this is guarded: it must never change
# the gate's exit code. The ETA line goes only to stdout via
# the filter — the tee writes the log BEFORE the filter, so `$log` (and thus
# `out`, the count/score parse, and the failure block) stays pure Stryker output.
log="$(harness_mutation_progress_log "$ROOT")"
: > "$log" 2>/dev/null || true
hist="$(harness_mutation_history_file "$ROOT")"
rate="$(harness_mutation_rate "$hist")"
if [ -z "$rate" ]; then
  printf 'No mutation history yet — no estimate available.\n'
else
  printf 'Estimated time prints once Stryker reports the mutant count (~%ss/mutant from history).\n' "$rate"
fi
printf 'Watch live progress:  tail -f %s\n' "$log"

# A report left by an earlier run must never be mistaken for THIS run's: remove
# it so a Stryker that writes none is caught by the missing-report check below.
rm -f "$MUTATION_REPORT"

start="$(date +%s 2>/dev/null || printf '0')"
"$BIN" run "$mutate_arg" 2>&1 | tee "$log" | harness_mutation_eta_filter "$rate"
code="${PIPESTATUS[0]}"
end="$(date +%s 2>/dev/null || printf '0')"
out="$(cat "$log" 2>/dev/null || true)"
dur=$((end - start))
[ "$dur" -ge 0 ] 2>/dev/null || dur=0

# Best-effort parse of the mutant count (the denominator of Stryker's progress
# "N/M tested" counter) and the overall mutation score from the captured output.
# A parse failure yields an empty string and NEVER aborts the run.
count="$(printf '%s' "$out" | grep -Eo '[0-9]+/[0-9]+' | tail -1 | sed 's:.*/::' 2>/dev/null || true)"
score="$(printf '%s' "$out" | grep -Eio 'mutation score[^0-9]*[0-9]+(\.[0-9]+)?' | grep -Eo '[0-9]+(\.[0-9]+)?' | tail -1 2>/dev/null || true)"
[ -n "$count" ] && printf 'Mutants: %s\n' "$count"

iso="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || printf '')"

# A code other than 0 or 1 is a CRASH (Stryker never finished a run at all),
# and so is code 1 with no report: Stryker also exits 1 on a failed run (for
# example "No tests were executed"), while a run that completes and misses its
# break threshold has written its report first. A crash is not a completed run,
# so it is never recorded in history.
if { [ "$code" -ne 0 ] && [ "$code" -ne 1 ]; } || { [ "$code" -eq 1 ] && [ ! -f "$MUTATION_REPORT" ]; }; then
  print_block \
    "Stryker (mutation testing)" \
    "Stryker exited with code $code rather than completing a run." \
    "$out" \
    "A crash produces no mutation report at all, so neither the whole-report sanity floor nor the change-set gate below can run; a check that never actually ran must never report success." \
    "Read the output above for the crash cause (an instrumentation error, an out-of-memory worker, ...), fix it, and re-run: npm run check:mutation" \
    "Do not treat a crash as a pass, and do not raise concurrency or memory limits to paper over an instrumentation bug."
  exit 2
fi

# Stryker only WARNS when a --mutate entry resolves to no file (it falls under
# stryker.conf.json's ignorePatterns, or holds a glob special character), yet
# the report's recorded scope still lists it, so the scorer would grade that
# file "n/a (no mutants)" and pass. The warning is the only signal, so it fails.
# A case match, not a here-string: bash 3.2 writes a here-string to a temp file, and when /tmp
# cannot be written grep never runs, so this check would read as no match and pass.
case "$out" in
  *'did not result in any files'*)
    print_block \
      "Stryker (mutation testing)" \
      "Stryker could not resolve a changed file passed to --mutate (\"did not result in any files\")." \
      "$out" \
      "A file Stryker never mutated would be graded n/a and the gate would pass without any mutant run on it." \
      "Find the Glob pattern named in the output above: a path under stryker.conf.json's ignorePatterns, or one with a glob special character (such as brackets, parentheses, or braces), is not mutable. Exclude that file from the change set (add it to mutable_source_files in mutation.sh when it needs no mutation) or rename it, then re-run: npm run check:mutation" \
      "Do not treat the n/a score as a pass, and do not remove an ignorePatterns entry just to make the file resolve."
    exit 2
    ;;
esac

# A completed run (code 0 or 1) took real wall-clock time; record it in
# history (feeds the next run's ETA) regardless of which gate below ends up
# failing it. A backward clock jump mid-run can yield dur=0; a 0s record would
# drag the rolling ETA average toward zero, so only a strictly-positive
# duration is ever recorded. This never changes the gate's exit code.
[ "$dur" -gt 0 ] && harness_mutation_history_append "$ROOT" "$iso" "$dur" "$count" "$score"

if [ "$code" -eq 1 ]; then
  # Stryker's OWN break threshold (stryker.conf.json's thresholds.break: 60)
  # covers the WHOLE accumulated incremental report, not this change set. It
  # is kept only as a SANITY FLOOR for a catastrophic whole-report regression;
  # the REAL gate for a reviewed change set is its own score below, read from
  # the json reporter's output rather than this whole-report number.
  print_block \
    "Stryker (mutation testing)" \
    "The whole-report sanity floor (Stryker's own break threshold, 60 over every file Stryker has ever mutated) failed." \
    "$out" \
    "This number covers the entire accumulated incremental report, not this change set — a regression this large usually means something is broken project-wide (a bad config, a swallowed exception in every test), not just in the files reviewed here." \
    "Read the output above for the failing files, fix the regression, and re-run: npm run check:mutation" \
    "Do not lower this sanity floor to get green; it almost never trips for a normal change set (see the header of this script)."
  exit 2
fi

# code == 0: Stryker's own whole-report sanity floor passed. Gate on the
# CHANGE SET's own score instead (scripts/checks/mutation-score.js), read from
# the json reporter's output, restricted to the files THIS run mutated.
if [ ! -f "$MUTATION_REPORT" ]; then
  print_block \
    "Stryker (mutation testing)" \
    "Stryker passed but wrote no JSON report at $MUTATION_REPORT." \
    "$out" \
    "Without the report the change-set score cannot be computed at all, and a missing result must never read as a pass." \
    "Check that stryker.conf.json's reporters array still includes \"json\", then re-run: npm run check:mutation" \
    "Do not skip the change-set gate when the report is missing; fix why it was not written."
  exit 2
fi

# $changed is a newline-separated list (bash 3.2-safe: no mapfile), expanded
# into one argv entry per file for mutation-score.js.
file_arguments=()
while IFS= read -r changed_file; do
  [ -n "$changed_file" ] && file_arguments+=("$changed_file")
done < <(printf '%s\n' "$changed")

score_out="$(node "$DIR/mutation-score.js" "$MUTATION_REPORT" "${file_arguments[@]}" 2>&1)"
score_code=$?
printf '%s\n' "$score_out"
if [ "$score_code" -ne 0 ]; then
  print_block \
    "Stryker (mutation testing)" \
    "The CHANGE SET's own mutation score failed the gate (the thresholds are on the GATE line)." \
    "$score_out" \
    "A surviving mutant in the files THIS change set touched means its own tests would not catch a real regression there — the number that matters for this review, not the whole accumulated report. A report whose recorded scope differs from this change set's files fails too, because it cannot vouch for them." \
    "Add a real assertion that fails when the mutated code is wrong, or (only for a declaration-only file with no behavioral branch) add it to the exclusion allowlist in mutation-score.js with a concrete reason, and mirror it in docs/harness/documented-exceptions.md. Re-run: npm run check:mutation" \
    "Do not delete the failing mutant's test, and do not add a file to the exclusion allowlist without a concrete, verifiable reason (see CLAUDE.md's Override protocol)."
  exit 2
fi

harness_mark_pass "$ROOT" "mutation" "$fp"
exit 0
