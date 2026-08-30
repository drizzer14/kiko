#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"

out="$(npx --no-install knip 2>&1)"
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
