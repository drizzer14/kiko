#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
TARGET="${1:-}"

fail() {
  # $1 details
  print_block \
    "Import ordering" \
    "One or more leading import blocks are not sorted per kiko-code-style." \
    "$1" \
    "kiko-code-style's Import ordering rule: 3 blank-line-separated groups (external / ../** / ./**), each sorted ascending by the ending physical line's length, value imports before import type only as an equal-length tiebreak, and a bare side-effect import as a barrier that is never reordered." \
    "Run: node $DIR/import-order.js --write <file>   then re-check. A group with a comment glued to a non-first import is left untouched by --write; move it by hand." \
    "Do not reorder an import across a bare side-effect import — module-initialization order must be preserved."
  exit 2
}

# Fast-tier, per-file mode (called from fast.sh with one edited file). A
# non-.ts/.tsx target, or no file at all, is silently out of scope.
if [ -n "$TARGET" ]; then
  if [ ! -f "$TARGET" ]; then
    exit 0
  fi

  case "$TARGET" in
    *.ts | *.tsx) : ;;
    *) exit 0 ;;
  esac

  out="$(node "$DIR/import-order.js" "$TARGET" 2>&1)" || fail "$out"
  exit 0
fi

# Project-wide mode (npm run check:import-order / check:all): every .ts/.tsx
# under src/. IMPORT_ORDER_SRC_ROOT overrides the scanned directory — used
# only by __tests__/import-order.test.ts, to point this mode at a disposable
# temp fixture tree instead of the real (and much larger) repo src/.
SRC_DIR="${IMPORT_ORDER_SRC_ROOT:-$ROOT/src}"
files=()
while IFS= read -r f; do
  [ -n "$f" ] && files+=("$f")
done < <(find "$SRC_DIR" -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null | sort)

if [ ${#files[@]} -eq 0 ]; then
  exit 0
fi

out="$(node "$DIR/import-order.js" "${files[@]}" 2>&1)" || fail "$out"
exit 0
