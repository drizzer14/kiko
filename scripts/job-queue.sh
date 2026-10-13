#!/usr/bin/env bash
# One queue for every heavy job (make verify, check:all, check:security, the mutation gate) across
# all worktrees: one job runs at a time, the shortest class first, and nothing runs on battery.
#
# Usage (run it with run_in_background and wait on its exit code):
#   job-queue.sh verify|check-all|security <worktree> <label>
#   job-queue.sh gate <worktree> <label> <mutation-base> <expected-head> [--long]
#   job-queue.sh hold <reason>    stop every start until `release`; running jobs are not stopped
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
#   hold       present while held; its text is the reason
#   logs/      gate-<label>.log, the whole output of a gate (other jobs print to stdout)
#   done.log   one line per finished job: kind label exit start end
#
# Order is a plain `sort` of the ticket names. Class 1 is verify, check-all, and security (size
# 0, first come first served); class 2 is a gate, class 3 a gate with --long. A gate's size is the
# `changed lines:` figure of `KIKO_MUTATION_BASE=<base> scripts/checks/mutation.sh --list` in its
# worktree, read when it is queued, so a short gate runs before a long one. A change set above the
# file cap is refused (exit 2), and so is a tip whose mutation.sh has no changed-line gate (it
# would ignore --list and run a whole Stryker outside the lock): merge main into it first. A gate
# whose worktree HEAD does not start with <expected-head> is refused at once (exit 3), and again
# when its turn comes.
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
# Group signal (user ruling 2026-10-13): on SIGINT or SIGTERM the queue sends TERM to the process
# group it created for its own job (`kill -s TERM -- -<group>`), and to no other group: the group
# comes from this process's own memory, never from the lock file, and never from a name or a
# pattern. It then waits for the group to empty, polling every KIKO_QUEUE_POLL_SECONDS, at most
# KIKO_QUEUE_STOP_POLLS times; a group that does not empty leaves the lock in place and the queue
# exits anyway. A second signal during that wait exits at once. SIGKILL cannot be trapped: a
# waiter killed with it leaves its job running with the lock live by group, so never SIGKILL one.
#
# Exit codes: the job's own code (2 also covers a refused request, as the plan's contract says); 3
# a gate whose HEAD moved; 130 after SIGINT; 143 after SIGTERM.
#
# Known limits: the group check is a liveness test only. A pid reused by an unrelated process makes
# a dead owner read as alive, so a lock can stall, never run two jobs at once. A claim whose holder
# was SIGKILLed is removed by a check-then-remove, so two waiters meeting a dead claim at the same
# instant can both pass it.
#
# Test seams: KIKO_QUEUE_DIR, KIKO_QUEUE_POLL_SECONDS (default 30), KIKO_QUEUE_STOP_POLLS
# (default 20), KIKO_QUEUE_PMSET and KIKO_QUEUE_CAFFEINATE (the binary to run instead of pmset and
# caffeinate; a missing pmset means AC power, a missing caffeinate means none).
set -uo pipefail

QUEUE_DIRECTORY="${KIKO_QUEUE_DIR:-$HOME/.claude/kiko-queue}"
TICKETS_DIRECTORY="$QUEUE_DIRECTORY/tickets"
LOCK_PATH="$QUEUE_DIRECTORY/lock"
CLAIM_PATH="$QUEUE_DIRECTORY/claim"
POLL_SECONDS="${KIKO_QUEUE_POLL_SECONDS:-30}"
STOP_POLLS="${KIKO_QUEUE_STOP_POLLS:-20}"

usage() {
  [ "$#" -eq 0 ] || printf '%s\n' "$1" >&2
  cat >&2 <<'USAGE'
usage: job-queue.sh verify|check-all|security <worktree> <label>
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

ticket_names() { ls "$TICKETS_DIRECTORY" 2>/dev/null | LC_ALL=C sort; }

# A positive pid that is alive.
pid_is_alive() {
  case "$1" in
    '' | *[!0-9]* | 0*) return 1 ;;
  esac
  kill -0 "$1" 2> /dev/null
}

