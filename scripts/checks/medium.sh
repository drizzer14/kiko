#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
cd "$ROOT"

# Session changed files: tracked changes + untracked.
# (Portable form of `mapfile -t`: the macOS system bash is 3.2 and has no
# mapfile/readarray builtin.)
touched="$(
  { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u
)"

# App source drives the changed-file-scoped checks (jscpd, override-guard).
changed=()
while IFS= read -r f; do
  [ -n "$f" ] && changed+=("$f")
done < <(
  printf '%s\n' "$touched" \
    | grep -E '\.(ts|tsx|js)$' \
    | grep -vE '^(ios/|node_modules/)'
)

# Harness inputs: the Semgrep rule file, its fixtures, the check wrappers, and
# every file plist.sh asserts on (both Info.plists and the Xcode project, which
# carries the Debug-only ATS injection phase). Editing one of the first three
# changes what the checks themselves prove, so a session that touched only a
# rule, a fixture, or a wrapper must not be silent — that is precisely the
# session most likely to have broken a rule. The plist.sh inputs are the
# surfaces its assertions (pinned credential hosts, Release ATS hardening)
# exist to guard, so a session that edited only one of those must not be silent
# either.
harness_changed=()
while IFS= read -r f; do
  [ -n "$f" ] && harness_changed+=("$f")
done < <(
  printf '%s\n' "$touched" \
    | grep -E '^(rules/.*\.ya?ml|rules/fixtures/.*|scripts/checks/.*|ios/Kiko/Info\.plist|ios/KikoWidget/Info\.plist|ios/Kiko\.xcodeproj/project\.pbxproj)$'
)

# Nothing relevant changed (the coordinator case): stay silent.
if [ ${#changed[@]} -eq 0 ] && [ ${#harness_changed[@]} -eq 0 ]; then
  exit 0
fi

# Changed-file scope: jscpd and override-guard on the changed source files only.
# Guarded because `"${changed[@]}"` on an empty array is an unbound-variable
# error under `set -u` in bash 3.2.
if [ ${#changed[@]} -gt 0 ]; then
  "$DIR/dup.sh" "${changed[@]}" || exit 2
  "$DIR/override-guard.sh" "${changed[@]}" || exit 2
fi
# Project-wide: knip, deps, and the Semgrep rule fixtures.
"$DIR/knip.sh" || exit 2
"$DIR/deps.sh" || exit 2
"$DIR/semgrep-rules.sh" || exit 2
"$DIR/plist.sh" || exit 2
exit 0
