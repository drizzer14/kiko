#!/usr/bin/env bash
set -uo pipefail
# The Stop hook's timeout counts from here, lock wait included; the guard
# replay sizes its deadline from what is left.
hookStarted="$(date +%s)"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
cd "$ROOT"

# Session changed files: tracked changes + untracked.
# (Portable form of `mapfile -t`: the macOS system bash is 3.2 and has no
# mapfile/readarray builtin.)
touched="$(
  { git -c core.quotePath=false diff --name-only HEAD
    git -c core.quotePath=false ls-files --others --exclude-standard
  } | sort -u
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

# The subset still on disk. `git diff --name-only HEAD` lists a deleted file, and
# jscpd fails on a path it cannot lstat (ENOENT), which dup.sh reported as duplicated
# code. `changed` keeps the deleted path: it decides whether the session is silent, and
# a deleted file can break an import elsewhere, so knip and tsc must still run. An
# existence test, not `--diff-filter=d`, because it also covers a path git lists after
# the file was removed by hand, and a rename under any diff.renames setting (a rename
# with detection off lists the old path as deleted); the guard replay plans its own
# file set from git history and does not read this list.
present=()
for f in "${changed[@]+"${changed[@]}"}"; do
  [ -f "$f" ] && present+=("$f")
done

# Harness inputs: the Semgrep rule file, its fixtures, the check wrappers, and
# every iOS file plist.sh asserts on (the Info.plist, the localized
# InfoPlist.strings name tables, the privacy manifest, and the Xcode project,
# which carries the Debug-only ATS injection phase and the Resources wiring).
# Editing one of the first three changes what the checks themselves prove, so a
# session that touched only a rule, a fixture, or a wrapper must not be silent —
# that is precisely the session most likely to have broken a rule. The plist.sh
# inputs are the surfaces its assertions (pinned credential hosts, Release ATS
# hardening, the localized home-screen name, the required-reason API entry)
# exist to guard, so a session that edited only one of those must not be silent
# either. Every file under drizzle/migrations/ is an input too: a shipped
# migration's .sql, snapshot or journal is guarded by shipped-migrations.sh, and
# the pre-write guard never sees a .sql edit, so a session that touched only
# one must not be silent.
harness_changed=()
while IFS= read -r f; do
  [ -n "$f" ] && harness_changed+=("$f")
done < <(
  printf '%s\n' "$touched" \
    | grep -E '^(rules/.*\.ya?ml|rules/fixtures/.*|scripts/checks/.*|ios/Kiko/Info\.plist|ios/Kiko\.xcodeproj/project\.pbxproj|ios/Kiko/[a-z]+\.lproj/InfoPlist\.strings|ios/Kiko/PrivacyInfo\.xcprivacy|drizzle/migrations/.*)$'
)

# The guard replay also checks commits made in this worktree, so a turn that
# only committed (a clean tree) must still run it: it is pending while HEAD
# is not where this worktree's mark ref recorded the last pass. A pass never
# moves the mark back, so after a reset back every Stop re-runs the replay
# until the next commit moves HEAD forward to a new mark.
replay_pending=1
recorded="$(git rev-parse -q --verify "$(harness_replay_ref "$ROOT")" 2>/dev/null)"
if [ "$recorded" = "$(harness_replay_mark "$ROOT")" ]; then
  replay_pending=0
fi

# Nothing relevant changed (the coordinator case): stay silent.
if [ ${#changed[@]} -eq 0 ] && [ ${#harness_changed[@]} -eq 0 ] && [ "$replay_pending" -eq 0 ]; then
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
if [ ${#present[@]} -gt 0 ]; then
  "$DIR/dup.sh" "${present[@]}" || exit 2
  "$DIR/override-guard.sh" "${present[@]}" || exit 2
fi
# Compares the working tree with the shipped baseline, so it also catches a
# commit that edited a shipped migration; it runs before the early exit below
# for the same reason the replay does. It must run BEFORE the replay: a passing
# replay moves this worktree's mark ref to HEAD, and a failure after that would
# leave the next Stop a clean tree with no pending replay, which exits early and
# hides the committed violation. Failing first leaves the mark where it was, so
# every later Stop fails again until the migration is restored.
"$DIR/shipped-migrations.sh" || exit 2
# Session-change scope: the pre-write guard, replayed on every .ts/.tsx file
# the session changed, whatever wrote it (guard-replay.js computes its own
# set), with the Stop-tier deadline.
"$DIR/guard-replay.sh" --stop-tier "$hookStarted" || exit 2
# Only HEAD moved (a commit, no file change): the replay and the shipped-migrations
# check were the checks due.
if [ ${#changed[@]} -eq 0 ] && [ ${#harness_changed[@]} -eq 0 ]; then
  exit 0
fi
# Project-wide: knip, deps, and the Semgrep rule fixtures.
"$DIR/knip.sh" || exit 2
"$DIR/deps.sh" || exit 2
"$DIR/semgrep-rules.sh" || exit 2
"$DIR/plist.sh" || exit 2
"$DIR/typecheck.sh" || exit 2
exit 0
