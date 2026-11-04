#!/usr/bin/env bash
# One queue for every heavy job (make verify, check:all, check:security, the mutation gate) across
# all worktrees: one job runs at a time, the shortest class first, and nothing runs on battery.
#
# Usage (run it with run_in_background and wait on its exit code):
#   job-queue.sh verify <worktree> <label> [--sha <commit>] [--scoped]
#   job-queue.sh check-all|security <worktree> <label>
#   job-queue.sh harness-verify <harness worktree> <label>
#   job-queue.sh gate <worktree> <label> <mutation-base> <expected-head> [--long]
#   job-queue.sh hold <reason>    stop every start until `release`; running jobs are not stopped
#                                 (one holding the lock when `hold` returns is named on stdout)
#   job-queue.sh release
#   job-queue.sh status           the hold, the power state, the running job, the queued tickets
# A label holds only letters, digits, dot, underscore, and dash.
#
# State lives in ${KIKO_QUEUE_DIR:-$HOME/.claude/kiko-queue}, outside every worktree:
#   tickets/   one file per waiting job, named <class>-<size>-<epoch>-<pid>-<label>
#   lock       a symlink whose target text is the owner record `<waiter pid> <job group or -> <kind>
#              <label> <worktree>`; a symlink is made in one atomic call, so the lock never exists
#              without its owner
#   claim      a symlink whose target text is a pid; held for the milliseconds that check, remove,
#              and create the lock, so two waiters never remove each other's fresh lock
#   hold       present while held; its text is the reason. `hold` writes it, then reads the lock; a
#              waiter takes the lock, then looks for the file and gives the lock back if it is
#              there. So a start that began before the file existed either backs off or is the
#              `running:` line `hold` prints; the start that line names may still back off.
#   logs/      gate-<label>.log, the whole output of a gate, and verify-<label>.log, a verify's
#              summary lines (jest counts, FAIL, stage markers, CHECK FAILED) from the whole run
#              followed by its last VERIFY_LOG_LINES lines, also after INT or TERM. At the end a
#              verify prints the summary lines, `log: <path>`, and its last VERIFY_TAIL_LINES
#              lines; the other jobs print to stdout
#   done.log   one line per finished job: kind label exit start end head, and a 7th field, scope,
#              on a `verify` line only (every other kind keeps 6 fields). Every reader uses `$6`
#              and `NF >= 6`. head is the full 40-character HEAD the job tested, read only while
#              `git status --porcelain` (untracked files included) is empty and HEAD has not moved:
#              - a verify with a sha (below) tests the commit named at enqueue, in the shared
#                checkout, so its head is that sha when the checkout is clean and at that sha at
#                the end, else `unknown` and a NOTE names the first changed path;
#              - a gate, check-all, security, and a verify of a folder with no readable HEAD read
#                the worktree itself, at START and again at the end: `unknown` for a changed tree at
#                either point, a moved HEAD, or an unreadable repository. A gate never starts on a
#                changed tree (exit 3, at enqueue and again at START); check-all and security still
#                run on one and record `unknown`.
#              Known limit: an edit made and reverted while the job runs, or a change to an ignored
#              file, leaves the head set (no content hash). A line from before this field has five
#              fields.
#              scope is `full` when the verify log holds a line beginning
#              `── make verify: stage 2b (` and none beginning `── make verify: stage 2b SKIPPED`,
#              else `partial` (a run with no header is `partial`: positive proof only).
#              scripts/ff-main.sh refuses a line whose 7th field exists and is not `full`; a
#              6-field line counts as full. QUEUE_FORMAT stays 1, because the field is additive.
#              A job whose result was never recorded leaves a LOST line in the same six-field order,
#              so its loss is visible (the lock form may follow a job that ran fully, its waiter
#              having died while it held the lock): a waiter that pruned a ticket whose waiter pid
#              was dead writes `lost <label> <waiter pid> <queued time from the ticket epoch> <now>
#              unknown`; a waiter that reclaimed a lock that was not live writes `<kind> <label>
#              lost <now> <now> unknown` from the owner record. Each is written only by the process
#              whose atomic `mv` of the ticket or lock won, so two waiters never write it twice.
#              Neither form is a `verify` line with exit 0, so scripts/ff-main.sh never counts one.
#              `status` and scripts/ff-main.sh print WARNINGs for lines with fewer than 6 fields:
#              the ones before the first 6-field line in ONE summary (count and the last such
#              line), each one after it on its own with its line number. All are ignored.
#              scripts/ff-main.sh reads it.
#   format     the queue format stamp, an integer: QUEUE_FORMAT below. A job command writes it when
#              it is missing or lower, and exits 2 when it is higher, because a copy of this script
#              older than the one that wrote the queue directory would misread its state.
#
# harness-verify runs the harness's own checks in a harness worktree (an absolute path, the git top
# level of its repository, holding package.json, and not a pff-ios worktree): `npm test`, then
# `npm run check:all` only when it passes. It is class 1 and takes the same lock as verify. Its
# done.log line has the kind `harness-verify`, so scripts/ff-main.sh (which matches `verify`
# exactly) never counts it, and it prints no old-copy WARNING.
#
# verify runs in one shared checkout, a detached linked worktree at <parent of the main
# checkout>/<main checkout name>-verify, so the track goes on with its next task while it waits and
# runs. The commit is named once, at enqueue: --sha <commit> (a commit of the repository; the
# worktree may be dirty or moved), else the worktree HEAD, and a dirty worktree is then refused
# with exit 3 (it catches a forgotten commit). Nothing reads the worktree after enqueue, and there
# is no dirty check at START. At START scripts/verify-checkout.sh <main checkout> <checkout> <sha>
# prepares the checkout inside the job's process group, its output in the verify log: it moves the
# checkout to the sha, cleans it, and runs `npm ci` when the install stamp differs. A failure is the
# job's exit 2, and make does not run. Then `make -C <checkout> verify` runs, so the verify.sh and
# Makefile of the sha itself apply. --scoped sets KIKO_VERIFY_SCOPED=1 for that make (verify.sh may
# then skip stage 2b); without the flag the queue removes the variable, so an inherited value
# cannot skip 2b. Both options take either order, once each.
# A folder with no readable HEAD and no --sha keeps the in-place run, `make -C <folder> verify`:
# a folder that is no repository (the real queue refuses it) or an unborn-HEAD worktree of this
# repository, which the real queue accepts. A --sha there is accepted when it names a commit, and
# the verify then runs in the shared checkout. The pruning of the shared checkout costs one
# `npm ci`.
# verify-checkout.sh and wait-load.sh are read from SUPPORT_DIRECTORY, fixed at enqueue: the main
# checkout's scripts folder when it holds verify-checkout.sh, else this script's own folder. This
# script itself still runs from the folder it was started in, so an edit of this file there while
# a verify waits can disturb that waiter.
#
# Old copy: a job command prints one WARNING on stderr when the running script differs from
# <worktree>/scripts/job-queue.sh (the job still runs): a copy kept outside the worktree misses the
# fixes made there since.
#
# Order is a plain `sort` of the ticket names. Class 1 is verify, check-all, security, and
# harness-verify (size 0, first come first served); class 2 is a gate, class 3 a gate with --long.
# A gate's size is the `changed lines:` figure of
# `KIKO_MUTATION_BASE=<base> scripts/checks/mutation.sh --list` in its worktree, read when it is
# queued, so a short gate runs before a long one. A change set above the file cap is refused
# (exit 2), and so is a tip whose mutation.sh has no changed-line gate (it would ignore --list and
# run a whole Stryker outside the lock): merge main into it first. A gate whose worktree HEAD does
# not start with <expected-head> is refused at once (exit 3), and again when its turn comes.
#
# The first ticket in order starts once no hold exists, the power state is known and is not
# battery, and the lock is free. A gate then removes the stale Stryker state and runs `make deep`
# under caffeinate. Each job starts in a process group of its own (the group id is the job's pid),
# and the owner record names it. A lock is live while its waiter pid is alive OR its job group has
# a member, so a waiter that dies leaves the lock held until the job's whole tree has ended. A
# waiter removes a ticket whose pid is gone, and the head waiter a lock that is not live (a record
# naming no live pid, or no pid at all, is not live). A job's own end waits the same way: the lock
# is removed once the group is empty, and a DRAIN line says a process of the job still runs.
#
# Start load defer: a job of every class (verify, check-all, security, gate) at the head also waits
# while the 5-minute load is at or above 10. The check runs once per poll, only while no hold or
# power reason stops the start and no live job holds the lock, as one read of `wait-load.sh 10 0`.
# A high load prints one `WAITING <label>: load ...` line and keeps the job queued, at most 1200
# seconds counted from the first such read; the count starts over if the job loses the head, a job
# takes the lock, or a hold or power reason stops the start, so a job released from a pause gets
# its full wait. Then `LOAD WAIT EXPIRED <label>: load <x>` is printed once and the job starts
# anyway. A gate's first mutants time out on load drift between its dry run and its run, and a
# verify's tools time out under a loaded machine; a quiet start lowers both. A hold or a battery or
# unknown power state keeps its own WAITING reason and reads no load. A load that cannot be read
# prints one `NOTE <label>: load unknown, ...` line and does not defer. The wait ends on SIGINT and
# SIGTERM like any other wait, because it polls with pause.
#
# Group signal: on SIGINT or SIGTERM the queue sends TERM to the process
# group it created for its own job (`kill -s TERM -- -<group>`), and to no other group: the group
# comes from this process's own memory, never from the lock file, and never from a name or a
# pattern. It then waits for the group to empty, polling every KIKO_QUEUE_POLL_SECONDS, at most
# KIKO_QUEUE_STOP_POLLS times; a group that does not empty leaves the lock in place and the queue
# exits anyway. A second signal during that wait exits at once. The group gets the TERM only when
# pgrep exits 0 (members found); a pgrep that cannot tell (exit 2 or 3) signals no group, and only
# the job's own pid gets the TERM, while the lock stays held as for any unknown group. A signal that
# lands while the job is being forked is kept and acted on once its group is known. SIGKILL cannot
# be trapped: a waiter killed with it leaves its job running, so never SIGKILL one (the lock is
# live by group only once the group is named; see Known limits).
#
# START line: `START <label> at HH:MM head <12-character sha of the worktree HEAD (of the enqueue
# sha for a verify with a sha), or unknown> (load: <averages>)`, so a log says which commit a job
# ran on.
#
# DONE summary of a gate (printed before the DONE line): the last five of the `changed lines`,
# `CHANGE SET`, `GATE:`, and `CHECK FAILED` lines of the gate log, never a `FIRST RUN: ` line (the
# score of the first run that a rerun replaced), then each distinct `TIMEOUT-HEAVY `, `REPORT SCOPE
# MISMATCH`, `RERUN `, and `RERUN SKIPPED` line at the start of a log line, once although the
# failure block repeats it.
#
# Real queue: when the queue directory is the default $HOME/.claude/kiko-queue (KIKO_QUEUE_DIR unset
# or naming it), a verify, gate, or check-all of a worktree that does not share the git common
# directory of this script's own checkout is refused at once (exit 3, nothing written): ff-main.sh
# trusts the verify lines of that done.log, so a scratch repository must not write one. A script
# outside any repository cannot name its own, so it is refused too. harness-verify (another
# repository by design) and security are not checked. Tests and scratch runs set KIKO_QUEUE_DIR.
#
# Exit codes: the job's own code (2 also covers a refused request); 3 a gate whose HEAD moved, a
# tree with changes, or a foreign repository on the real queue; 130 after SIGINT; 143 after SIGTERM.
#
# Known limits: the group check is a liveness test only. A pid reused by an unrelated process makes
# a dead owner read as alive, so a lock can stall, never run two jobs at once. A claim whose holder
# was SIGKILLed is removed by a check-then-remove, so two waiters meeting a dead claim at the same
# instant can both pass it. A waiter SIGKILLed between the fork of its job and the rename that names
# the job group in the lock leaves a lock that still reads `<dead pid> -`: it names no group, so
# the next waiter reclaims it while the job still runs, and two jobs run at once.
#
# Power: only a first pmset line naming AC Power reads as AC and one naming Battery Power as
# battery; any other first line, no output, or a failing pmset holds with "power state unknown".
#
# Test seams: KIKO_QUEUE_DIR, KIKO_QUEUE_POLL_SECONDS (default 30), KIKO_QUEUE_STOP_POLLS
# (default 20), KIKO_QUEUE_PMSET and KIKO_QUEUE_CAFFEINATE (the binary to run instead of pmset and
# caffeinate; a missing pmset means AC power, a missing caffeinate means none), and
# KIKO_QUEUE_FORK_HOOK (a test-only program, empty in production, run with the queue's pid between
# the fork of a job and the read of its pid), and KIKO_QUEUE_GATE_LOAD_WAIT_SECONDS (the longest a
# job of any class waits for the load, default 1200; the name says gate and covers every class; a
# value that is not a whole number is refused for a job command, exit 2).
set -uo pipefail

