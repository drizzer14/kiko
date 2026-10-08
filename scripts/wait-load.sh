#!/usr/bin/env bash
# Waits until the machine's 5-minute load average is below <max>, so a heavy command (make verify,
# check:all, a jest-heavy agent) starts on a quiet machine and its Semgrep scans do not time out.
#
# Usage: wait-load.sh <max> [timeout-seconds]      (the timeout defaults to 3600)
#
# The 5-minute average is the second number of `sysctl -n vm.loadavg` ("{ 1.20 3.45 4.01 }"); a
# locale that prints a comma decimal ("3,45") reads the same. The wait polls with `sleep`, never
# `pgrep`: a poll loop that greps process names matches its own command line and never ends.
# Run it in the background and wait on its exit code; it prints one start line when it has to
# wait and nothing else until it ends.
#
# Exit 0: the 5-minute average is below <max>. Exit 2: the timeout passed first. Exit 3: the load
# average could not be read. Exit 64: bad usage, timeout, or poll interval.
#
# Test seam: KIKO_WAIT_LOAD_INTERVAL is the whole seconds between polls (default 30).
set -uo pipefail

usage() {
  printf 'usage: wait-load.sh <max> [timeout-seconds]\n' >&2
  exit 64
}

# A plain non-negative decimal, with a dot or a comma.
is_number() {
  case "$1" in
    '' | *[!0-9.,]* | *[.,]*[.,]*) return 1 ;;
    *[0-9]*) return 0 ;;
    *) return 1 ;;
  esac
}

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || usage

max="${1//,/.}"
timeout_seconds="${2:-3600}"
interval="${KIKO_WAIT_LOAD_INTERVAL-30}"

is_number "$max" || usage

bad_value() {
  printf 'wait-load: %s must be %s, got "%s"\n' "$1" "$2" "$3" >&2
  exit 64
}

case "$timeout_seconds" in
  '' | *[!0-9]*) bad_value "the timeout argument" "a whole number of seconds" "$timeout_seconds" ;;
esac
case "$interval" in
  '' | *[!0-9]* | 0*) bad_value KIKO_WAIT_LOAD_INTERVAL "a positive whole number of seconds" "$interval" ;;
esac

# Prints the 5-minute load average with a dot decimal, or returns 1 when it cannot be read.
read_load() {
  local raw load
  raw="$(sysctl -n vm.loadavg 2>/dev/null)" || return 1
  raw="${raw//[\{\}]/}"
  raw="${raw//,/.}"
  set -- $raw
  load="${2:-}"
  is_number "$load" || return 1
  printf '%s\n' "$load"
}

below_max() {
  awk -v load="$1" -v max="$max" 'BEGIN { exit !(load + 0 < max + 0) }'
}

started="$SECONDS"
announced=0

while :; do
  if ! load="$(read_load)"; then
    printf 'wait-load: could not read the 5-minute load average from sysctl -n vm.loadavg\n' >&2
    exit 3
  fi

  if below_max "$load"; then
    exit 0
  fi

  if [ "$((SECONDS - started))" -ge "$timeout_seconds" ]; then
    printf 'wait-load: timed out after %ss: the 5-minute load average is %s, not below %s\n' \
      "$timeout_seconds" "$load" "$max" >&2
    exit 2
  fi

  if [ "$announced" -eq 0 ]; then
    printf 'wait-load: waiting for the 5-minute load average to drop below %s (now %s, timeout %ss)\n' \
      "$max" "$load" "$timeout_seconds"
    announced=1
  fi

  sleep "$interval"
done
