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
    "Full words in identifiers" \
    "One or more identifiers shorten a word kiko-code-style requires in full." \
    "$1" \
    "kiko-code-style's 'Full words in identifiers' rule: no abbreviated word (cond/btn/idx/acc/tx/err/val/prev/cfg/e/res/msg/cb/ctx/el/opts/tmp/num/arr/obj/str) as a whole camelCase/PascalCase/snake_case part of a variable, parameter, function, type, or prop name. An abbreviation saves a few keystrokes and costs the reader a lookup." \
    "Spell the word out in full (e.g. tx -> transaction, idx -> index, opts -> options). Re-run: npm run check:full-word-identifiers" \
    "Do not rename a testID, an i18n key, a DB column, a persisted JSON key, or a name forced by a third-party API/library prop — those stay as-is even if they match the denylist. Add a new exact-path exemption in scripts/checks/full-word-identifiers.js only for a verified external-name case, documented in docs/harness/documented-exceptions.md."
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

  out="$(node "$DIR/full-word-identifiers.js" "$TARGET" 2>&1)" || fail "$out"
  exit 0
fi

# Project-wide mode (npm run check:full-word-identifiers / check:all): every
# .ts/.tsx under src/, __tests__/, rules/fixtures/, and scripts/ — the same
# scope the R1.d sweep covers. FULL_WORD_IDENTIFIERS_SRC_ROOT overrides the
# whole scanned-roots list with one directory — used only by
# __tests__/full-word-identifiers.test.ts, to point this mode at a
# disposable temp fixture tree instead of the real (and much larger) repo.
if [ -n "${FULL_WORD_IDENTIFIERS_SRC_ROOT:-}" ]; then
  roots=("$FULL_WORD_IDENTIFIERS_SRC_ROOT")
else
  roots=("$ROOT/src" "$ROOT/__tests__" "$ROOT/rules/fixtures" "$ROOT/scripts")
fi

files=()
for root in "${roots[@]}"; do
  [ -d "$root" ] || continue
  while IFS= read -r f; do
    [ -n "$f" ] && files+=("$f")
  done < <(find "$root" -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null | sort)
done

if [ ${#files[@]} -eq 0 ]; then
  exit 0
fi

out="$(node "$DIR/full-word-identifiers.js" "${files[@]}" 2>&1)" || fail "$out"
exit 0