# A process group with a member. pgrep exits 1 for no match; any other outcome (it could not
# tell) counts as a member, so a failing pgrep never frees a lock.
group_has_members() {
  local pgrep_code
  case "$1" in
    '' | *[!0-9]* | 0*) return 1 ;;
  esac
  pgrep -g "$1" > /dev/null 2>&1
  pgrep_code=$?
  [ "$pgrep_code" -ne 1 ]
}

# Why the power state stops a start; nothing for AC power or a machine without pmset. A pmset that
# is present but fails or prints nothing says nothing about the power source, so it stops the
# start too: battery must never read as AC.
power_reason() {
  local pmset_binary="${KIKO_QUEUE_PMSET:-pmset}" power first_line
  command -v "$pmset_binary" > /dev/null 2>&1 || return 0
  power="$("$pmset_binary" -g batt 2> /dev/null)" || {
    printf 'power state unknown'
    return 0
  }
  first_line="$(printf '%s\n' "$power" | sed -n '1p')"
  case "$first_line" in
    '') printf 'power state unknown' ;;
    *'Battery Power'*) printf 'battery power' ;;
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

queue_status() {
  local busy=0 ticket power
  if [ -f "$HOLD_FILE" ]; then
    printf 'hold: %s\n' "$(head -1 "$HOLD_FILE")"
  fi
  power="$(power_reason)"
  if [ -n "$power" ]; then
    printf '%s: no job starts\n' "$power"
  fi
  if [ -L "$LOCK_PATH" ]; then
    busy=1
    printf 'running: %s\n' "$(readlink "$LOCK_PATH")"
  fi
  for ticket in $(ticket_names); do
    busy=1
    printf 'queued: %s\n' "$ticket"
  done
  [ "$busy" -eq 1 ] || printf 'queue empty\n'
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
    exit 0
    ;;
  release)
    [ "$#" -eq 1 ] || usage
    rm -f "$HOLD_FILE"
    exit 0
    ;;
  verify | check-all | security)
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

worktree="$2"
label="$3"
valid_label "$label" || usage "invalid label: $label"
[ -d "$worktree" ] || usage "not a directory: $worktree"

clock_time() { date +%H:%M; }
iso_stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

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
  changed_lines="$(printf '%s\n' "$listing" | sed -n 's/^changed lines: \([0-9][0-9]*\)$/\1/p' | tail -1)"
  [ -n "$changed_lines" ] \
    || refuse "mutation.sh --list for $label printed no 'changed lines:' line; merge main into the change set, then re-queue."
  job_size="$((10#$changed_lines))"
}

if [ "$command_name" = gate ]; then
  refuse_moved_head
  read_gate_size
fi

mkdir -p "$TICKETS_DIRECTORY"
ticket_name="${job_class}-$(printf '%010d' "$job_size")-$(date +%s)-$$-${label}"
ticket_path="$TICKETS_DIRECTORY/$ticket_name"
job=''
job_group=''
sleeper=''
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

