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

# Session changed files: tracked changes + untracked. NUL-delimited because git
# quotes a name holding a `"`, `\` or control character even with core.quotePath
# off, and a quoted name fails the `-f` test below.
# (Portable form of `mapfile -t`: the macOS system bash is 3.2 and has no
# mapfile/readarray builtin.)
touched=()
while IFS= read -r -d '' f; do
  touched+=("$f")
done < <(
  { git diff --name-only -z HEAD
    git ls-files -z --others --exclude-standard
  } | sort -zu
)

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
harness_input_pattern='^(rules/.*\.ya?ml|rules/fixtures/.*|scripts/checks/.*|ios/Kiko/Info\.plist|ios/Kiko\.xcodeproj/project\.pbxproj|ios/Kiko/[a-z]+\.lproj/InfoPlist\.strings|ios/Kiko/PrivacyInfo\.xcprivacy|drizzle/migrations/.*)$'

# App source drives the changed-file-scoped checks (jscpd, override-guard).
changed=()
harness_changed=()
for f in "${touched[@]+"${touched[@]}"}"; do
  if [[ "$f" =~ \.(ts|tsx|js)$ ]] && ! [[ "$f" =~ ^(ios/|node_modules/) ]]; then
    changed+=("$f")
  fi
  if [[ "$f" =~ $harness_input_pattern ]]; then
    harness_changed+=("$f")
  fi
done

# One list, `changed`, must keep a deleted path: it is the trigger (a deletion can break an
# import, so knip and tsc must still run). The existence test is therefore applied afterwards,
# to build `present`, the list handed to the wrappers that read file contents.
present=()
for f in "${changed[@]+"${changed[@]}"}"; do
  [ -f "$f" ] && present+=("$f")
done

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

# The doc-reading jest suites run whenever the doc fingerprint differs from the one a pass
# recorded: a fingerprint of the doc files and suites as they are on disk, so it needs no diff and
# no replay mark. A mark or a diff each lose a case: a by-hand replay moves the mark past a
# committed doc edit, a worktree with no mark has no baseline, and a diff folds a file moved out
# of a doc root into its new path alone. The cost is one run per fresh worktree or purged state
# dir. It is empty when the project holds no doc file and no suite, so nothing is pending there.
# The state key uses the physical root so `make doc-suites` writes the same one.
doc_root="$(pwd -P)"
doc_fingerprint="$(harness_doc_fingerprint "$doc_root")"
doc_pending=0
if [ -n "$doc_fingerprint" ] && ! harness_unchanged "$doc_root" "doc-suites" "$doc_fingerprint"; then
  doc_pending=1
fi