# Raise it when this script changes how it reads or writes the queue directory, so an older copy
# refuses instead of misreading.
QUEUE_FORMAT=1
QUEUE_DIRECTORY="${KIKO_QUEUE_DIR:-$HOME/.claude/kiko-queue}"
TICKETS_DIRECTORY="$QUEUE_DIRECTORY/tickets"
LOCK_PATH="$QUEUE_DIRECTORY/lock"
CLAIM_PATH="$QUEUE_DIRECTORY/claim"
POLL_SECONDS="${KIKO_QUEUE_POLL_SECONDS:-30}"
STOP_POLLS="${KIKO_QUEUE_STOP_POLLS:-20}"
SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Where wait-load.sh, and a verify's verify-checkout.sh, are read at the job's start. The queuing
# script's own folder is usually a track worktree, which can be removed or edited while the job
# waits, so a verify names the main checkout's scripts folder at enqueue when that holds
# verify-checkout.sh (resolve_verify_commit). Only when the main checkout lacks it does the
# queuing folder stay the source, and that copy can still be removed or edited while the job waits.
SUPPORT_DIRECTORY="$SCRIPT_DIRECTORY"
# A job at the head waits while the 5-minute load is at or above GATE_START_MAX_LOAD, at most
# GATE_START_MAX_WAIT seconds. The two values are a fixed policy, not a tuning knob.
GATE_START_MAX_LOAD=10
GATE_START_MAX_WAIT="${KIKO_QUEUE_GATE_LOAD_WAIT_SECONDS:-1200}"
# A verify keeps the end of its output, where the failure block is: a long jest run would otherwise
# leave a large file per label.
VERIFY_LOG_LINES=400
VERIFY_TAIL_LINES=40
# The jest counts, the failing suites, verify.sh's stage markers (`── make verify: stage`,
# `✖ make verify FAILED`, `✔ make verify:`, and the `stage 2b SKIPPED` and `stage 2b runs in full`
# lines), and a failure block header, from the whole log. The scope field of done.log reads the
# `stage 2b (` header and the SKIPPED line from the log itself, not from this summary.
VERIFY_SUMMARY_PATTERN='^(Tests|Test Suites):|^FAIL |^[^[:alnum:]]+ make verify[ :]|CHECK FAILED'
VERIFY_SUMMARY_LINES=100

