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

queue_status() {
  printf 'queue empty\n'
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
owns_lock=0

holds_lock() {
  [ "$owns_lock" -eq 1 ] && [ "$(cut -d' ' -f1 "$LOCK_DIRECTORY/owner" 2>/dev/null)" = "$$" ]
}

cleanup() {
  rm -f "$ticket_path"
  if holds_lock; then
    rm -rf "$LOCK_DIRECTORY"
  fi
}

trap cleanup EXIT
touch "$ticket_path"

ticket_names() { ls "$TICKETS_DIRECTORY" 2>/dev/null | LC_ALL=C sort; }
head_ticket() { ticket_names | head -1; }
tickets_ahead() { ticket_names | awk -v mine="$ticket_name" '$0 == mine { exit } { count++ } END { print count + 0 }'; }

kind_text="$command_name"
if [ "$command_name" = gate ]; then
  kind_text="gate"
  [ "$job_class" -eq 3 ] && kind_text="gate --long"
  kind_text="$kind_text, size $job_size"
fi
printf 'QUEUED %s (%s) ahead: %s\n' "$label" "$kind_text" "$(tickets_ahead)"

until [ "$(head_ticket)" = "$ticket_name" ] && mkdir "$LOCK_DIRECTORY" 2>/dev/null; do
  sleep "$POLL_SECONDS"
done
owns_lock=1
printf '%s %s %s %s\n' "$$" "$command_name" "$label" "$worktree" > "$LOCK_DIRECTORY/owner"
rm -f "$ticket_path"

# The job runs in the background and the script waits on it, so a trapped signal interrupts the
# wait at once instead of after the job. FORCE_COLOR breaks the node -p fingerprint stamps, so
# every job runs without it.
run_job() {
  case "$command_name" in
    verify) env -u FORCE_COLOR make -C "$worktree" verify & ;;
    check-all) env -u FORCE_COLOR npm --prefix "$worktree" run check:all & ;;
    security) (cd "$worktree" && exec env -u FORCE_COLOR npm run check:security) & ;;
    gate) env -u FORCE_COLOR KIKO_MUTATION_BASE="$mutation_base" make -C "$worktree" deep & ;;
  esac
  job=$!
  wait "$job"
  job_code=$?
  job=''
}

started_at="$(iso_stamp)"
printf 'START %s at %s\n' "$label" "$(clock_time)"
run_job
printf '%s %s %s %s %s\n' "$command_name" "$label" "$job_code" "$started_at" "$(iso_stamp)" \
  >> "$QUEUE_DIRECTORY/done.log"
printf 'DONE %s exit %s at %s\n' "$label" "$job_code" "$(clock_time)"
exit "$job_code"
