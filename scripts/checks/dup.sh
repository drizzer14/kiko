#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"

out="$(npx --no-install jscpd . 2>&1)"
code=$?
if [ "$code" -ne 0 ]; then
  print_block \
    "jscpd (copy/paste detection)" \
    "jscpd found duplicated code above the configured threshold." \
    "$out" \
    "Duplicated blocks are a common LLM failure mode: copy-pasting instead of extracting a shared function. Duplication multiplies bug surface and drifts out of sync." \
    "Extract the shared block into one function or module and call it from both places. Re-run: npm run check:dup" \
    "Do not rename a variable to trick jscpd. Extract the shared block into one function."
  exit 2
fi
exit 0
