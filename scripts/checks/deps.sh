#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
cd "$ROOT" || exit 2
BIN="$ROOT/node_modules/.bin/depcheck"

if [ ! -x "$BIN" ]; then
  print_block \
    "depcheck (unused / missing dependencies)" \
    "The depcheck tool is not installed in node_modules." \
    "$BIN was not found or is not executable." \
    "The harness tools live in node_modules. Without them, no check can run, and a missing tool must not look like a dependency problem." \
    "Run: npm install   then re-run: npm run check:deps" \
    "Do not run depcheck through npx without --no-install (that can auto-fetch an unpinned version from the network). Install the pinned version with npm install."
  exit 2
fi

# Skip when no source, manifest, or lockfile depcheck reads changed since
# its last pass. The code fingerprint covers package.json, package-lock.json,
# and the source import graph depcheck scans.
fp="$(harness_code_fingerprint "$ROOT")"
if harness_unchanged "$ROOT" "deps" "$fp"; then
  exit 0
fi

fail=0
details=""

# 1. Unused and missing dependencies.
depcheck_out="$("$BIN" 2>&1)"
depcheck_code=$?
if [ "$depcheck_code" -ne 0 ]; then
  fail=1
  details="${details}--- depcheck (unused / missing dependencies) ---
${depcheck_out}

"
fi

# 2. Lockfile integrity.
ci_out="$(npm ci --ignore-scripts --dry-run 2>&1)"
ci_code=$?
if [ "$ci_code" -ne 0 ]; then
  fail=1
  details="${details}--- npm ci --dry-run (lockfile integrity) ---
${ci_out}

"
fi

# 3. Exact pinning: no range spec (^, ~, *, x, >, <, ||, or a
# space-separated range) in dependencies, devDependencies, or overrides —
# see the pin-exact-dependency-versions rule.
ranges_out="$(node "$DIR/deps-ranges.js" "$ROOT/package.json" 2>&1)"
ranges_code=$?
if [ "$ranges_code" -ne 0 ]; then
  fail=1
  details="${details}--- deps-ranges.js (range spec, not an exact pin) ---
${ranges_out}

"
fi

# 4. A resolved-but-invalid dependency tree: npm ls --all fails
# (ELSPROBLEMS) when an override or a version conflict leaves some
# installed package's own requirement unsatisfied. The full tree can run
# to thousands of lines, so only the lines npm itself marks as the
# problem (its stderr, plus any tree line npm tags "invalid:"/"missing:")
# belong in the failure block.
ls_stderr_file="$(mktemp)"
ls_stdout="$(npm ls --all 2>"$ls_stderr_file")"
ls_code=$?
ls_stderr="$(cat "$ls_stderr_file" 2>/dev/null)"
rm -f "$ls_stderr_file"
if [ "$ls_code" -ne 0 ]; then
  fail=1
  ls_problem_lines="$(printf '%s\n' "$ls_stdout" | grep -E 'invalid:|missing:')"
  details="${details}--- npm ls --all (resolved tree validity) ---
${ls_stderr}
${ls_problem_lines}

"
fi

# 5. Hallucinated / new-dependency flag: surface any change to the
# dependencies or devDependencies blocks since the last commit, for
# human confirmation. This does not fail the check by itself.
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  dep_diff="$(git diff HEAD -- package.json | grep -E '^[+-]\s*"[^"]+":\s*"[^"]+"' | grep -v '^[+-][+-][+-]')"
  if [ -n "$dep_diff" ]; then
    details="${details}--- New/changed dependency entries since last commit (confirm these are real) ---
${dep_diff}

"
  fi
fi

if [ "$fail" -ne 0 ]; then
  print_block \
    "Dependency hygiene" \
    "depcheck, the lockfile integrity check, the exact-pin check, or npm ls failed." \
    "$details" \
    "An unused dependency bloats the app and its attack surface. A broken lockfile means installs are not reproducible. A range spec (rather than an exact pin) lets the resolved tree drift silently between installs. An ELSPROBLEMS tree means some installed package's own requirement is unsatisfied. A hallucinated dependency (a package name an LLM invented or mistyped) can be squatted by an attacker." \
    "Remove the unused dependency; fix the lockfile with npm install; pin any range spec to the exact version package-lock.json already resolves; scope an override to its real target package if it is making npm ls report another package invalid; confirm any new dependency actually exists and is the one you meant. Re-run: npm run check:deps" \
    "Do not add the dependency to depcheck ignores. Remove the unused dep; confirm any new dep is real. Do not widen an exact pin back to a range to silence this check."
  exit 2
fi
harness_mark_pass "$ROOT" "deps" "$fp"
exit 0
