#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
BIN="$ROOT/node_modules/.bin/jscpd"

if [ ! -x "$BIN" ]; then
  print_block \
    "jscpd (copy/paste detection)" \
    "The jscpd tool is not installed in node_modules." \
    "$BIN was not found or is not executable." \
    "The harness tools live in node_modules. Without them, no check can run, and a missing tool must not look like a code problem." \
    "Run: npm install   then re-run: npm run check:dup" \
    "Do not run jscpd through npx without --no-install (that auto-fetches jscpd@5 from the network). Install the pinned version with npm install."
  exit 2
fi

# Scope: paths passed as args (changed-files scope), else the whole repo.
paths=("$@"); [ ${#paths[@]} -eq 0 ] && paths=(".")

# Dedup only an explicit set of files (the changed-files scope), keyed on
# the set identity. jscpd detects duplication within the given set, so its
# result depends only on those files' contents plus .jscpd.json and the
# pinned jscpd version (captured by package-lock.json). The whole-repo
# manual run ("." with no args) always runs.
dkey=""; fp=""
if [ "$#" -gt 0 ]; then
  allfiles=1
  for p in "$@"; do [ -f "$p" ] || allfiles=0; done
  if [ "$allfiles" -eq 1 ]; then
    sorted="$(printf '%s\n' "$@" | sort -u)"
    dkey="dup:$(printf '%s' "$sorted" | harness_hash)"
    fp="$( { printf '%s\n' "$sorted" | while IFS= read -r p; do shasum "$p" 2>/dev/null; done
            shasum "$ROOT/.jscpd.json" 2>/dev/null
            shasum "$ROOT/package-lock.json" 2>/dev/null; } | harness_hash )"
    if harness_unchanged "$ROOT" "$dkey" "$fp"; then
      exit 0
    fi
  fi
fi

out="$("$BIN" "${paths[@]}" 2>&1)"
code=$?
if [ "$code" -ne 0 ]; then
  print_block \
    "jscpd (copy/paste detection)" \
    "jscpd found duplicated code above the configured threshold." \
    "$out" \
    "Duplicated blocks are a common LLM failure mode: copy-pasting instead of extracting a shared function. Duplication multiplies bug surface and drifts out of sync." \
    "Extract the shared block into one function or module and call it from both places. Re-run: npm run check:dup" \
    "Do not rename a variable to trick jscpd. Extract the shared block into one function."
  exit 2
fi
[ -n "$dkey" ] && harness_mark_pass "$ROOT" "$dkey" "$fp"
exit 0
