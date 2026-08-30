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
exit 0
