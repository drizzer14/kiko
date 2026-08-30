#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
BIN="$ROOT/node_modules/.bin/knip"

if [ ! -x "$BIN" ]; then
  print_block \
    "Knip (unused files, exports, deps)" \
    "The knip tool is not installed in node_modules." \
    "$BIN was not found or is not executable." \
    "The harness tools live in node_modules. Without them, no check can run, and a missing tool must not look like a code problem." \
    "Run: npm install   then re-run: npm run check:knip" \
    "Do not run knip through npx without --no-install (that can auto-fetch an unpinned version from the network). Install the pinned version with npm install."
  exit 2
fi

out="$("$BIN" 2>&1)"
code=$?
if [ "$code" -ne 0 ]; then
  print_block \
    "Knip (unused files, exports, deps)" \
    "Knip found unused files, exports, or dependencies." \
    "$out" \
    "Dead code and unreachable exports are a common LLM failure mode: scaffolding left behind after a refactor, or speculative exports nothing calls. They rot the codebase and confuse the next reader." \
    "Delete the unused file or export, or remove the unused dependency. Re-run: npm run check:knip" \
    "Do not add the export to an ignore list. Delete the unused export or file."
  exit 2
fi
exit 0
