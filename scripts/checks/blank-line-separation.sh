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
    "Blank line separation" \
    "One or more statements or JSX siblings are missing a required blank line." \
    "$1" \
    "kiko-code-style's 'Blank lines before statement blocks' and 'Blank line between adjacent JSX sibling nodes' rules: put a blank line before every return/if/for/while statement unless it is the first statement of its block or already preceded by a comment, and between two adjacent JSX sibling elements at the same nesting level unless they are the only two children or a comment already separates them." \
    "Run: node $DIR/blank-line-separation.js --write <file>   then re-check. --write re-checks its own output and prints 'left for hand fix: <file>:<line>: <kind>: <statement>' for anything it could not fix and exits non-zero; fix that by hand too." \
    "Do not add a blank line where the rule does not require one (the first statement of a block, or a two-child JSX pair)."
  exit 2
}

# Fast-tier, per-file mode (called from fast.sh with one edited file). A
# non-.ts/.tsx target, or no file at all, is silently out of scope. This
# checker is guard-mode only for now (scripts/checks/pre-write-guard.js) —
# it is not yet wired into fast.sh/check:all, so this branch exists for the
# same per-file shape as import-order.sh but is exercised directly by tests,
# not by the PostToolUse hook yet.
if [ -n "$TARGET" ]; then
  if [ ! -f "$TARGET" ]; then
    exit 0
  fi

  case "$TARGET" in
    *.ts | *.tsx) : ;;
    *) exit 0 ;;
  esac

  dkey="blank-line-separation:$(printf '%s' "$TARGET" | harness_hash)"
  fp="$( { shasum "$TARGET" 2>/dev/null
          shasum "$DIR/blank-line-separation.js" 2>/dev/null; } | harness_hash )"
  if harness_unchanged "$ROOT" "$dkey" "$fp"; then
    exit 0
  fi

  out="$(node "$DIR/blank-line-separation.js" "$TARGET" 2>&1)" || fail "$out"
  harness_mark_pass "$ROOT" "$dkey" "$fp"
  exit 0
fi

# Project-wide mode (no npm script yet — this checker is not in check:all):
# every .ts/.tsx under src/, __tests__/, e2e/, plus App.tsx itself, the same
# roots import-order.sh scans. BLANK_LINE_SOURCE_ROOT overrides the whole
# scanned-roots list with one directory — used only by
# __tests__/blank-line-separation.test.ts, to point this mode at a
# disposable temp fixture tree instead of the real (and much larger,
# currently violation-heavy) repo; dedup is skipped in that case, since the
# code fingerprint below reads the real repo's git state, not the temp
# tree's content.
if [ -n "${BLANK_LINE_SOURCE_ROOT:-}" ]; then
  roots=("$BLANK_LINE_SOURCE_ROOT")
else
  roots=("$ROOT/src" "$ROOT/__tests__" "$ROOT/e2e" "$ROOT/App.tsx")
  fp="$(harness_code_fingerprint "$ROOT")"
  if harness_unchanged "$ROOT" "blank-line-separation" "$fp"; then
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

out="$(node "$DIR/blank-line-separation.js" "${files[@]}" 2>&1)" || fail "$out"
[ -n "${BLANK_LINE_SOURCE_ROOT:-}" ] || harness_mark_pass "$ROOT" "blank-line-separation" "$fp"
exit 0