# Names the job group in the owner record with a second atomic step: a temporary symlink renamed
# over the lock, so the record is never missing.
record_job_group() {
  local pending="$QUEUE_DIRECTORY/lock.$$"
  [ -n "$job_group" ] && holds_lock || return 0
  rm -f "$pending"
  ln -s "$(lock_record "$job_group")" "$pending" 2> /dev/null && mv -f "$pending" "$LOCK_PATH"
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

# Check, remove, and create the lock under the claim, so no other waiter sees it half done.
acquire_lock() {
  local lock_code
  take_claim || return 1
  if [ -L "$LOCK_PATH" ] || [ -e "$LOCK_PATH" ]; then
    if lock_is_live; then
      release_claim
      return 1
    fi
    rm -rf "$LOCK_PATH"
  fi
  ln -s "$(lock_record -)" "$LOCK_PATH" 2> /dev/null
  lock_code=$?
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

# TERM goes to the group this process created for its own job and to no other, and only while that
# group has a member (a group id is never reused while it has one). Then the leader is reaped and
# the group gets a bounded number of polls to empty.
terminate_job_group() {
  local polls=0
  [ -n "$job_group" ] || job_group="$job"
  [ -n "$job_group" ] || return 0
  group_has_members "$job_group" && kill -s TERM -- "-$job_group" 2> /dev/null
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

# Stops only the processes this script started (its own job and sleep), never one found by name.
cleanup() {
  if [ -n "$sleeper" ]; then
    kill "$sleeper" 2> /dev/null
    sleeper=''
  fi
  if [ -n "$job" ]; then
    kill "$job" 2> /dev/null
    wait "$job" 2> /dev/null
    job=''
  fi
  rm -f "$ticket_path"
  release_claim
  release_lock
}

# A signal ends the script: without the exit, a trap that only cleans up lets the wait loop go on.
# A second signal while the group ends leaves at once.
stop_on_signal() {
  trap "exit $1" INT TERM
  terminate_job_group
  cleanup
  exit "$1"
}

trap cleanup EXIT
trap 'stop_on_signal 130' INT
trap 'stop_on_signal 143' TERM
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

# A ticket name carries its waiter's pid (the fourth dash-separated field). A waiter killed
# without a trap leaves its ticket behind, and so does a file that is no ticket at all; either
# would hold the head of the queue forever.
prune_stale_tickets() {
  local ticket waiter_pid
  for ticket in $(ticket_names); do
    waiter_pid="$(printf '%s' "$ticket" | cut -d- -f4)"
    case "$waiter_pid" in
      '' | *[!0-9]*) rm -f "$TICKETS_DIRECTORY/$ticket" ;;
      *) kill -0 "$waiter_pid" 2> /dev/null || rm -f "$TICKETS_DIRECTORY/$ticket" ;;
    esac
  done
}

# A hold or an unfit power state stops every class: the line prints when the reason changes, so a
# waiter's log shows why it waits without a line per poll. Only the head waiter takes the lock.
waiting_reason=''
while :; do
  prune_stale_tickets
  reason="$(blocked_reason)"
  if [ -n "$reason" ]; then
    [ "$reason" = "$waiting_reason" ] || printf 'WAITING %s: %s\n' "$label" "$reason"
  elif [ "$(head_ticket)" = "$ticket_name" ] && acquire_lock; then
    break
  fi
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

# The job runs in the background, in a process group of its own (`set -m`), and the script waits
# on it, so a trapped signal interrupts the wait at once instead of after the job. Job control
# also stops giving a background job /dev/null as stdin, so each job gets it by hand. FORCE_COLOR
# breaks the fingerprint stamps that read a number through node, so every job runs without it.
run_job() {
  set -m
  case "$command_name" in
    verify) env -u FORCE_COLOR make -C "$worktree" verify < /dev/null & ;;
    check-all) env -u FORCE_COLOR npm --prefix "$worktree" run check:all < /dev/null & ;;
    security) (cd "$worktree" && exec env -u FORCE_COLOR npm run check:security) < /dev/null & ;;
    gate) start_gate_job ;;
  esac
  job=$!
  set +m
  job_group="$job"
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

[ "$command_name" = gate ] && prepare_gate
started_at="$(iso_stamp)"
printf 'START %s at %s (load: %s)\n' "$label" "$(clock_time)" "$(uptime 2> /dev/null | sed 's/.*averages: //')"
run_job
drain_job_group
[ "$command_name" = gate ] \
  && grep -E 'changed lines|CHANGE SET|GATE:|CHECK FAILED' "$gate_log" | tail -5
printf '%s %s %s %s %s\n' "$command_name" "$label" "$job_code" "$started_at" "$(iso_stamp)" \
  >> "$QUEUE_DIRECTORY/done.log"
printf 'DONE %s exit %s at %s\n' "$label" "$job_code" "$(clock_time)"
exit "$job_code"