usage() {
  [ "$#" -eq 0 ] || printf '%s\n' "$1" >&2
  cat >&2 <<'USAGE'
usage: job-queue.sh verify <worktree> <label> [--sha <commit>] [--scoped]
       job-queue.sh check-all|security <worktree> <label>
       job-queue.sh harness-verify <harness worktree> <label>
       job-queue.sh gate <worktree> <label> <mutation-base> <expected-head> [--long]
       job-queue.sh hold <reason>
       job-queue.sh release
       job-queue.sh status
USAGE
  exit 2
}

refuse() {
  printf 'job-queue.sh: %s\n' "$1" >&2
  exit 2
}

HOLD_FILE="$QUEUE_DIRECTORY/hold"
DONE_LOG="$QUEUE_DIRECTORY/done.log"

ticket_names() { ls "$TICKETS_DIRECTORY" 2>/dev/null | LC_ALL=C sort; }

# A positive pid that is alive.
pid_is_alive() {
  case "$1" in
    '' | *[!0-9]* | 0*) return 1 ;;
  esac
  kill -0 "$1" 2> /dev/null
}

# pgrep's own answer for a process group: 0 when it found a member, 1 when it found none, any
# other code when it could not tell. A group id that is not a positive number has no member.
scan_group() {
  case "$1" in
    '' | *[!0-9]* | 0*) return 1 ;;
  esac
  pgrep -g "$1" > /dev/null 2>&1
}

# Whether a lock may be kept: a pgrep that could not tell counts as a member, so a failing pgrep
# never frees a lock.
group_has_members() {
  scan_group "$1"
  [ "$?" -ne 1 ]
}

# Why the power state stops a start; nothing for AC power or a machine without pmset. Only a first
# line naming AC Power reads as AC. A pmset that is present but fails, prints nothing, or opens
# with any other line (a warning, UPS Power) says nothing sure about the power source, so it stops
# the start too: battery must never read as AC.
power_reason() {
  local pmset_binary="${KIKO_QUEUE_PMSET:-pmset}" power first_line
  command -v "$pmset_binary" > /dev/null 2>&1 || return 0
  power="$("$pmset_binary" -g batt 2> /dev/null)" || {
    printf 'power state unknown'
    return 0
  }
  first_line="$(printf '%s\n' "$power" | sed -n '1p')"
  case "$first_line" in
    *'AC Power'*) ;;
    *'Battery Power'*) printf 'battery power' ;;
    *) printf 'power state unknown' ;;
  esac
}

# Why no job may start now; empty when one may.
blocked_reason() {
  if [ -f "$HOLD_FILE" ]; then
    printf 'hold (%s)' "$(head -1 "$HOLD_FILE")"
  else
    power_reason
  fi
}

# A line from before the head field, or a torn one, has fewer than 6 fields and is ignored by every
# reader; the warning keeps that from being silent. The short lines before the first 6-field line
# (the old block of a log that predates the head field) fold into one summary WARNING, so that
# block cannot bury a later torn line; each short line after it keeps its own WARNING.
warn_short_done_lines() {
  awk '
    function flush_leading() {
      if (leading > 0) printf "WARNING: %d done.log line(s) with fewer than 6 fields before the first 6-field line (ignored); the last: %s\n", leading, last_leading
      leading = 0
    }
    NF >= 6 { flush_leading(); seen = 1; next }
    NF > 0 && seen { print "WARNING: done.log line " NR " has fewer than 6 fields (ignored): " $0; next }
    NF > 0 { leading++; last_leading = $0 }
    END { flush_leading() }
  ' "$DONE_LOG" 2> /dev/null
}

queue_status() {
  local busy=0 ticket power tickets
  if [ -f "$HOLD_FILE" ]; then
    printf 'hold: %s\n' "$(head -1 "$HOLD_FILE")"
  fi
  power="$(power_reason)"
  if [ -n "$power" ]; then
    printf '%s: no job starts\n' "$power"
  fi
  # The tickets are read before the lock: a waiter removes its ticket only after it holds the lock,
  # so a job that moves from queued to running between the two reads shows as running, never as
  # neither.
  tickets="$(ticket_names)"
  if [ -L "$LOCK_PATH" ]; then
    busy=1
    printf 'running: %s\n' "$(readlink "$LOCK_PATH")"
  fi
  for ticket in $tickets; do
    busy=1
    printf 'queued: %s\n' "$ticket"
  done
  [ "$busy" -eq 1 ] || printf 'queue empty\n'
  warn_short_done_lines
}

valid_label() {
  case "$1" in
    '' | *[!A-Za-z0-9._-]*) return 1 ;;
  esac
}

valid_head() {
  case "$1" in
    *[!0-9a-f]*) return 1 ;;
  esac
  [ "${#1}" -ge 7 ]
}

[ "$#" -ge 1 ] || usage
command_name="$1"
mutation_base=''
expected_head=''
job_class=1
job_size=0
scoped=0
requested_sha=''

# `[--sha <commit>] [--scoped]` of a verify, in either order; a repeat, an unknown word, or a --sha
# with no value is a usage error.
parse_verify_options() {
  local sha_given=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --scoped)
        [ "$scoped" -eq 0 ] || usage "--scoped given twice"
        scoped=1
        ;;
      --sha)
        [ "$sha_given" -eq 0 ] || usage "--sha given twice"
        [ "$#" -ge 2 ] && [ -n "$2" ] || usage "--sha needs a commit"
        requested_sha="$2"
        sha_given=1
        shift
        ;;
      *) usage "unknown option: $1" ;;
    esac
    shift
  done
}

case "$command_name" in
  status)
    [ "$#" -eq 1 ] || usage
    queue_status
    exit 0
    ;;
  hold)
    [ "$#" -ge 2 ] || usage
    shift
    mkdir -p "$QUEUE_DIRECTORY"
    printf '%s\n' "$*" > "$HOLD_FILE"
    # Read after the write: a start that took the lock before the file existed is named here.
    if [ -L "$LOCK_PATH" ]; then
      printf 'running: %s (a hold does not stop a running job)\n' "$(readlink "$LOCK_PATH")"
    fi
    exit 0
    ;;
  release)
    [ "$#" -eq 1 ] || usage
    rm -f "$HOLD_FILE"
    exit 0
    ;;
  verify)
    [ "$#" -ge 3 ] || usage
    parse_verify_options "${@:4}"
    ;;
  check-all | security)
    [ "$#" -eq 3 ] || usage
    ;;
  harness-verify)
    [ "$#" -eq 3 ] || usage
    ;;
  gate)
    [ "$#" -eq 5 ] || { [ "$#" -eq 6 ] && [ "$6" = '--long' ]; } || usage
    mutation_base="$4"
    expected_head="$5"
    [ -n "$mutation_base" ] || usage "empty mutation base"
    valid_head "$expected_head" || usage "invalid expected head: $expected_head"
    job_class=2
    [ "$#" -eq 6 ] && job_class=3
    ;;
  *)
    usage "unknown command: $command_name"
    ;;
