#!/usr/bin/env bash
# One queue for every heavy job across all worktrees.
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
  reason="$(blocked_reason)"
  if [ -n "$reason" ]; then
    [ "$reason" = "$waiting_reason" ] || printf 'WAITING %s: %s\n' "$label" "$reason"
  elif [ "$(head_ticket)" = "$ticket_name" ] && mkdir "$LOCK_DIRECTORY" 2> /dev/null; then
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
