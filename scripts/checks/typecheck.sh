#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
BIN="$ROOT/node_modules/.bin/tsc"

if [ ! -x "$BIN" ]; then
  print_block \
    "TypeScript (tsc --noEmit)" \
    "The typescript compiler is not installed in node_modules." \
    "$BIN was not found or is not executable." \
    "The harness tools live in node_modules. Without them, no check can run, and a missing tool must not look like a code problem." \
    "Run: npm install   then re-run: npm run check:typecheck" \
    "Do not run tsc through npx without --no-install (that can auto-fetch an unpinned version from the network). Install the pinned version with npm install."
  exit 2
fi

out="$(cd "$ROOT" && "$BIN" --noEmit 2>&1)"
code=$?
if [ "$code" -ne 0 ]; then
  print_block \
    "TypeScript (tsc --noEmit)" \
    "tsc reported type errors." \
    "$out" \
    "A type error is a real defect the runtime cannot catch: a prop the native view discards, a ref the library never populates, a catalogue key that does not exist. The baseline was zeroed deliberately; any new error is a regression, not accumulated noise." \
    "Fix the type at its source. Re-run: npm run check:typecheck" \
    "Do not add @ts-expect-error, do not widen a type to any, and do not exclude a file from tsconfig.json to get green."
  exit 2
fi
exit 0
