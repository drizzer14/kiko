#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
cd "$ROOT"

# Session changed source files: tracked changes + untracked, filtered to source.
# (Portable form of `mapfile -t`: the macOS system bash is 3.2 and has no
# mapfile/readarray builtin.)
changed=()
while IFS= read -r f; do
  [ -n "$f" ] && changed+=("$f")
done < <(
  { git diff --name-only HEAD; git ls-files --others --exclude-standard; } \
    | grep -E '\.(ts|tsx|js)$' \
    | grep -vE '^(ios/|node_modules/)' \
    | sort -u
)

# No changed source file (the coordinator case): stay silent.
if [ ${#changed[@]} -eq 0 ]; then
  exit 0
fi

# Changed-file scope: jscpd and override-guard on the changed files only.
"$DIR/dup.sh" "${changed[@]}" || exit 2
"$DIR/override-guard.sh" "${changed[@]}" || exit 2
# Project-wide: knip and deps.
"$DIR/knip.sh" || exit 2
"$DIR/deps.sh" || exit 2
exit 0