esac

# Every job class waits for the load, so the limit is checked for every job command.
case "$GATE_START_MAX_WAIT" in
  '' | *[!0-9]*) refuse "KIKO_QUEUE_GATE_LOAD_WAIT_SECONDS must be a whole number of seconds, got \"$GATE_START_MAX_WAIT\"" ;;
esac

worktree="$2"
# The tree whose status and HEAD the job's record reads: the worktree, until a verify names its
# shared checkout.
job_tree="$worktree"
label="$3"
valid_label "$label" || usage "invalid label: $label"
if [ "$command_name" = harness-verify ]; then
  case "$worktree" in
    /*) ;;
    *) usage "harness-verify needs an absolute path: $worktree" ;;
  esac
fi
[ -d "$worktree" ] || usage "not a directory: $worktree"

# A harness worktree is the top level of its own repository with a package.json, and never the
# pff-ios app: that one is checked by verify.
refuse_non_harness_worktree() {
  local top_level physical
  top_level="$(git -C "$worktree" rev-parse --show-toplevel 2> /dev/null)"
  physical="$(cd "$worktree" && pwd -P)"
  [ -n "$top_level" ] && [ "$top_level" = "$physical" ] \
    || usage "not the git top level of a repository: $worktree"
  [ -f "$worktree/package.json" ] || usage "no package.json in $worktree"
  [ ! -f "$worktree/harness/kiko/.claude-plugin/plugin.json" ] \
    || usage "$worktree is a pff-ios worktree; queue it with verify"
}

[ "$command_name" != harness-verify ] || refuse_non_harness_worktree

# The git common directory of $1 as a physical absolute path; fails for a folder that is no
# repository. `git -C` prints it relative to $1, so the cd resolves both forms.
common_directory_of() {
  local common
  common="$(git -C "$1" rev-parse --git-common-dir 2> /dev/null)" || return 1
  (cd "$1" && cd "$common" && pwd -P)
}

# A path made physical without needing it to exist: trailing and doubled slashes go, symlinks of
# the part that exists resolve, and a `.` or `..` in the part that does not exist is applied as
# text. So every spelling of one folder compares equal.
physical_path() {
  local path="$1" parent
  while [ "${#path}" -gt 1 ] && [ "${path%/}" != "$path" ]; do path="${path%/}"; done
  if [ -d "$path" ]; then
    (cd "$path" && pwd -P)
    return
  fi
  parent="$(physical_path "$(dirname "$path")")" || return 1
  case "$(basename "$path")" in
    .) printf '%s\n' "$parent" ;;
    ..) dirname "$parent" ;;
    *) printf '%s/%s\n' "${parent%/}" "$(basename "$path")" ;;
  esac
}

# scripts/ff-main.sh trusts every `verify` line of the real queue's done.log, so a verify, a gate,
# or a check-all of any other repository must not reach it. harness-verify keeps working
# on a harness repository because its line has another kind, and security because it never
# names a commit that ff-main.sh counts. A temporary KIKO_QUEUE_DIR is not the real queue, so a
# test queues any repository there.
refuse_foreign_repository_on_real_queue() {
  local own target
  [ "$(physical_path "$QUEUE_DIRECTORY")" = "$(physical_path "$HOME/.claude/kiko-queue")" ] \
    || return 0
  own="$(common_directory_of "$SCRIPT_DIRECTORY")" || own=''
  target="$(common_directory_of "$worktree")" || target=''
  [ -n "$own" ] && [ "$own" = "$target" ] && return 0
  printf 'job-queue.sh: %s is not a worktree of this script'"'"'s repository (%s), and the queue is the default real queue path, whose done.log scripts/ff-main.sh trusts. Queue a worktree of this repository, or set KIKO_QUEUE_DIR to a temporary folder to run a scratch repository.\n' \
    "$worktree" "${own:-unknown}" >&2
  exit 3
}

case "$command_name" in
  verify | gate | check-all) refuse_foreign_repository_on_real_queue ;;
esac

clock_time() { date +%H:%M; }
iso_stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# BSD date reads -r as seconds, GNU date as a file, so the GNU form is the fallback.
epoch_stamp() {
  date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ 2> /dev/null || date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ
}

# The stamp is read before the queue directory is touched, so an older copy changes nothing. A
# stamp of ten or more digits is higher than any format, and one that is not a number is replaced.
check_queue_format() {
  local format_path="$QUEUE_DIRECTORY/format" stamp pending="$QUEUE_DIRECTORY/format.$$"
  mkdir -p "$QUEUE_DIRECTORY"
  stamp="$(head -1 "$format_path" 2> /dev/null)"
  case "$stamp" in
    '' | *[!0-9]*) stamp=0 ;;
  esac
  if [ "${#stamp}" -gt 9 ] || [ "$((10#$stamp))" -gt "$QUEUE_FORMAT" ]; then
    refuse "the queue directory has format $stamp, newer than the format $QUEUE_FORMAT of this script: this is an older job-queue.sh copy; queue from the target worktree's own scripts/job-queue.sh (the stamp names the newest format any copy has used)."
  fi
  [ "$((10#$stamp))" -lt "$QUEUE_FORMAT" ] || return 0
  printf '%s\n' "$QUEUE_FORMAT" > "$pending" && mv -f "$pending" "$format_path"
}

warn_if_copy_differs() {
  local worktree_copy="$worktree/scripts/job-queue.sh"
  [ "$command_name" != harness-verify ] || return 0
  [ -f "$worktree_copy" ] || return 0
  cmp -s "${BASH_SOURCE[0]}" "$worktree_copy" \
    || printf 'WARNING: this job-queue.sh differs from %s; it may lack fixes made there.\n' \
      "$worktree_copy" >&2
}

check_queue_format
warn_if_copy_differs

# A gate mutates the tip it was queued for, so a worktree that moved is refused, at enqueue and
# again at start: the queue never checks out another commit.
refuse_moved_head() {
  local actual_head
  actual_head="$(git -C "$worktree" rev-parse HEAD 2>/dev/null)"
  case "$actual_head" in
    "$expected_head"*) ;;
    *)
      printf 'job-queue.sh: HEAD moved: %s is at %s, not %s; re-queue the gate.\n' \
        "$worktree" "${actual_head:-unknown}" "$expected_head" >&2
      exit 3
      ;;
  esac
}

# The full HEAD of the job's tree, or nothing when it cannot be read.
full_head() {
  local head
  head="$(git -C "$job_tree" rev-parse HEAD 2> /dev/null)" || return 0
  case "$head" in
    *[!0-9a-f]*) ;;
    *) [ "${#head}" -eq 40 ] && printf '%s' "$head" ;;
  esac
}

# Succeeds only when the worktree has no change at all (untracked files count). --no-optional-locks
# keeps the read from taking the worktree's index.lock, so it never races a git command of the user.
# --untracked-files=all overrides a status.showUntrackedFiles=no in the worktree's own config.
tree_is_clean() {
  local changes
  changes="$(git --no-optional-locks -C "$job_tree" status --porcelain --untracked-files=all \
    2> /dev/null)" || return 1
  [ -z "$changes" ]
}

# The first $1 changed paths, one per line (the status letters are cut off).
first_changed_paths() {
  git --no-optional-locks -C "$job_tree" status --porcelain --untracked-files=all 2> /dev/null \
    | sed -n "1,${1}p" | cut -c4-
}

# A gate, and a verify with no --sha, record the commit read from the worktree, so a tree with any
# change is refused: a verify at enqueue only (its job runs in its own checkout at that commit), a
# gate at enqueue and again at start (a device build can rewrite ios/Podfile.lock while it waits).
# An unreadable repository lists no path and is not this refusal's concern: it still records
# `unknown`.
refuse_dirty_tree() {
  local changes paths sha_hint=''
  changes="$(git --no-optional-locks -C "$worktree" status --porcelain --untracked-files=all \
    2> /dev/null)" || return 0
  [ -n "$changes" ] || return 0
  paths="$(printf '%s\n' "$changes" | sed -n '1,3p' | cut -c4- | paste -s -d, -)"
  # Only a verify takes --sha; naming it for a gate would point at a flag the gate refuses.
  if [ "$command_name" = verify ]; then
    sha_hint=' To test a commit while the tree stays dirty, queue with --sha <commit>.'
  fi
  printf 'job-queue.sh: %s has uncommitted changes (first paths: %s); a %s of a changed tree is not a result of any commit. Commit them first (for example ios/Podfile.lock after a pod install) or copy the files aside, never stash, then re-queue.%s\n' \
    "$worktree" "$paths" "$command_name" "$sha_hint" >&2
  exit 3
}

# A gate's size is the changed-line count of the change set, so a short gate runs before a long
# one. A tip from before the changed-line gate has a mutation.sh that ignores --list and would run
# a whole Stryker here, outside the lock, so it is refused before it is run.
read_gate_size() {
  local listing list_code changed_lines
  grep -q 'changed lines:' "$worktree/scripts/checks/mutation.sh" 2> /dev/null \
    || refuse "the mutation.sh of $label has no changed-line gate; merge main first, then re-queue."
  listing="$(env KIKO_MUTATION_BASE="$mutation_base" bash "$worktree/scripts/checks/mutation.sh" --list)"
  list_code=$?
  [ "$list_code" -eq 0 ] \
    || refuse "mutation.sh --list exited $list_code for $label (above the file cap, or the base does not resolve); split the change set, then re-queue."
  printf '%s\n' "$listing" | awk '/^warning:/'
  changed_lines="$(printf '%s\n' "$listing" | sed -n 's/^changed lines: \([0-9][0-9]*\)$/\1/p' | tail -1)"
  [ -n "$changed_lines" ] \
    || refuse "mutation.sh --list for $label printed no 'changed lines:' line; merge main into the change set, then re-queue."
  job_size="$((10#$changed_lines))"
}

if [ "$command_name" = gate ]; then
  refuse_moved_head
  refuse_dirty_tree
  read_gate_size
fi

# The commit a verify tests is named once, here, and the job never reads the worktree again: the
# track goes on with its next task while the verify waits and runs. --sha names a commit (the
# worktree may be dirty or moved), else the worktree HEAD, and a dirty tree is refused so a
# forgotten commit is caught. The job runs in the sibling `<main checkout>-verify` linked worktree,
# prepared by verify-checkout.sh against the main checkout, so a track worktree removed while the
# verify waits changes nothing. A folder with no readable HEAD keeps the in-place run: a folder that
# is no repository (the real queue refuses it above) or, on the real queue too, an unborn-HEAD
# worktree of this repository. It records `unknown`, or the HEAD it really tested when one exists at
# the start of the job.
verify_sha=''
verify_repository=''
verify_checkout=''
resolve_verify_commit() {
  local main_checkout
  if [ -n "$requested_sha" ]; then
    valid_head "$requested_sha" \
      || refuse "--sha takes 7 or more lowercase hex characters, got \"$requested_sha\""
    verify_sha="$(git -C "$worktree" rev-parse --verify --quiet "${requested_sha}^{commit}" 2> /dev/null)"
    case "$verify_sha" in
      "$requested_sha"*) ;;
      *) refuse "--sha $requested_sha is not a commit of $worktree, or it is ambiguous" ;;
    esac
  else
    refuse_dirty_tree
    verify_sha="$(full_head)"
    [ -n "$verify_sha" ] || return 0
  fi
  main_checkout="$(git -C "$worktree" worktree list --porcelain 2> /dev/null \
    | awk '/^worktree / { sub(/^worktree /, ""); print; exit }')"
  [ -n "$main_checkout" ] && [ -d "$main_checkout" ] \
    || refuse "the main checkout of $worktree cannot be found (git worktree list --porcelain)"
  if [ -f "$main_checkout/scripts/verify-checkout.sh" ]; then
    SUPPORT_DIRECTORY="$main_checkout/scripts"
  elif [ ! -f "$SCRIPT_DIRECTORY/verify-checkout.sh" ]; then
    refuse "verify-checkout.sh is missing in $main_checkout/scripts and in $SCRIPT_DIRECTORY: it prepares the verify checkout"
  fi
  verify_repository="$main_checkout"
  verify_checkout="$(dirname "$main_checkout")/$(basename "$main_checkout")-verify"
  job_tree="$verify_checkout"
}

[ "$command_name" != verify ] || resolve_verify_commit

mkdir -p "$TICKETS_DIRECTORY"
ticket_name="${job_class}-$(printf '%010d' "$job_size")-$(date +%s)-$$-${label}"
ticket_path="$TICKETS_DIRECTORY/$ticket_name"
job=''
job_group=''
sleeper=''
verify_log=''
verify_log_trimmed=0
verify_scope=partial
verify_summary=''
owns_claim=0

# The owner record; `-` names no job group yet.
lock_record() { printf '%s %s %s %s %s' "$$" "$1" "$command_name" "$label" "$worktree"; }

# The lock is this process's only while its record names this pid: another waiter may have
# reclaimed it and made its own.
holds_lock() {
  local record
  record="$(readlink "$LOCK_PATH" 2> /dev/null)"
  [ "${record%% *}" = "$$" ]
}

# Live while the waiter pid is alive or its job group has a member. A record that is not a symlink,
# or names no pid, is not live.
lock_is_live() {
  local record waiter rest='' group
  record="$(readlink "$LOCK_PATH" 2> /dev/null)"
  waiter="${record%% *}"
  case "$record" in
    *' '*) rest="${record#* }" ;;
  esac
  group="${rest%% *}"
  pid_is_alive "$waiter" || group_has_members "$group"
}

# Runs a command in the background and waits on it with the wait builtin: bash 3.2 loses a SIGINT
# sent to this pid alone when it arrives as a foreground child is reaped, and the wait builtin does
# not. The status is the command's own. The pid is kept in in_flight so end_in_flight can end it
# and wait for it: a signal trap that ran while the record step's rename was still in flight would
# otherwise let the rename land after the lock was released. It covers the record step's external
# commands only; a command substitution and the wait loops are not covered.
in_flight=''
run_awaited() {
  local status
  "$@" &
  in_flight=$!
  wait "$in_flight"
  status=$?
  in_flight=''
  return "$status"
}

# Names the job group in the owner record with a second atomic step: a temporary symlink renamed
# over the lock, so the record is never missing.
record_job_group() {
  local pending="$QUEUE_DIRECTORY/lock.$$"
  [ -n "$job_group" ] && holds_lock || return 0
  run_awaited rm -f "$pending"
  run_awaited ln -s "$(lock_record "$job_group")" "$pending" 2> /dev/null \
    && run_awaited mv -f "$pending" "$LOCK_PATH"
}

release_claim() {
  [ "$owns_claim" -eq 1 ] || return 0
  [ "$(readlink "$CLAIM_PATH" 2> /dev/null)" = "$$" ] && rm -f "$CLAIM_PATH"
  owns_claim=0
  return 0
}

# One waiter at a time passes the claim. A claim whose holder is dead is removed, and the caller
# tries again on its next poll.
take_claim() {
  if ln -s "$$" "$CLAIM_PATH" 2> /dev/null; then
    owns_claim=1
    return 0
  fi
  pid_is_alive "$(readlink "$CLAIM_PATH" 2> /dev/null)" || rm -f "$CLAIM_PATH"
  return 1
}

# A lock that is not live is moved aside with one atomic rename; the process whose rename won owns
# the owner record and writes the one LOST line for it. A lock with no readable record (not a
# symlink) is removed with no line, since it names no job.
reclaim_dead_lock() {
  local moved="$QUEUE_DIRECTORY/lost-lock.$$" record lost_kind lost_label now
  rm -rf "$moved"
  if ! mv "$LOCK_PATH" "$moved" 2> /dev/null; then
    rm -rf "$LOCK_PATH"
    return 0
  fi
  record="$(readlink "$moved" 2> /dev/null)"
  rm -rf "$moved"
  lost_kind="$(printf '%s' "$record" | awk '{ print $3 }')"
  lost_label="$(printf '%s' "$record" | awk '{ print $4 }')"
  [ -n "$lost_kind" ] && [ -n "$lost_label" ] || return 0
  now="$(iso_stamp)"
  printf '%s %s lost %s %s unknown\n' "$lost_kind" "$lost_label" "$now" "$now" >> "$DONE_LOG"
}

# Check, remove, and create the lock under the claim, so no other waiter sees it half done.
acquire_lock() {
  local lock_code
  take_claim || return 1
  if [ -L "$LOCK_PATH" ] || [ -e "$LOCK_PATH" ]; then
    if lock_is_live; then
      release_claim
      return 1
    fi
    reclaim_dead_lock
  fi
  ln -s "$(lock_record -)" "$LOCK_PATH" 2> /dev/null
  lock_code=$?
  # A hold written after this waiter's hold check and before its lock is seen here: the hold
  # command writes the file and then reads the lock, so either this start backs off or the hold
  # names its lock (and the start it names may still back off here).
  if [ "$lock_code" -eq 0 ] && [ -f "$HOLD_FILE" ]; then
    rm -f "$LOCK_PATH"
    release_claim
    return 1
  fi
  release_claim
  [ "$lock_code" -eq 0 ]
}

# The sleep runs in the background and the script waits on it, so a signal ends the wait at once
# instead of after the whole poll interval.
pause() {
  sleep "$POLL_SECONDS" &
  sleeper=$!
  wait "$sleeper"
  sleeper=''
}

# TERM goes to the group this process created for its own job and to no other, and only while
# pgrep reports a member (a group id is never reused while it has one); a pgrep that could not
# tell signals no group, and the job's own unreaped pid (never reusable) gets the TERM instead.
# Then the leader is reaped and the group gets a bounded number of polls to empty.
terminate_job_group() {
  local polls=0
  [ -n "$job_group" ] || job_group="$job"
  [ -n "$job_group" ] || return 0
  if scan_group "$job_group"; then
    kill -s TERM -- "-$job_group" 2> /dev/null
  elif [ -n "$job" ]; then
    kill -s TERM "$job" 2> /dev/null
  fi
  if [ -n "$job" ]; then
    wait "$job" 2> /dev/null
    job=''
  fi
  while group_has_members "$job_group" && [ "$polls" -lt "$STOP_POLLS" ]; do
    pause
    polls=$((polls + 1))
  done
}

# The lock goes only when this process holds it and its job group is empty; a group that still
# has a member keeps the lock, with the record naming the group.
release_lock() {
  holds_lock || return 0
  if group_has_members "$job_group"; then
    record_job_group
    return 0
  fi
  rm -f "$LOCK_PATH"
}

# Ends the in-flight record command and waits for it: a rename is atomic, so after the wait it has
# either landed or never will, and the temporary symlink a killed `ln` left is removed. A signal
# runs this before the job group is ended, because that step can take minutes and the pid would
# otherwise be reused by then; cleanup runs it again for the EXIT path, where it is a no-op once
# the pid is gone.
end_in_flight() {
  [ -n "$in_flight" ] || return 0
  kill "$in_flight" 2> /dev/null
  wait "$in_flight" 2> /dev/null
  in_flight=''
  rm -f "$QUEUE_DIRECTORY/lock.$$"
}

# The counts and failure markers of the whole run go to the top of the kept log: the counts of an
# early stage are far from the last lines. It runs once, from the normal end or from cleanup after a
# signal; the EXIT trap runs cleanup again after the normal end.
trim_verify_log() {
  local trimmed
  [ -n "$verify_log" ] && [ -f "$verify_log" ] && [ "$verify_log_trimmed" -eq 0 ] || return 0
  verify_log_trimmed=1
  # Read before the trim, because the 2b header can fall out of the kept lines. Both anchors are at
  # the line start, so a suite that prints the marker text mid-line proves nothing. `full` needs the
  # real header and no SKIPPED line; a log with no header is `partial`.
  if grep -a -q '^── make verify: stage 2b (' "$verify_log" \
    && ! grep -a -q '^── make verify: stage 2b SKIPPED' "$verify_log"; then
    verify_scope=full
  fi
  trimmed="$verify_log.trimmed"
  verify_summary="$(grep -a -E "$VERIFY_SUMMARY_PATTERN" "$verify_log" | sed -n "1,${VERIFY_SUMMARY_LINES}p")"
  {
    [ -z "$verify_summary" ] || printf '%s\n' "$verify_summary"
    tail -n "$VERIFY_LOG_LINES" "$verify_log"
  } > "$trimmed" && mv -f "$trimmed" "$verify_log"
}

# Stops only the processes this script started (its own job, sleep, and in-flight record command),
# never one found by name. The in-flight command is ended before the lock is read.
cleanup() {
  end_in_flight
  if [ -n "$sleeper" ]; then
    kill "$sleeper" 2> /dev/null
    sleeper=''
  fi
  if [ -n "$job" ]; then
    kill "$job" 2> /dev/null
    wait "$job" 2> /dev/null
    job=''
  fi
  trim_verify_log
  rm -f "$ticket_path"
  release_claim
  release_lock
}

# A signal ends the script: without the exit, a trap that only cleans up lets the wait loop go on.
# A second signal while the group ends leaves at once. While the job is being forked the queue has
# no pid to stop yet, so the signal is kept and run_job acts on it as soon as the group is known.
starting=0
pending_signal=''
stop_on_signal() {
  local exit_code=130
  [ "$1" = TERM ] && exit_code=143
  if [ "$starting" -eq 1 ]; then
    pending_signal="$1"
    return 0
  fi
  trap "exit $exit_code" INT TERM
  end_in_flight
  terminate_job_group
  cleanup
  exit "$exit_code"
}

trap cleanup EXIT
trap 'stop_on_signal INT' INT
trap 'stop_on_signal TERM' TERM
touch "$ticket_path"

head_ticket() { ticket_names | sed -n '1p'; }
tickets_ahead() { ticket_names | awk -v mine="$ticket_name" '$0 == mine { exit } { count++ } END { print count + 0 }'; }

kind_text="$command_name"
if [ "$command_name" = gate ]; then
  kind_text="gate"
  [ "$job_class" -eq 3 ] && kind_text="gate --long"
  kind_text="$kind_text, size $job_size"
fi
printf 'QUEUED %s (%s) ahead: %s\n' "$label" "$kind_text" "$(tickets_ahead)"

# The ticket of a dead waiter is moved aside with one atomic rename, so two waiters that prune it
# at the same time write one LOST line: only the rename that won writes it. The label is the rest
# of the name after the pid (it may hold dashes).
drop_dead_ticket() {
  local ticket="$1" waiter_pid="$2" moved="$QUEUE_DIRECTORY/pruned.$$" queued_epoch lost_label queued
  mv "$TICKETS_DIRECTORY/$ticket" "$moved" 2> /dev/null || return 0
  rm -f "$moved"
  queued_epoch="$(printf '%s' "$ticket" | cut -d- -f3)"
  lost_label="$(printf '%s' "$ticket" | cut -d- -f5-)"
  queued=unknown
  case "$queued_epoch" in
    '' | *[!0-9]*) ;;
    *) queued="$(epoch_stamp "$queued_epoch")" || queued=unknown ;;
  esac
  printf 'lost %s %s %s %s unknown\n' "${lost_label:-unknown}" "$waiter_pid" "$queued" \
    "$(iso_stamp)" >> "$DONE_LOG"
}

# A ticket name carries its waiter's pid (the fourth dash-separated field). A waiter killed
# without a trap leaves its ticket behind, and so does a file that is no ticket at all; either
# would hold the head of the queue forever. Only a ticket with a pid leaves a LOST line.
prune_stale_tickets() {
  local ticket waiter_pid
  for ticket in $(ticket_names); do
    waiter_pid="$(printf '%s' "$ticket" | cut -d- -f4)"
    case "$waiter_pid" in
      '' | *[!0-9]*) rm -f "$TICKETS_DIRECTORY/$ticket" ;;
      *) kill -0 "$waiter_pid" 2> /dev/null || drop_dead_ticket "$ticket" "$waiter_pid" ;;
    esac
  done
}

# Whether the lock is held by a job that is still alive; a dead owner's lock is not, because the
# next acquire reclaims it.
lock_is_held() {
  { [ -L "$LOCK_PATH" ] || [ -e "$LOCK_PATH" ]; } && lock_is_live
}

# The load wait starts over whenever the job stops being the next to start: it lost the head, a
# job holds the lock, or a hold or power reason stops the start.
load_wait_started=''
load_wait_expired=0
load_unknown_announced=0
load_value=''
reset_load_wait() {
  load_wait_started=''
  load_wait_expired=0
}

# One read of the 5-minute load through wait-load.sh with a timeout of 0 (its exit 0 is below the
# limit, 2 at or above, 3 unreadable; any other exit, such as a bad KIKO_WAIT_LOAD_INTERVAL, reads
# as unreadable). The load comes from its "average is <x>," line so both scripts read it alike.
# Returns 0 below the limit, 1 at or above it (load_value is set), 2 unreadable.
read_gate_load() {
  local output code
  output="$(bash "$SUPPORT_DIRECTORY/wait-load.sh" "$GATE_START_MAX_LOAD" 0 2>&1)"
  code=$?
  case "$code" in
    0) return 0 ;;
    2)
      load_value="$(printf '%s\n' "$output" | sed -n 's/.*load average is \([0-9.][0-9.]*\),.*/\1/p' | tail -1)"
      load_value="${load_value:-unknown}"
      return 1
      ;;
    *) return 2 ;;
  esac
}

