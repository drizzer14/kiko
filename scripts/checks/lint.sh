#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
TARGET="${1:-.}"

out="$(npx --no-install biome check "$TARGET" 2>&1)"
code=$?
if [ "$code" -ne 0 ]; then
  print_block \
    "Biome (lint + format)" \
    "Biome found lint or format violations in $TARGET." \
    "$out" \
    "These are the code shapes an LLM over-produces: explicit any, unused symbols, and over-complex functions. They rot the codebase and hide bugs." \
    "Run: npx biome check --write $TARGET  then fix any remaining errors by hand. Re-run: npm run check:lint" \
    "Do not silence a rule with a bare // biome-ignore. Fix the code, or use // biome-ignore <rule>: OVERRIDE(...) <specific reason>."
  exit 2
fi
exit 0
