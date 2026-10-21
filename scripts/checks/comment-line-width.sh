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
    "Comment line width" \
    "One or more comment lines are longer than 100 columns, or a pinned long line is stale." \
    "$1" \
    "kiko-code-style's 'Wrap comments at 100 columns' rule: biome.json sets formatter.lineWidth to 100, but Biome cannot wrap a comment, so the author wraps it. A line holding comment text (a // comment, any line of a block comment, a JSX comment, a # comment line of a shell or YAML file) fails past column 100, unless its comment text has no whitespace where a wrap would bring the line within 100 (one long URL). scripts/checks/comment-line-width.pinned lists the exact fixture lines that cannot wrap; it only shrinks, so a pin whose line is gone fails as stale." \
    "Wrap the comment at 100 columns: break it at a space and continue on the next line at the same indentation, or move a trailing comment above its code. For a stale pin, delete its row from scripts/checks/comment-line-width.pinned. Re-run: npm run check:comment-line-width" \
    "Do not shorten the words, drop the explanation, or split a URL to fit. Do not add a pin for a line that can wrap. There is no inline override."
  exit 2
}

# Pinned exact lines (scripts/checks/comment-line-width.pinned). COMMENT_LINE_WIDTH_PINNED points
# at another pin file; with COMMENT_LINE_WIDTH_SOURCE_ROOT set the list is empty unless that
# variable names one, so a disposable tree is never checked against the real repo's pins. The
# rows' paths are relative to the scanned root.
pin_root="${COMMENT_LINE_WIDTH_SOURCE_ROOT:-$ROOT}"
if [ -n "${COMMENT_LINE_WIDTH_PINNED:-}" ]; then
  pinned="$COMMENT_LINE_WIDTH_PINNED"
elif [ -z "${COMMENT_LINE_WIDTH_SOURCE_ROOT:-}" ]; then
  pinned="$DIR/comment-line-width.pinned"
else
  pinned=""
fi
pin_arguments=()
if [ -n "$pinned" ]; then
  harness_require_path "Comment line width" "$pinned" || exit 2
  pin_arguments=(--pinned "$pinned" --root "$pin_root")
fi

