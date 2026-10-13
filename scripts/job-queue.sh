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
#   lock/      a directory made with mkdir; its `owner` file is `<pid> <kind> <label> <worktree>`
#   hold       present while held; its text is the reason
#   logs/      gate-<label>.log, the whole output of a gate (other jobs print to stdout)
#   done.log   one line per finished job: kind label exit start end
#
# Order is a plain `sort` of the ticket names. Class 1 is verify, check-all, and security (size
# 0, first come first served); class 2 is a gate, class 3 a gate with --long. A gate's size is the
# `changed lines:` figure of `KIKO_MUTATION_BASE=<base> scripts/checks/mutation.sh --list` in its
# worktree, read when it is queued, so a short gate runs before a long one. A change set above the
# file cap, or a tip whose mutation.sh prints no `changed lines:` line, is refused (exit 2).
#
# The first ticket in order starts once no hold exists, the machine is not on battery power, and
# `mkdir lock` succeeds. A gate then checks that the worktree HEAD still starts with
# <expected-head> (it never checks anything out), removes the stale Stryker state, and runs
# `make deep` under caffeinate. A waiter removes a ticket whose pid is gone, and the head waiter a
# lock whose owner pid is gone. A waiter killed with SIGKILL leaves its own job running while its
# lock reads as stale, so never SIGKILL one; stop it with SIGTERM or SIGINT.
#
# Exit codes: the job's own code; 2 usage or a refused gate; 3 a gate whose HEAD moved; 130 after
# SIGINT; 143 after SIGTERM. A signal stops this script's own job and sleep (never one found by
# name), removes its ticket, removes the lock if it holds it, then exits.
#
# Test seams: KIKO_QUEUE_DIR, KIKO_QUEUE_POLL_SECONDS (default 30), KIKO_QUEUE_PMSET and
# KIKO_QUEUE_CAFFEINATE (the binary to run instead of pmset and caffeinate; a missing binary means
# AC power and no caffeinate).
set -u

QUEUE_DIRECTORY="${KIKO_QUEUE_DIR:-$HOME/.claude/kiko-queue}"
TICKETS_DIRECTORY="$QUEUE_DIRECTORY/tickets"
LOCK_DIRECTORY="$QUEUE_DIRECTORY/lock"
POLL_SECONDS="${KIKO_QUEUE_POLL_SECONDS:-30}"

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

# Battery power only; a machine without pmset, or output that does not say so, counts as AC.
on_battery() {
  local pmset_binary="${KIKO_QUEUE_PMSET:-pmset}"
  command -v "$pmset_binary" > /dev/null 2>&1 || return 1
  "$pmset_binary" -g batt 2> /dev/null | head -1 | grep -q 'Battery Power'
}

# Why no job may start now; empty when one may.
blocked_reason() {
  if [ -f "$HOLD_FILE" ]; then
    printf 'hold (%s)' "$(head -1 "$HOLD_FILE")"
  elif on_battery; then
    printf 'battery power'
  fi
}

