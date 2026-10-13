#!/usr/bin/env bash
# One queue for every heavy job across all worktrees.
set -u

QUEUE_DIRECTORY="${KIKO_QUEUE_DIR:-$HOME/.claude/kiko-queue}"

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

queue_status() {
  printf 'queue empty\n'
}

valid_label() {
  case "$1" in
    '' | *[!A-Za-z0-9._-]*) return 1 ;;
  esac
}

[ "$#" -ge 1 ] || usage
command_name="$1"

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
    ;;
  *)
    usage "unknown command: $command_name"
    ;;
esac

worktree="$2"
label="$3"
valid_label "$label" || usage "invalid label: $label"
[ -d "$worktree" ] || usage "not a directory: $worktree"
