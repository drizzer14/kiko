#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"

fail() {
  # $1 details
  print_block \
    "Comment line width" \
    "One or more comment lines are longer than 100 columns." \
    "$1" \
    "kiko-code-style's 'Wrap comments at 100 columns' rule: biome.json sets formatter.lineWidth to 100, but Biome cannot wrap a comment, so the author wraps it. A line holding comment text (a // comment, any line of a block comment, a JSX comment) fails past column 100, unless its comment text has no whitespace where a wrap would bring the line within 100 (one long URL)." \
    "Wrap the comment at 100 columns: break it at a space and continue on the next line at the same indentation, or move a trailing comment above its code. Re-run: npm run check:comment-line-width" \
    "Do not shorten the words, drop the explanation, or split a URL to fit. There is no inline override."
  exit 2
}

# Project-wide only (npm run check:comment-line-width): every .ts/.tsx under the roots
# full-word-identifiers.sh scans for TypeScript (src/, __tests__/, scripts/, jest/, __mocks__/,
# e2e/, plus App.tsx and drizzle.config.ts), except rules/fixtures/, which the pre-write guard
# never reads either. The pre-write guard spawns comment-line-width.js itself, so there is no
# per-file mode. COMMENT_LINE_WIDTH_SOURCE_ROOT overrides the whole scanned-roots list with
# one directory, used only by __tests__/comment-line-width.test.ts to point this mode at a
# disposable temp tree; dedup is skipped in that case, since the code fingerprint below reads
# the real repo's git state, not the temp tree's content. The fingerprint covers every .js
# change, so an edit to comment-line-width.js or specifier-scanner.js re-runs the check.
if [ -n "${COMMENT_LINE_WIDTH_SOURCE_ROOT:-}" ]; then
  harness_require_path "Comment line width" "$COMMENT_LINE_WIDTH_SOURCE_ROOT" || exit 2
  roots=("$COMMENT_LINE_WIDTH_SOURCE_ROOT")
else
  roots=(
    "$ROOT/src" "$ROOT/__tests__" "$ROOT/scripts" "$ROOT/jest" "$ROOT/__mocks__" "$ROOT/e2e"
    "$ROOT/App.tsx" "$ROOT/drizzle.config.ts"
  )
  fp="$(harness_code_fingerprint "$ROOT")"
  if harness_unchanged "$ROOT" "comment-line-width" "$fp"; then
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

out="$(node "$DIR/comment-line-width.js" "${files[@]}" 2>&1)" || fail "$out"
[ -n "${COMMENT_LINE_WIDTH_SOURCE_ROOT:-}" ] || harness_mark_pass "$ROOT" "comment-line-width" "$fp"
exit 0