# Whether the job at the head must not start in this pass. It sets `reason` when the load is why.
# An unreadable load never defers (one line says so), and the wait ends after GATE_START_MAX_WAIT
# seconds with one LOAD WAIT EXPIRED line, the job then starting at that load. It reads the load
# only when no hold or power reason stops the start and the lock is free, so the clock counts the
# job's own wait for the machine, not a job that runs ahead of it. A pass that finds the lock held
# does not try the lock either: a lock freed between the two steps would let the job start with no
# load read, so the next pass reads the load first. The lock is taken after this check, so a hold
# placed during the wait stops the start in acquire_lock's re-check, as for any start.
defer_for_load() {
  local reading
  [ "$load_wait_expired" -eq 0 ] || return 1
  if lock_is_held; then
    reset_load_wait
    return 0
  fi
  read_gate_load
  reading=$?
  if [ "$reading" -eq 2 ]; then
    [ "$load_unknown_announced" -eq 1 ] \
      || printf 'NOTE %s: load unknown, so the %s starts without a load wait\n' "$label" "$command_name"
    load_unknown_announced=1
    return 1
  fi
  [ "$reading" -eq 1 ] || return 1
  if [ -z "$load_wait_started" ]; then
    # The first read only starts the clock, so a WAITING line always comes before an expiry, even
    # when the whole-second SECONDS ticks between the two reads or the limit is 0.
    load_wait_started="$SECONDS"
  elif [ "$((SECONDS - load_wait_started))" -ge "$GATE_START_MAX_WAIT" ]; then
    printf 'LOAD WAIT EXPIRED %s: load %s\n' "$label" "$load_value"
    load_wait_expired=1
    return 1
  fi
  reason="load at or above $GATE_START_MAX_LOAD (waits at most $GATE_START_MAX_WAIT s)"
}

