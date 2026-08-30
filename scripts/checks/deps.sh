#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
cd "$ROOT" || exit 2

fail=0
details=""

# 1. Unused and missing dependencies.
depcheck_out="$(npx --no-install depcheck 2>&1)"
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

# 3. Hallucinated / new-dependency flag: surface any change to the
# dependencies or devDependencies blocks since the last commit, for
# human confirmation. This does not fail the check by itself.
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  dep_diff="$(git diff HEAD -- package.json | grep -E '^[+-]\s*"[^"]+":\s*"[^"]+"' | grep -v '^[+-][+-][+-]' || true)"
  if [ -n "$dep_diff" ]; then
    details="${details}--- New/changed dependency entries since last commit (confirm these are real) ---
${dep_diff}

"
  fi
fi

if [ "$fail" -ne 0 ]; then
  print_block \
    "Dependency hygiene" \
    "depcheck or the lockfile integrity check failed." \
    "$details" \
    "An unused dependency bloats the app and its attack surface. A broken lockfile means installs are not reproducible. A hallucinated dependency (a package name an LLM invented or mistyped) can be squatted by an attacker." \
    "Remove the unused dependency; fix the lockfile with npm install; confirm any new dependency actually exists and is the one you meant. Re-run: npm run check:deps" \
    "Do not add the dependency to depcheck ignores. Remove the unused dep; confirm any new dep is real."
  exit 2
fi
exit 0
