#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
BIN="$ROOT/node_modules/.bin/biome"
TARGET="${1:-.}"

if [ ! -x "$BIN" ]; then
  print_block \
    "Biome (lint + format)" \
    "The biome tool is not installed in node_modules." \
    "$BIN was not found or is not executable." \
    "The harness tools live in node_modules. Without them, no check can run, and a missing tool must not look like a code problem." \
    "Run: npm install   then re-run: npm run check:lint" \
    "Do not run biome through npx without --no-install (that can auto-fetch an unpinned version from the network). Install the pinned version with npm install."
  exit 2
fi

# Dedup a single-file target on its content plus biome.json and the pinned
# Biome version (captured by package-lock.json). A whole-repo or directory
# target always runs.
dkey=""; fp=""
if [ -f "$TARGET" ]; then
  dkey="lint:$(printf '%s' "$TARGET" | harness_hash)"
  fp="$( { shasum "$TARGET" 2>/dev/null
          shasum "$ROOT/biome.json" 2>/dev/null
          shasum "$ROOT/package-lock.json" 2>/dev/null; } | harness_hash )"
  if harness_unchanged "$ROOT" "$dkey" "$fp"; then
    exit 0
  fi
fi

out="$("$BIN" check "$TARGET" 2>&1)"
code=$?
if [ "$code" -ne 0 ]; then
  # biome.json's files.includes deliberately excludes some paths (e.g. the
  # bad fixtures rules/fixtures/**/*.bad.*, ios/) from Biome altogether — a
  # bad fixture is allowed to hold code shapes that would otherwise fail lint
  # or format; a good fixture is processed (format only), so under
  # rules/fixtures/ this message means a bad fixture. Biome reports the
  # exact same "No files were processed…" message with a non-zero exit for a
  # target that is EXCLUDED and for a target that does not EXIST at all (an
  # internalError/io swallowed above it) — so this must only read as
  # "out of scope" when the target is a real file under one of biome.json's
  # excluded roots; anything else (a typo'd or missing path) is a genuine
  # failure, same as security.sh's own excluded-root check.
  if grep -q 'No files were processed in the specified paths\.' <<<"$out"; then
    if [ -f "$TARGET" ]; then
      case "$TARGET" in
        "$ROOT/ios/"* | ios/* | "$ROOT/vendor/"* | vendor/* | "$ROOT/coverage/"* | coverage/* \
          | "$ROOT/rules/fixtures/"* | rules/fixtures/* | *.jsbundle)
          [ -n "$dkey" ] && harness_mark_pass "$ROOT" "$dkey" "$fp"
          exit 0
          ;;
      esac
      # biome.json's files.includes above is a hand copy of the excluded
      # roots; vcs.useIgnoreFile: true means Biome ALSO reports this exact
      # message for any real file .gitignore covers (.claude/worktrees/,
      # .stryker-tmp/, .superpowers/, scratch_*), which the hand copy can
      # never enumerate. A file the target's own .gitignore excludes is
      # out of scope the same way — never a lint failure.
      if git -C "$ROOT" check-ignore -q "$TARGET" 2>/dev/null; then
        [ -n "$dkey" ] && harness_mark_pass "$ROOT" "$dkey" "$fp"
        exit 0
      fi
    fi
  fi

  print_block \
    "Biome (lint + format)" \
    "Biome found lint or format violations in $TARGET." \
    "$out" \
    "These are the code shapes an LLM over-produces: explicit any, unused symbols, and over-complex functions. They rot the codebase and hide bugs." \
    "Run: ./node_modules/.bin/biome check --write $TARGET  then fix any remaining errors by hand. Re-run: npm run check:lint" \
    "Do not silence a rule with a bare // biome-ignore. Fix the code, or use // biome-ignore <rule>: OVERRIDE(...) <specific reason>."
  exit 2
fi
[ -n "$dkey" ] && harness_mark_pass "$ROOT" "$dkey" "$fp"
exit 0