# A hold, an unfit power state, or a high load stops every class: the line prints when the reason
# changes, so a waiter's log shows why it waits without a line per poll.
# Only the head waiter takes the lock.
waiting_reason=''
while :; do
  prune_stale_tickets
  reason="$(blocked_reason)"
  if [ -n "$reason" ]; then
    reset_load_wait
  elif [ "$(head_ticket)" != "$ticket_name" ]; then
    reset_load_wait
  elif defer_for_load; then
    :
  elif acquire_lock; then
    break
  fi
  [ -z "$reason" ] || [ "$reason" = "$waiting_reason" ] || printf 'WAITING %s: %s\n' "$label" "$reason"
  waiting_reason="$reason"
  pause
done
rm -f "$ticket_path"

# The stale Stryker state of an earlier run is removed so the run starts from the diff, not from
# a half-finished one.
prepare_gate() {
  refuse_moved_head
  rm -f "$worktree/reports/stryker-incremental.json"
  rm -rf "$worktree/.stryker-tmp"
}

# caffeinate keeps the Mac awake for the run; a machine without it runs make directly.
start_gate_job() {
  local caffeinate_binary="${KIKO_QUEUE_CAFFEINATE:-caffeinate}" wrapper=''
  gate_log="$QUEUE_DIRECTORY/logs/gate-$label.log"
  mkdir -p "$QUEUE_DIRECTORY/logs"
  if command -v "$caffeinate_binary" > /dev/null 2>&1; then
    wrapper="$caffeinate_binary"
  fi
  env -u FORCE_COLOR KIKO_MUTATION_BASE="$mutation_base" ${wrapper:+"$wrapper" -i} \
    make -C "$worktree" deep > "$gate_log" 2>&1 < /dev/null &
}

