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
    "Feature import" \
    "An import crosses a feature boundary without going through the target feature's barrel, or the feature layout breaks B2." \
    "$1" \
    "B2 (kiko-code-style): a folder whose subfolders are barrelled units is a container and each unit is a feature. Inside a feature, import files by relative path; across features, import the barrel through @kiko/<feature>, or ../<sibling> between units of one non-screen container. A deep import couples a caller to a feature's internals, and a barrel that re-exports test code ships it in the App Store build." \
    "Use the suggestion after '->' on each line. A jest.mock/requireActual keeps the same resolved file, written as @kiko/<feature>/<inner path>. For a tree finding: move a loose file into its own unit folder, add the missing index.ts, declare a new container in feature-imports.js, or break the cycle." \
    "Do not add a test-only helper to a barrel, and do not re-export another feature's module from a barrel."
  exit 2
}

# Per-file mode (one file argument). A non-.ts/.tsx target, or no file at
# all, is silently out of scope.
if [ -n "$TARGET" ]; then
  if [ ! -f "$TARGET" ]; then
    exit 0
  fi

  case "$TARGET" in
    *.ts | *.tsx) : ;;
    *) exit 0 ;;
  esac

  dkey="feature-imports:$(printf '%s' "$TARGET" | harness_hash)"
  fp="$( { shasum "$TARGET" 2>/dev/null
          shasum "$DIR/feature-imports.js" "$DIR/specifier-scanner.js" 2>/dev/null; } | harness_hash )"
  if harness_unchanged "$ROOT" "$dkey" "$fp"; then
    exit 0
  fi

  out="$(node "$DIR/feature-imports.js" "$TARGET" 2>&1)" || fail "$out"
  harness_mark_pass "$ROOT" "$dkey" "$fp"
  exit 0
fi

# Project-wide mode: every .ts/.tsx under src/, __tests__/, e2e/, plus
# App.tsx, then the tree checks over src/.
# FEATURE_IMPORTS_SOURCE_ROOT replaces the scanned roots with one directory
# (holding its own src/) — used only by __tests__/feature-imports.test.ts,
# to point this mode at a disposable fixture tree; dedup is skipped then,
# since the code fingerprint reads the real repo's git state.
if [ -n "${FEATURE_IMPORTS_SOURCE_ROOT:-}" ]; then
  roots=("$FEATURE_IMPORTS_SOURCE_ROOT")
  source_root="$FEATURE_IMPORTS_SOURCE_ROOT/src"
else
  roots=("$ROOT/src" "$ROOT/__tests__" "$ROOT/e2e" "$ROOT/App.tsx")
  source_root="$ROOT/src"
  fp="$(harness_code_fingerprint "$ROOT")"
  if harness_unchanged "$ROOT" "feature-imports" "$fp"; then
    exit 0
  fi
fi

files=()
for root in "${roots[@]}"; do
  [ -e "$root" ] || continue
  while IFS= read -r file; do
    [ -n "$file" ] && files+=("$file")
  done < <(find "$root" -type f \( -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*' 2>/dev/null | sort)
done

out=""
status=0
if [ ${#files[@]} -gt 0 ]; then
  out="$(node "$DIR/feature-imports.js" "${files[@]}" 2>&1)" || status=1
fi
if [ -d "$source_root" ]; then
  tree_out="$(node "$DIR/feature-imports.js" --tree "$source_root" 2>&1)" || status=1
  out="$out${out:+${tree_out:+$'\n'}}$tree_out"
fi

[ "$status" -eq 0 ] || fail "$out"
[ -n "${FEATURE_IMPORTS_SOURCE_ROOT:-}" ] || harness_mark_pass "$ROOT" "feature-imports" "$fp"
exit 0
