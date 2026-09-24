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
    "kiko-code-style's Import ordering rule: 3 blank-line-separated groups in this order (external, then ../**, then ./**), each holding only imports of its own kind, sorted ascending within the group by the ending physical line's length, value imports before import type only as an equal-length tiebreak, and a bare side-effect import as a barrier that is never reordered." \
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

  dkey="import-order:$(printf '%s' "$TARGET" | harness_hash)"
  fp="$( { shasum "$TARGET" 2>/dev/null
          shasum "$DIR/import-order.js" 2>/dev/null; } | harness_hash )"
  if harness_unchanged "$ROOT" "$dkey" "$fp"; then
    exit 0
  fi

  out="$(node "$DIR/import-order.js" "$TARGET" 2>&1)" || fail "$out"
  harness_mark_pass "$ROOT" "$dkey" "$fp"
  exit 0
fi

# Project-wide mode (npm run check:import-order / check:all): every .ts/.tsx
# under src/, __tests__/, e2e/, plus App.tsx itself — everything the fast-tier
# hook would check on a fresh edit, so this mode can never silently miss a
# file the hook guards. IMPORT_ORDER_SRC_ROOT overrides the whole scanned-
# roots list with one directory — used only by __tests__/import-order.test.ts,
# to point this mode at a disposable temp fixture tree instead of the real
# (and much larger) repo; dedup is skipped in that case, since the code
# fingerprint below reads the real repo's git state, not the temp tree's
# content.
if [ -n "${IMPORT_ORDER_SRC_ROOT:-}" ]; then
  roots=("$IMPORT_ORDER_SRC_ROOT")
else
  roots=("$ROOT/src" "$ROOT/__tests__" "$ROOT/e2e" "$ROOT/App.tsx")
  fp="$(harness_code_fingerprint "$ROOT")"
  if harness_unchanged "$ROOT" "import-order" "$fp"; then
    exit 0
  fi
fi

files=()
for root in "${roots[@]}"; do
  [ -e "$root" ] || continue
  while IFS= read -r f; do
    [ -n "$f" ] && files+=("$f")
  done < <(find "$root" -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null | sort)
done

if [ ${#files[@]} -eq 0 ]; then
  exit 0
fi

out="$(node "$DIR/import-order.js" "${files[@]}" 2>&1)" || fail "$out"
[ -n "${IMPORT_ORDER_SRC_ROOT:-}" ] || harness_mark_pass "$ROOT" "import-order" "$fp"
exit 0
