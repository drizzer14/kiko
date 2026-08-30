#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
BIN="$ROOT/node_modules/.bin/biome"
TARGET="${1:-.}"

if [ ! -x "$BIN" ]; then
  print_block \
    "Biome (lint + format)" \
    "The biome tool is not installed in node_modules." \
    "$BIN was not found or is not executable." \
    "The harness tools live in node_modules. Without them, no check can run, and a missing tool must not look like a code problem." \
    "Run: npm install   then re-run: npm run check:lint" \
    "Do not run biome through npx without --no-install (that can auto-fetch an unpinned version from the network). Install the pinned version with npm install."
  exit 2
fi

out="$("$BIN" check "$TARGET" 2>&1)"
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
