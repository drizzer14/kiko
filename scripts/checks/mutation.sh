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
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
# The pinned Stryker binary. KIKO_MUTATION_BIN overrides it ONLY so this
# wrapper's streaming and exit-code behavior is testable against a fast stub
# binary (scripts/checks/mutation.test via __tests__/) without a multi-minute
# real mutation run. It defaults to the pinned node_modules binary, so
# production is unchanged and the pinned-version guarantee still holds.
BIN="${KIKO_MUTATION_BIN:-$ROOT/node_modules/.bin/stryker}"

if [ ! -x "$BIN" ]; then
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

# Content dedup: skip a full mutation run when no mutation-relevant source
# changed since the last passing run. This stops a re-run after a change
# Stryker never mutates (an icon asset, an ios/ file, a doc), the case a
# developer agent hit when it re-ran check:deep after only an icon was added.
fp="$(harness_code_fingerprint "$ROOT")"
if harness_unchanged "$ROOT" "mutation" "$fp"; then
  exit 0
fi

# Diff-scope the mutation to the source files THIS branch changed, so the manual
# gate is cheap. Compare against the merge-base with $KIKO_MUTATION_BASE (default
# main) — i.e. "what this branch changed" — and mutate only those .ts/.tsx files,
# EXCLUDING tests and fixtures (matching the config's own mutate excludes). An
# explicit --mutate list overrides Stryker's whole-tree glob. `KIKO_MUTATION_FULL=1`
# forces the whole-project run; a base whose merge-base cannot be resolved also
# falls back to the whole project (never silently mutate nothing).
mutate_arg=""
if [ -z "${KIKO_MUTATION_FULL:-}" ]; then
  base="${KIKO_MUTATION_BASE:-main}"
  merge_base="$(git -C "$ROOT" merge-base "$base" HEAD 2>/dev/null || true)"
  if [ -n "$merge_base" ]; then
    changed="$(git -C "$ROOT" diff --name-only --diff-filter=d "$merge_base" HEAD -- '*.ts' '*.tsx' 2>/dev/null \
      | grep -Ev '(\.test\.tsx?$|(^|/)__tests__/|(^|/)rules/fixtures/|(^|/)i18n/locales/|\.d\.ts$)' || true)"
    if [ -z "$changed" ]; then
      # This branch changed no mutable source file — nothing to mutate, pass.
      exit 0
    fi
    csv="$(printf '%s' "$changed" | tr '\n' ',')"
    mutate_arg="--mutate=${csv%,}"
  fi
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
# the gate's exit code. `$mutate_arg` is a single token with no spaces (or
# empty), so the unquoted expansion is safe. The ETA line goes only to stdout via
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

start="$(date +%s 2>/dev/null || printf '0')"
"$BIN" run $mutate_arg 2>&1 | tee "$log" | harness_mutation_eta_filter "$rate"
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
# A backward clock jump mid-run can yield dur=0; a 0s record would drag the
# rolling ETA average toward zero, so only a strictly-positive duration is ever
# recorded. This never changes the gate exit code or any progress output.
if [ "$code" -ne 0 ]; then
  # A break-threshold failure (Stryker exit 1) still RAN to completion — record
  # it in history so the ETA reflects real runs. Any other non-zero code is a
  # crash, not a completed run, and is deliberately not recorded.
  if [ "$code" -eq 1 ] && [ "$dur" -gt 0 ]; then
    harness_mutation_history_append "$ROOT" "$iso" "$dur" "$count" "$score"
  fi
  print_block \
    "Stryker (mutation testing)" \
    "Mutation score fell below the break threshold (60)." \
    "$out" \
    "A surviving mutant means the test suite would not catch a real regression in that code path. Tests that run but assert nothing give false confidence, a common LLM failure mode." \
    "Add a real assertion that fails when the mutated code is wrong. Re-run: npm run check:mutation" \
    "Do not delete the failing mutant's test. Add a real assertion that fails when the code is wrong."
  exit 2
fi

# Passed: record this completed run in history (feeds the next run's ETA) and
# record the fingerprint so an identical source state skips next time. Only a
# strictly-positive duration is recorded (see the clock-skew guard above).
[ "$dur" -gt 0 ] && harness_mutation_history_append "$ROOT" "$iso" "$dur" "$count" "$score"
harness_mark_pass "$ROOT" "mutation" "$fp"
exit 0
