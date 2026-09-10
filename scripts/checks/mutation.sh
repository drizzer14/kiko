#!/usr/bin/env bash
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
      | grep -Ev '(\.test\.tsx?$|(^|/)__tests__/|(^|/)rules/fixtures/)' || true)"
    if [ -z "$changed" ]; then
      # This branch changed no mutable source file — nothing to mutate, pass.
      exit 0
    fi
    csv="$(printf '%s' "$changed" | tr '\n' ',')"
    mutate_arg="--mutate=${csv%,}"
  fi
fi

# Stream Stryker's output to stdout LIVE (via tee) while still capturing it for
# the failure block and preserving its real exit code. `pipefail` is already set
# at the top, and PIPESTATUS[0] reads the producer's status through the tee, not
# tee's own — read immediately after the pipe, before any other command resets
# it. check:deep is manual and NOT hook-wired, so the "silent on success" hook
# contract does not apply: streaming a run's progress is the point. `$mutate_arg`
# is a single token with no spaces (or empty), so the unquoted expansion is safe.
tmp="$(mktemp "${TMPDIR:-/tmp}/kiko-mutation.XXXXXX")"
"$BIN" run $mutate_arg 2>&1 | tee "$tmp"
code="${PIPESTATUS[0]}"
out="$(cat "$tmp")"
rm -f "$tmp"
if [ "$code" -ne 0 ]; then
  print_block \
    "Stryker (mutation testing)" \
    "Mutation score fell below the break threshold (60)." \
    "$out" \
    "A surviving mutant means the test suite would not catch a real regression in that code path. Tests that run but assert nothing give false confidence, a common LLM failure mode." \
    "Add a real assertion that fails when the mutated code is wrong. Re-run: npm run check:mutation" \
    "Do not delete the failing mutant's test. Add a real assertion that fails when the code is wrong."
  exit 2
fi

# Passed: record the fingerprint so an identical source state skips next time.
harness_mark_pass "$ROOT" "mutation" "$fp"
exit 0