# The output goes to a log, so the cause of a failed verify is kept; keep_verify_log trims it.
start_verify_job() {
  verify_log="$QUEUE_DIRECTORY/logs/verify-$label.log"
  mkdir -p "$QUEUE_DIRECTORY/logs"
  # make gets KIKO_VERIFY_SCOPED=1 only for --scoped, and an inherited value is removed, so a stale
  # export can never skip stage 2b.
  local scope_arguments=(-u KIKO_VERIFY_SCOPED)
  [ "$scoped" -eq 0 ] || scope_arguments=(KIKO_VERIFY_SCOPED=1)
  if [ -z "$verify_sha" ]; then
    env -u FORCE_COLOR "${scope_arguments[@]}" make -C "$worktree" verify \
      > "$verify_log" 2>&1 < /dev/null &
    return
  fi
  # One backgrounded subshell, so the prepare step runs in the job's own process group and a signal
  # reaches it as it reaches make. A failed prepare is the job's exit 2, and make never runs.
  (
    env -u FORCE_COLOR bash "$SUPPORT_DIRECTORY/verify-checkout.sh" \
      "$verify_repository" "$verify_checkout" "$verify_sha" \
      && exec env -u FORCE_COLOR "${scope_arguments[@]}" make -C "$verify_checkout" verify
  ) > "$verify_log" 2>&1 < /dev/null &
}

