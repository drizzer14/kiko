#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"

out="$(npx --no-install stryker run 2>&1)"
code=$?
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
exit 0
