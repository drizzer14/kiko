#!/usr/bin/env bash
# Appends ONE stamped line to the coordinator event log AND pushes the same line to the Status
# terminal, so a logged milestone always reaches Status (no polling, no separate message to forget).
#
# Usage: bash scripts/log-event.sh "<event text>"      (one argument, the whole line; no option)
#
# The script stamps the time itself from `date +%H:%M` and writes `- HH:MM <event text>`. A leading
# `- HH:MM ` the caller typed is replaced by the current time and one stderr note names both times,
# because a time typed from memory is the bug this script removes; a leading `- ` with no time is
# only stamped. There is no way to pass a time. No argument, an empty line (or one that is empty
# once a leading stamp is removed) and a newline inside the line print a failure block and exit 2,
# appending and pushing nothing.
#
# The log and the Status handle live in the MAIN checkout, the first `worktree` entry of
# `git worktree list --porcelain` of this script's own repository (as scripts/ff-main.sh finds it),
# so a run from a linked worktree never creates a memory folder there. A missing handle file, an
# empty one, or a failed push logs the line, names the cause on stderr and exits 1.
#
# memory/refs/log-event.sh (gitignored, main checkout only) becomes an `exec` shim to this script;
# the coordinator does that, and the callers keep their command line.
set -uo pipefail

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIRECTORY/checks/_lib.sh"

CHECK_NAME='log-event.sh'
LOG_NAME='night-summary-2026-10-17.md'
HANDLE_NAME='status-terminal.txt'
STAMP_PATTERN='^-[[:space:]]+([0-9][0-9]:[0-9][0-9])([[:space:]]+(.*))?$'
DASH_PATTERN='^-[[:space:]]+(.*)$'

# fail <what> <details> <why> <how to fix>
fail() {
  print_block "$CHECK_NAME" "$1" "$2" "$3" "$4" 'pass a time, edit the log by hand, or add a bypass'
  exit 2
}

# usage_failure <what> <details>
usage_failure() {
  fail \
    "$1" \
    "$2" \
    'The line is stamped, appended and pushed whole, so an empty or multi-line event has no meaning.' \
    'Run: bash scripts/log-event.sh "<one line of event text>"'
}

if [ "$#" -ne 1 ]; then
  usage_failure 'log-event.sh takes exactly one argument: the event text' "got $# argument(s)"
fi

line="$1"
case "$line" in
  '') usage_failure 'The event text is empty' 'got an empty argument' ;;
  *$'\n'*) usage_failure 'The event text holds a newline; the log takes one line per event' \
    'got a multi-line argument' ;;
esac

event="$line"
passed_time=''
if [[ "$line" =~ $STAMP_PATTERN ]]; then
  passed_time="${BASH_REMATCH[1]}"
  event="${BASH_REMATCH[3]}"
elif [[ "$line" =~ $DASH_PATTERN ]]; then
  event="${BASH_REMATCH[1]}"
fi
if [ -z "$event" ]; then
  usage_failure 'The event text is empty after the leading stamp' "got: $line"
fi

now="$(date +%H:%M)"
if [ -n "$passed_time" ]; then
  printf 'log-event: replaced the passed time %s with the current time %s\n' \
    "$passed_time" "$now" >&2
fi
stamped="- $now $event"

main_checkout="$(git -C "$SCRIPT_DIRECTORY" worktree list --porcelain 2> /dev/null \
  | awk '/^worktree / { sub(/^worktree /, ""); print; exit }')"
if [ -z "$main_checkout" ] || [ ! -d "$main_checkout" ]; then
  fail \
    'The main checkout cannot be found' \
    "git worktree list --porcelain in $SCRIPT_DIRECTORY named: ${main_checkout:-nothing}" \
    'The log and the Status handle live in the first worktree of the script'"'"'s own repository.' \
    'Run the script from a checkout of the repository: bash scripts/log-event.sh "<event text>"'
fi

reference_directory="$main_checkout/memory/refs"
if ! printf '%s\n' "$stamped" >> "$reference_directory/$LOG_NAME"; then
  echo "log-event: could not append to $reference_directory/$LOG_NAME; nothing pushed" >&2
  exit 1
fi

handle="$(cat "$reference_directory/$HANDLE_NAME" 2> /dev/null)"
if [ -z "$handle" ]; then
  echo "log-event: no Status handle in $reference_directory/$HANDLE_NAME; line logged only" >&2
  exit 1
fi

if ! orca terminal send --terminal "$handle" --enter --text "STATUS PUSH: $stamped" --json \
  > /dev/null 2>&1; then
  echo "log-event: push to $handle failed; line logged only" >&2
  exit 1
fi
