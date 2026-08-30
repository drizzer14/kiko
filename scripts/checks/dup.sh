#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
BIN="$ROOT/node_modules/.bin/jscpd"

if [ ! -x "$BIN" ]; then
  print_block \
    "jscpd (copy/paste detection)" \
    "The jscpd tool is not installed in node_modules." \
    "$BIN was not found or is not executable." \
    "The harness tools live in node_modules. Without them, no check can run, and a missing tool must not look like a code problem." \
    "Run: npm install   then re-run: npm run check:dup" \
    "Do not run jscpd through npx without --no-install (that auto-fetches jscpd@5 from the network). Install the pinned version with npm install."
  exit 2
fi

# Scope: paths passed as args (changed-files scope), else the whole repo.
paths=("$@"); [ ${#paths[@]} -eq 0 ] && paths=(".")
out="$("$BIN" "${paths[@]}" 2>&1)"
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
