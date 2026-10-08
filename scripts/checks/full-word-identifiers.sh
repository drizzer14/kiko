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

# Fast-tier, per-file mode (called from fast.sh with one edited file). Every
# .ts/.tsx is in scope; a .js/.mjs/.cjs is in scope only under a scripts/
# directory (fast.sh's own harness-tooling scripts, which are checked-in
# source the same as everything else, and the only place today's tree has a
# CommonJS/ESM file next to TypeScript). Anything else, or no file at all,
# is silently out of scope.
if [ -n "$TARGET" ]; then
  if [ ! -f "$TARGET" ]; then
    exit 0
  fi

  case "$TARGET" in
    *.ts | *.tsx) : ;;
    scripts/*.js | scripts/*.mjs | scripts/*.cjs) : ;;
    */scripts/*.js | */scripts/*.mjs | */scripts/*.cjs) : ;;
    *) exit 0 ;;
  esac

  dkey="full-word-identifiers:$(printf '%s' "$TARGET" | harness_hash)"
  fp="$( { shasum "$TARGET" 2>/dev/null
          shasum "$DIR/full-word-identifiers.js" 2>/dev/null; } | harness_hash )"
  if harness_unchanged "$ROOT" "$dkey" "$fp"; then
    exit 0
  fi

  out="$(node "$DIR/full-word-identifiers.js" "$TARGET" 2>&1)" || fail "$out"
  harness_mark_pass "$ROOT" "$dkey" "$fp"
  exit 0
fi

# Project-wide mode (npm run check:full-word-identifiers / check:all): every
# .ts/.tsx under src/, __tests__/, rules/fixtures/, scripts/, jest/,
# __mocks__/, e2e/, plus App.tsx and drizzle.config.ts themselves —
# everything the fast tier already checks on a fresh edit (App.tsx and
# drizzle.config.ts are .ts/.tsx files the fast-tier case above admits like
# any other; jest/, __mocks__/, and e2e/ hold .ts/.tsx test/fixture/mock
# code, no different from __tests__/), plus a second pass for .js/.mjs/.cjs
# under any scripts/ directory in scope, mirroring the fast-tier rule above
# so this mode can never silently miss a file the hook guards.
# FULL_WORD_IDENTIFIERS_SRC_ROOT overrides the whole scanned-roots list with
# one directory — used only by __tests__/full-word-identifiers.test.ts, to
# point this mode at a disposable temp fixture tree instead of the real (and
# much larger) repo; dedup is skipped in that case, since the code
# fingerprint below reads the real repo's git state, not the temp tree's
# content.
if [ -z "${FULL_WORD_IDENTIFIERS_SRC_ROOT:-}" ]; then
  fp="$(harness_code_fingerprint "$ROOT")"
  if harness_unchanged "$ROOT" "full-word-identifiers" "$fp"; then
    exit 0
  fi
fi

if [ -n "${FULL_WORD_IDENTIFIERS_SRC_ROOT:-}" ]; then
  roots=("$FULL_WORD_IDENTIFIERS_SRC_ROOT")
  script_roots=("$FULL_WORD_IDENTIFIERS_SRC_ROOT/scripts")
else
  roots=(
    "$ROOT/src" "$ROOT/__tests__" "$ROOT/rules/fixtures" "$ROOT/scripts"
    "$ROOT/jest" "$ROOT/__mocks__" "$ROOT/e2e"
  )
  script_roots=("$ROOT/scripts")
fi

files=()
for root in "${roots[@]}"; do
  [ -d "$root" ] || continue
  while IFS= read -r f; do
    [ -n "$f" ] && files+=("$f")
  done < <(find "$root" -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null | sort)
done

for root in "${script_roots[@]}"; do
  [ -d "$root" ] || continue
  while IFS= read -r f; do
    [ -n "$f" ] && files+=("$f")
  done < <(find "$root" -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' \) 2>/dev/null | sort)
done

if [ -z "${FULL_WORD_IDENTIFIERS_SRC_ROOT:-}" ]; then
  for extra in "$ROOT/App.tsx" "$ROOT/drizzle.config.ts"; do
    [ -f "$extra" ] && files+=("$extra")
  done
fi

if [ ${#files[@]} -eq 0 ]; then
  exit 0
fi

out="$(node "$DIR/full-word-identifiers.js" "${files[@]}" 2>&1)" || fail "$out"
[ -n "${FULL_WORD_IDENTIFIERS_SRC_ROOT:-}" ] || harness_mark_pass "$ROOT" "full-word-identifiers" "$fp"
exit 0