queue_status() {
  local busy=0 ticket
  if [ -f "$HOLD_FILE" ]; then
    printf 'hold: %s\n' "$(head -1 "$HOLD_FILE")"
  fi
  if on_battery; then
    printf 'battery power: no job starts\n'
  fi
  if [ -f "$LOCK_DIRECTORY/owner" ]; then
    busy=1
    printf 'running: %s\n' "$(head -1 "$LOCK_DIRECTORY/owner")"
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

# A gate's size is the changed-line count of the change set, so a short gate runs before a long
# one. A tip without the changed-line gate prints no such line and cannot be sized.
read_gate_size() {
  local listing list_code changed_lines
  listing="$(env KIKO_MUTATION_BASE="$mutation_base" bash "$worktree/scripts/checks/mutation.sh" --list)"
  list_code=$?
  [ "$list_code" -eq 0 ] \
    || refuse "mutation.sh --list exited $list_code for $label (above the file cap, or the base does not resolve); split the change set, then re-queue."
  changed_lines="$(printf '%s\n' "$listing" | sed -n 's/^changed lines: \([0-9][0-9]*\)$/\1/p' | tail -1)"
  [ -n "$changed_lines" ] \
    || refuse "mutation.sh --list for $label printed no 'changed lines:' line; merge main into the change set, then re-queue."
  job_size="$((10#$changed_lines))"
}

[ "$command_name" = gate ] && read_gate_size

mkdir -p "$TICKETS_DIRECTORY"
ticket_name="${job_class}-$(printf '%010d' "$job_size")-$(date +%s)-$$-${label}"
ticket_path="$TICKETS_DIRECTORY/$ticket_name"
job=''
sleeper=''
owns_lock=0

# The lock is this process's only while it made the directory and no other owner file names
# another pid; an owner file not yet written (the instant after mkdir) still counts as its own.
holds_lock() {
  local owner_pid
  [ "$owns_lock" -eq 1 ] || return 1
  owner_pid="$(cut -d' ' -f1 "$LOCK_DIRECTORY/owner" 2> /dev/null)"
  [ -z "$owner_pid" ] || [ "$owner_pid" = "$$" ]
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
  if holds_lock; then
    rm -rf "$LOCK_DIRECTORY"
    owns_lock=0
  fi
}

# A signal ends the script: without the exit, a trap that only cleans up lets the wait loop go on.
stop_on_signal() {
  cleanup
  exit "$1"
}

trap cleanup EXIT
trap 'stop_on_signal 130' INT
trap 'stop_on_signal 143' TERM
touch "$ticket_path"

head_ticket() { ticket_names | head -1; }
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

# Only the head waiter reclaims a lock, so two waiters never remove each other's fresh lock. An
# owner file not yet written is a lock being taken, not a stale one.
reclaim_stale_lock() {
  local owner_pid
  owner_pid="$(cut -d' ' -f1 "$LOCK_DIRECTORY/owner" 2> /dev/null)"
  [ -n "$owner_pid" ] || return 0
  kill -0 "$owner_pid" 2> /dev/null || rm -rf "$LOCK_DIRECTORY"
}

# The sleep runs in the background and the script waits on it, so a signal ends the wait at once
# instead of after the whole poll interval.
pause() {
  sleep "$POLL_SECONDS" &
  sleeper=$!
  wait "$sleeper"
  sleeper=''
}

# A hold or battery power stops every class: the line prints when the reason changes, so a
# waiter's log shows why it waits without a line per poll.
waiting_reason=''
while :; do
  prune_stale_tickets
  reason="$(blocked_reason)"
  if [ -n "$reason" ]; then
    [ "$reason" = "$waiting_reason" ] || printf 'WAITING %s: %s\n' "$label" "$reason"
  elif [ "$(head_ticket)" = "$ticket_name" ] && reclaim_stale_lock && mkdir "$LOCK_DIRECTORY" 2> /dev/null; then
    owns_lock=1
    break
  fi
  waiting_reason="$reason"
  pause
done
printf '%s %s %s %s\n' "$$" "$command_name" "$label" "$worktree" > "$LOCK_DIRECTORY/owner"
rm -f "$ticket_path"

# A gate mutates the tip it was queued for, so a worktree that moved while the gate waited is
# refused: the queue never checks out another commit. The stale Stryker state of an earlier run
# is removed so the run starts from the diff, not from a half-finished one.
prepare_gate() {
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
  rm -f "$worktree/reports/stryker-incremental.json"
  rm -rf "$worktree/.stryker-tmp"
}

# caffeinate keeps the Mac awake for the run; a machine without it runs make directly.
start_gate_job() {
  local caffeinate_binary="${KIKO_QUEUE_CAFFEINATE:-caffeinate}"
  gate_log="$QUEUE_DIRECTORY/logs/gate-$label.log"
  mkdir -p "$QUEUE_DIRECTORY/logs"
  if command -v "$caffeinate_binary" > /dev/null 2>&1; then
    env -u FORCE_COLOR KIKO_MUTATION_BASE="$mutation_base" "$caffeinate_binary" -i \
      make -C "$worktree" deep > "$gate_log" 2>&1 &
  else
    env -u FORCE_COLOR KIKO_MUTATION_BASE="$mutation_base" \
      make -C "$worktree" deep > "$gate_log" 2>&1 &
  fi
}

# The job runs in the background and the script waits on it, so a trapped signal interrupts the
# wait at once instead of after the job. FORCE_COLOR breaks the node -p fingerprint stamps, so
# every job runs without it.
run_job() {
  case "$command_name" in
    verify) env -u FORCE_COLOR make -C "$worktree" verify & ;;
    check-all) env -u FORCE_COLOR npm --prefix "$worktree" run check:all & ;;
    security) (cd "$worktree" && exec env -u FORCE_COLOR npm run check:security) & ;;
    gate) start_gate_job ;;
  esac
  job=$!
  wait "$job"
  job_code=$?
  job=''
}

[ "$command_name" = gate ] && prepare_gate
started_at="$(iso_stamp)"
printf 'START %s at %s\n' "$label" "$(clock_time)"
run_job
[ "$command_name" = gate ] \
  && grep -E 'changed lines|CHANGE SET|GATE:|CHECK FAILED' "$gate_log" | tail -5
printf '%s %s %s %s %s\n' "$command_name" "$label" "$job_code" "$started_at" "$(iso_stamp)" \
  >> "$QUEUE_DIRECTORY/done.log"
printf 'DONE %s exit %s at %s\n' "$label" "$job_code" "$(clock_time)"
exit "$job_code"