# Per-file mode (one file argument; fast.sh calls it for a .js, shell, YAML or githooks write). A
# file of a type or in a folder the project-wide mode does not read is out of scope. The case
# below is the scope: a .js file counts only below any scripts/ path segment (at any depth),
# rules/fixtures/ or githooks/ (a generated header such as the one in
# drizzle/migrations/migrations.js would otherwise block every edit of it). A path that is not an
# existing regular file (deleted, or a directory) exits 2 with a block. Content dedup is not used:
# one file is cheaper to read than to fingerprint.
if [ -n "$TARGET" ]; then
  harness_require_file "Comment line width" "$TARGET" || exit 2

  case "$TARGET" in
    githooks/* | */githooks/* | scripts/*.js | */scripts/*.js | rules/fixtures/*.js \
      | */rules/fixtures/*.js) : ;;
    *.js) exit 0 ;;
    *.ts | *.tsx | *.sh | *.bash | *.yml | *.yaml) : ;;
    *) exit 0 ;;
  esac

  out="$(node "$DIR/comment-line-width.js" ${pin_arguments[@]+"${pin_arguments[@]}"} "$TARGET" 2>&1)" \
    || fail "$out"
  exit 0
fi

# Project-wide mode (npm run check:comment-line-width, in check:all). The scanned files:
#   - .ts/.tsx under the roots full-word-identifiers.sh scans for TypeScript (src/, __tests__/,
#     scripts/, jest/, __mocks__/, e2e/, plus App.tsx and drizzle.config.ts);
#   - .js, .sh and .bash under scripts/;
#   - .ts, .tsx, .js and .sh under rules/fixtures/, rules/*.yml, .maestro/*.yaml and
#     .maestro/*.yml;
#   - githooks/*, and every other .sh or .bash file git tracks or has not ignored.
# harness/kiko/scripts/run-log.mjs is never scanned: it stays byte-identical with the harness
# repository it is copied from. COMMENT_LINE_WIDTH_SOURCE_ROOT replaces the whole list with
# one directory, scanned for every type above, used only by __tests__/comment-line-width.test.ts
# to point this mode at a disposable temp tree; dedup is skipped in that case, since the
# fingerprint below reads the real repo's git state, not the temp tree's content. The
# fingerprint covers every .ts/.tsx/.js change, the shell and YAML files scanned and the pin
# file, so an edit to comment-line-width.js or specifier-scanner.js re-runs the check.
SOURCE_TYPES=(-name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.sh' -o -name '*.bash'
  -o -name '*.yml' -o -name '*.yaml')

list_files() {
  local root
  if [ -n "${COMMENT_LINE_WIDTH_SOURCE_ROOT:-}" ]; then
    find "$COMMENT_LINE_WIDTH_SOURCE_ROOT" -type f \( "${SOURCE_TYPES[@]}" -o -path '*/githooks/*' \)
    return 0
  fi
  for root in src __tests__ jest __mocks__ e2e; do
    [ -e "$ROOT/$root" ] && find "$ROOT/$root" -type f \( -name '*.ts' -o -name '*.tsx' \)
  done
  [ -e "$ROOT/scripts" ] && find "$ROOT/scripts" -type f \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.sh' -o -name '*.bash' \)
  [ -e "$ROOT/rules/fixtures" ] && find "$ROOT/rules/fixtures" -type f \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.sh' \)
  [ -e "$ROOT/rules" ] && find "$ROOT/rules" -maxdepth 1 -type f -name '*.yml'
  [ -e "$ROOT/.maestro" ] && find "$ROOT/.maestro" -maxdepth 1 -type f \
    \( -name '*.yaml' -o -name '*.yml' \)
  [ -e "$ROOT/githooks" ] && find "$ROOT/githooks" -type f
  for root in App.tsx drizzle.config.ts; do
    [ -f "$ROOT/$root" ] && printf '%s\n' "$ROOT/$root"
  done
  git -C "$ROOT" ls-files --cached --others --exclude-standard -- '*.sh' '*.bash' 2>/dev/null \
    | while IFS= read -r tracked; do
        [ -f "$ROOT/$tracked" ] && printf '%s\n' "$ROOT/$tracked"
      done
  return 0
}

if [ -n "${COMMENT_LINE_WIDTH_SOURCE_ROOT:-}" ]; then
  harness_require_path "Comment line width" "$COMMENT_LINE_WIDTH_SOURCE_ROOT" || exit 2
fi

files=()
while IFS= read -r file; do
  [ -n "$file" ] && files+=("$file")
done < <(list_files | sort -u)

if [ ${#files[@]} -eq 0 ]; then
  exit 0
fi

fp=""
if [ -z "${COMMENT_LINE_WIDTH_SOURCE_ROOT:-}" ]; then
  fp="$( { harness_code_fingerprint "$ROOT"
          [ -n "$pinned" ] && shasum "$pinned" 2>/dev/null
          printf '%s\n' "${files[@]}" | grep -vE '\.(ts|tsx|js)$' | while IFS= read -r other; do
            shasum "$other" 2>/dev/null
          done; } | harness_hash )"
  if harness_unchanged "$ROOT" "comment-line-width" "$fp"; then
    exit 0
  fi
fi

complete_arguments=()
[ -n "$pinned" ] && complete_arguments=(--complete)

out="$(node "$DIR/comment-line-width.js" ${pin_arguments[@]+"${pin_arguments[@]}"} \
  ${complete_arguments[@]+"${complete_arguments[@]}"} "${files[@]}" 2>&1)" || fail "$out"
[ -n "$fp" ] && harness_mark_pass "$ROOT" "comment-line-width" "$fp"
exit 0