# The job runs in the background, in a process group of its own (`set -m`), and the script waits
# on it, so a trapped signal interrupts the wait at once instead of after the job. Job control
# also stops giving a background job /dev/null as stdin, so each job gets it by hand. FORCE_COLOR
# breaks the fingerprint stamps that read a number through node, so every job runs without it.
run_job() {
  starting=1
  set -m
  case "$command_name" in
    verify) start_verify_job ;;
    check-all) env -u FORCE_COLOR npm --prefix "$worktree" run check:all < /dev/null & ;;
    security) (cd "$worktree" && exec env -u FORCE_COLOR npm run check:security) < /dev/null & ;;
    harness-verify)
      (env -u FORCE_COLOR npm --prefix "$worktree" test \
        && exec env -u FORCE_COLOR npm --prefix "$worktree" run check:all) < /dev/null &
      ;;
    gate) start_gate_job ;;
  esac
  # Test-only hook, empty in production: it runs inside the window where the job exists but its pid
  # is not yet read, so a test can send the queue a signal at exactly that point.
  [ -z "${KIKO_QUEUE_FORK_HOOK:-}" ] || "$KIKO_QUEUE_FORK_HOOK" "$$" < /dev/null
  job=$!
  set +m
  job_group="$job"
  starting=0
  [ -z "$pending_signal" ] || stop_on_signal "$pending_signal"
  record_job_group
  wait "$job"
  job_code=$?
  job=''
}

# The job's own children normally end with it; one that does not keeps the lock, so the next job
# never starts beside it.
drain_job_group() {
  group_has_members "$job_group" || return 0
  printf 'DRAIN %s: processes of the job still run (group %s)\n' "$label" "$job_group"
  while group_has_members "$job_group"; do
    pause
  done
}

# The commit a job that runs in the worktree it was queued for (a gate, check-all, security, a
# verify of a folder with no sha) ran on, named only while that is certain: a tree with any change
# (untracked files count) at START is not "the job at that commit". A verify with a sha names its
# sha instead, and only the end is checked, in its checkout.
read_tested_head() {
  local head
  head="$(full_head)"
  if tree_is_clean && [ -n "$head" ]; then
    printf '%s' "$head"
  else
    printf unknown
  fi
}

# A HEAD that moved during the job means the job ran on more than one commit, and a tree that is
# not clean at the end means the job ran on content that is not that commit. make verify writes
# its state outside the tree, so a job that dirties its own tree records unknown, and a NOTE names
# the first changed path so the cause is visible.
confirm_tested_head() {
  local changed
  [ "$tested_head" = unknown ] && return 0
  if [ "$(full_head)" = "$tested_head" ] && tree_is_clean; then
    return 0
  fi
  tested_head=unknown
  changed="$(first_changed_paths 1)"
  [ -z "$changed" ] || printf 'NOTE %s: the tree changed during the job: %s\n' "$label" "$changed"
}

# The output goes to the log, not to the waiter, while the job runs, so the end prints the counts
# and failure markers of the whole run, the log path, and the last lines.
keep_verify_log() {
  [ -n "$verify_log" ] || return 0
  trim_verify_log
  [ -z "$verify_summary" ] || printf '%s\n' "$verify_summary"
  printf 'log: %s\n' "$verify_log"
  tail -n "$VERIFY_TAIL_LINES" "$verify_log" 2> /dev/null
}

if [ "$command_name" = gate ]; then
  refuse_dirty_tree
  prepare_gate
fi
started_at="$(iso_stamp)"
# The START line names the commit the job runs on: a gate was refused unless HEAD starts with its
# expected head, so the worktree's HEAD is the queued commit; its first 12 characters name it even
# when the expected head was given short. A verify with a sha runs on the commit read at enqueue,
# never on the worktree it was queued for.
if [ -n "$verify_sha" ]; then
  head_sha="${verify_sha:0:12}"
  tested_head="$verify_sha"
else
  head_sha="$(git -C "$worktree" rev-parse HEAD 2> /dev/null | cut -c1-12)"
  tested_head="$(read_tested_head)"
fi
printf 'START %s at %s head %s (load: %s)\n' "$label" "$(clock_time)" "${head_sha:-unknown}" "$(uptime 2> /dev/null | sed 's/.*averages: //')"
run_job
drain_job_group
keep_verify_log
[ "$command_name" = gate ] \
  && {
    # The first run of a rerun gate prints its score lines with a FIRST RUN: prefix; the verdict is
    # the final run's, so those lines never reach the summary.
    grep -E 'changed lines|CHANGE SET|GATE:|CHECK FAILED' "$gate_log" | grep -v '^FIRST RUN: ' | tail -5
    # These rulings are printed on stdout and again in the failure block, so they are deduped.
    grep -E '^(TIMEOUT-HEAVY |REPORT SCOPE MISMATCH|RERUN )' "$gate_log" | awk '!seen[$0]++'
  }
confirm_tested_head
done_line="$command_name $label $job_code $started_at $(iso_stamp) $tested_head"
[ "$command_name" != verify ] || done_line="$done_line $verify_scope"
printf '%s\n' "$done_line" >> "$DONE_LOG"
printf 'DONE %s exit %s at %s\n' "$label" "$job_code" "$(clock_time)"
exit "$job_code"