# Nothing relevant changed (the coordinator case): stay silent.
if [ ${#changed[@]} -eq 0 ] && [ ${#harness_changed[@]} -eq 0 ] && [ "$doc_pending" -eq 0 ] \
  && [ "$replay_pending" -eq 0 ]; then
  exit 0
fi

# A Stop that fires again after the hook already blocked it (the payload's stop_hook_active is
# true) would, on an unchanged tree, run the same checks and block again, a loop the session
# cannot leave: knip alone can fail it on a file the session is not allowed to touch. Claude Code
# sets stop_hook_active on every Stop that follows a block in the same turn, whether or not the
# tree changed since, so the skip cannot tell an unchanged tree from an edited one: it holds for
# both, and an agent that edits after a block runs check:all itself. The first Stop already
# showed every failure, so a repeated one is let through with a note. Only the Stop event skips:
# SubagentStop keeps blocking. The payload is read only when stdin is a regular file, which is
# how dispatch.sh replays it: a pipe or a terminal a caller never closes would hang this read.
# Anything unreadable leaves the tier running, as before.
repeated_stop="$(node -e '
  const fs = require("node:fs");
  try {
    if (fs.fstatSync(0).isFile()) {
      const payload = JSON.parse(fs.readFileSync(0, "utf8"));
      if (payload.hook_event_name === "Stop" && payload.stop_hook_active === true) {
        process.stdout.write("repeated");
      }
    }
  } catch {}
' 2>/dev/null)"
if [ "$repeated_stop" = "repeated" ]; then
  echo "medium tier: skipped on a repeated Stop (stop_hook_active); run npm run check:all before you commit" >&2
  exit 0
fi

# Both Stop and SubagentStop call this wrapper, so one subagent-driven
# session runs the medium tier one time per finished subagent, plus one
# more time for the coordinator, and parallel subagents fire near-together.
# Serialize the tier per worktree so those runs do not launch concurrent
# knip/deps/jscpd on the same tree. Most sub-checks below skip on their own
# when their inputs are unchanged; dup.sh's large-file pass never skips (it
# lists files with jscpd twice, about 1 s per Stop that runs dup.sh (a
# non-empty present list), more for a changed file over 1000 lines). On a lock timeout, proceed
# unlocked rather than hang the hook.
state="$(harness_state_dir "$ROOT")"
mkdir -p "$state" 2>/dev/null || true
lock="$state/medium.lock"
if harness_lock "$lock" 240; then
  trap 'harness_unlock "$lock"' EXIT
fi

# Changed-file scope: jscpd and override-guard on the changed source files only.
# Guarded because `"${present[@]}"` on an empty array is an unbound-variable
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
# The doc-reading jest suites, when the doc fingerprint computed above differs from the recorded
# pass. They no longer depend on the replay mark, so their order against the replay is free;
# the step stays before it. The jest run stops at its own deadline, well inside the 300 s hook
# kill, and fails closed: a killed hook ends the turn with no error and no check.
# KIKO_DOC_SUITES_DEADLINE_SECONDS exists for the tests and only lowers the budget.
# Rechecked here, under the lock: another Stop may have run the same suites and recorded its pass
# while this one waited, and running them again (or stopping at the deadline for docs that just
# passed) would repeat that work. The early exit above keeps the pre-lock value.
if [ "$doc_pending" -eq 1 ] && ! harness_unchanged "$doc_root" "doc-suites" "$doc_fingerprint"; then
  doc_suites=()
  while IFS= read -r f; do
    doc_suites+=("$f")
  done < <(harness_doc_suites "$ROOT")
  doc_jest="$ROOT/node_modules/.bin/jest"
  # The replay's own constants, so the doc step leaves the guard call tail and the checks after
  # it (which have no deadline) the same reserve the replay sizes its deadline with.
  doc_budget="$(node "$DIR/guard-replay.js" step-budget 2>/dev/null)"
  case "$doc_budget" in
    '' | *[!0-9]*) doc_budget="" ;;
  esac
  case "${KIKO_DOC_SUITES_DEADLINE_SECONDS:-}" in
    '' | *[!0-9]*) ;;
    *) [ "$KIKO_DOC_SUITES_DEADLINE_SECONDS" -lt "${doc_budget:-0}" ] \
      && doc_budget="$KIKO_DOC_SUITES_DEADLINE_SECONDS" ;;
  esac
  doc_why="A skill, agent, docs or CLAUDE.md edit can drift from the code these suites pin, and only a run shows it."
  doc_donot="Do not edit a suite or its pin to get past this, and do not skip the Stop tier."
  if [ ${#doc_suites[@]} -eq 0 ] || [ ! -x "$doc_jest" ] || [ -z "$doc_budget" ]; then
    print_block \
      "Doc-reading jest suites" \
      "The doc-reading suites could not be run." \
      "Suites found: ${#doc_suites[@]}. Jest binary: $doc_jest. Budget: ${doc_budget:-unreadable} s." \
      "$doc_why" \
      "Run: npm install, then make doc-suites. If no suite is found, the discovery in harness_doc_suites (scripts/checks/_lib.sh) broke; if the budget is unreadable, run node scripts/checks/guard-replay.js step-budget and fix what it prints." \
      "$doc_donot"
    exit 2
  fi
  doc_output="$state/doc-suites.out"
  # Two workers, so a Stop-tier run leaves cores to the other sessions and to the checks that
  # run after it.
  "$doc_jest" --maxWorkers=2 "${doc_suites[@]}" > "$doc_output" 2>&1 &
  doc_pid=$!
  doc_timed_out=0
  while kill -0 "$doc_pid" 2>/dev/null; do
    if [ "$(date +%s)" -ge $((hookStarted + doc_budget)) ]; then
      doc_timed_out=1
      break
    fi
    sleep 0.2
  done
  if [ "$doc_timed_out" -eq 1 ]; then
    # Only the pid this wrapper started; escalate when jest ignores the first signal.
    kill "$doc_pid" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$doc_pid" 2>/dev/null || break
      sleep 0.5
    done
    kill -0 "$doc_pid" 2>/dev/null && kill -KILL "$doc_pid" 2>/dev/null
  fi
  wait "$doc_pid" 2>/dev/null
  doc_code=$?
  if [ "$doc_timed_out" -eq 1 ]; then
    print_block \
      "Doc-reading jest suites" \
      "The suites stopped at the Stop-tier deadline before they finished." \
      "Stopped $doc_budget s after the hook started. Last output: $(tail -n 20 "$doc_output")" \
      "The Stop hook is killed at 300 s, and a killed hook ends the turn with no error and no check. Failing at the deadline keeps the unchecked docs visible." \
      "The suites need more time than a Stop allows: run make doc-suites by hand (no deadline; its pass is recorded, so the next Stop skips the same docs), then fix anything it reports." \
      "$doc_donot"
    exit 2
  fi
  if [ "$doc_code" -ne 0 ]; then
    print_block \
      "Doc-reading jest suites" \
      "A suite that reads skill, agent, docs or CLAUDE.md text failed." \
      "$(tail -n 60 "$doc_output")" \
      "$doc_why" \
      "Fix the text (or the code it describes) the failing test names, then re-run: make doc-suites" \
      "$doc_donot"
    exit 2
  fi
  harness_mark_pass "$doc_root" "doc-suites" "$doc_fingerprint"
fi
# Session-change scope: the pre-write guard, replayed on every .ts/.tsx file
# the session changed, whatever wrote it (guard-replay.js computes its own
# set), with the Stop-tier deadline.
"$DIR/guard-replay.sh" --stop-tier "$hookStarted" || exit 2
# Only HEAD moved (a commit, no file change): the replay, the shipped-migrations check and
# the doc step were the checks due.
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
