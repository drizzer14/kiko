#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
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
    | grep -E '^(rules/.*\.ya?ml|rules/fixtures/.*|scripts/checks/.*|ios/Kiko/Info\.plist|ios/Kiko\.xcodeproj/project\.pbxproj)$'
)

# Nothing relevant changed (the coordinator case): stay silent.
if [ ${#changed[@]} -eq 0 ] && [ ${#harness_changed[@]} -eq 0 ]; then
  exit 0
fi

# Both Stop and SubagentStop call this wrapper, so one subagent-driven
# session runs the medium tier one time per finished subagent, plus one
# more time for the coordinator, and parallel subagents fire near-together.
# Serialize the tier per worktree so those runs do not launch concurrent
# knip/deps/jscpd on the same tree. Each sub-check below skips on its own
# when its inputs are unchanged, so a repeat run with no change is
# near-instant. On a lock timeout, proceed unlocked rather than hang the hook.
state="$(harness_state_dir "$ROOT")"
mkdir -p "$state" 2>/dev/null || true
lock="$state/medium.lock"
if harness_lock "$lock" 240; then
  trap 'harness_unlock "$lock"' EXIT
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
"$DIR/typecheck.sh" || exit 2
exit 0
