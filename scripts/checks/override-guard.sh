#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"

# With no args, scan the repo. With args, scan only those paths
# (the medium tier's changed-files scope).
if [ "$#" -eq 0 ]; then
  scan_targets=("$ROOT")
else
  scan_targets=("$@")
fi

# Dedup only an explicit set of files. The check greps their contents for an
# unjustified biome-ignore, so its result depends only on those files.
dkey=""; fp=""
if [ "$#" -gt 0 ]; then
  allfiles=1
  for p in "$@"; do [ -f "$p" ] || allfiles=0; done
  if [ "$allfiles" -eq 1 ]; then
    sorted="$(printf '%s\n' "$@" | sort -u)"
    dkey="override:$(printf '%s' "$sorted" | harness_hash)"
    fp="$(printf '%s\n' "$sorted" | while IFS= read -r p; do shasum "$p" 2>/dev/null; done | harness_hash)"
    if harness_unchanged "$ROOT" "$dkey" "$fp"; then
      exit 0
    fi
  fi
fi

hits="$(grep -nE 'biome-ignore' \
  --include='*.ts' --include='*.tsx' --include='*.js' \
  --exclude-dir=node_modules --exclude-dir=ios --exclude-dir=vendor -r "${scan_targets[@]}" \
  | grep -v 'OVERRIDE(')"
if [ -n "$hits" ]; then
  print_block \
    "Override guard" \
    "A biome-ignore has no OVERRIDE(...) justification." \
    "$hits" \
    "An unexplained suppression hides a real problem from the next reader and from review." \
    "Add the reason: // biome-ignore <rule>: OVERRIDE(...) <specific reason>. Re-run: npm run check:overrides" \
    "Do not delete the guard. Justify the override, or fix the code so the ignore is not needed."
  exit 2
fi
[ -n "$dkey" ] && harness_mark_pass "$ROOT" "$dkey" "$fp"
exit 0
