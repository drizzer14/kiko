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
    "Cross-screen import" \
    "A file under src/screens/<screen>/ imports from another screen's folder." \
    "$1" \
    "Design spec rule 12: a file under src/screens/<screen-a>/ must not import from src/screens/<screen-b>/** for any screen-b != screen-a. Shared code belongs in src/design-system/ (a UI component) or the owning domain module (a hook/util), never in the importing screen-b via a direct path." \
    "Move the shared module out of src/screens/ into src/design-system/components/ or the owning domain module, following the FieldTrigger precedent in kiko-design-system's 'Component set' section, then import it from there. If the module is really screen-owned and only mis-placed, move the IMPORTER instead." \
    "Do not re-export the module through a barrel still nested inside src/screens/ — the barrel itself is still 'another screen's folder'."
  exit 2
}

# Per-file mode (one file argument). fast.sh does not call it, and the
# pre-write guard's runNodeChecks spawns screen-imports.js itself, not this
# wrapper, so only the tests exercise this branch. A non-.ts/.tsx target, or
# no file at all, is silently out of scope.
if [ -n "$TARGET" ]; then
  harness_require_path "Cross-screen import" "$TARGET" || exit 2
  [ -f "$TARGET" ] || exit 0

  case "$TARGET" in
    *.ts | *.tsx) : ;;
    *) exit 0 ;;
  esac

  dkey="screen-imports:$(printf '%s' "$TARGET" | harness_hash)"
  fp="$( { shasum "$TARGET" 2>/dev/null
          shasum "$DIR/screen-imports.js" 2>/dev/null; } | harness_hash )"
  if harness_unchanged "$ROOT" "$dkey" "$fp"; then
    exit 0
  fi

  out="$(node "$DIR/screen-imports.js" "$TARGET" 2>&1)" || fail "$out"
  harness_mark_pass "$ROOT" "$dkey" "$fp"
  exit 0
fi

# Project-wide mode (npm run check:screen-imports, wired into check:all):
# every .ts/.tsx under src/, __tests__/, e2e/, plus App.tsx itself, the same
# roots import-order.sh/blank-line-separation.sh scan.
# SCREEN_IMPORTS_SOURCE_ROOT overrides the whole scanned-roots list with one
# directory — used only by __tests__/screen-imports.test.ts, to point this
# mode at a disposable temp fixture tree instead of the real repo; dedup is
# skipped in that case, since the code fingerprint below reads the real
# repo's git state, not the temp tree's content.
if [ -n "${SCREEN_IMPORTS_SOURCE_ROOT:-}" ]; then
  harness_require_path "Cross-screen import" "$SCREEN_IMPORTS_SOURCE_ROOT" || exit 2
  roots=("$SCREEN_IMPORTS_SOURCE_ROOT")
else
  roots=("$ROOT/src" "$ROOT/__tests__" "$ROOT/e2e" "$ROOT/App.tsx")
  fp="$(harness_code_fingerprint "$ROOT")"
  if harness_unchanged "$ROOT" "screen-imports" "$fp"; then
    exit 0
  fi
fi

files=()
for root in "${roots[@]}"; do
  [ -e "$root" ] || continue
  while IFS= read -r file; do
    [ -n "$file" ] && files+=("$file")
  done < <(find "$root" -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null | sort)
done

if [ ${#files[@]} -eq 0 ]; then
  exit 0
fi

out="$(node "$DIR/screen-imports.js" "${files[@]}" 2>&1)" || fail "$out"
[ -n "${SCREEN_IMPORTS_SOURCE_ROOT:-}" ] || harness_mark_pass "$ROOT" "screen-imports" "$fp"
exit 0
