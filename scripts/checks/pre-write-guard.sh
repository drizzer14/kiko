#!/usr/bin/env bash
# PreToolUse hook for Edit/Write/MultiEdit: reads the tool_input JSON
# payload from stdin and forwards it to pre-write-guard.js, which rebuilds
# the proposed file content and denies the write when it introduces a known
# violation. See pre-write-guard.js for the checks it runs and
# CLAUDE.md's "Automatic wiring" note for the hook wiring (wired in a later
# task once the rule set that makes this guard useful lands alongside it).
#
# Fail closed: pre-write-guard.js already exits 0 (allow) or 2 (deny — with
# the deny JSON on its own stdout and the reason on its own stderr). This
# wrapper passes both of those codes straight through. Any OTHER exit code —
# node crashing, or node missing entirely — means the guard itself could not
# run, which this wrapper treats the same as a deny: it is never safe to let
# an unchecked write through just because the checker broke.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

stdoutFile="$(mktemp)"
stderrFile="$(mktemp)"
trap 'rm -f "$stdoutFile" "$stderrFile"' EXIT

node --experimental-strip-types --no-warnings "$DIR/pre-write-guard.js" \
  >"$stdoutFile" 2>"$stderrFile"
exitCode=$?

if [ "$exitCode" -eq 0 ]; then
  cat "$stdoutFile"
  exit 0
fi

if [ "$exitCode" -eq 2 ]; then
  cat "$stdoutFile"
  cat "$stderrFile" >&2
  exit 2
fi

reason="$(printf 'pre-write guard crashed (exit %s): %s' "$exitCode" "$(tail -c 2000 "$stderrFile")")"
escapedReason="$(printf '%s' "$reason" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
denyJSON="$(cat <<JSON
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"$escapedReason"}}
JSON
)"
printf '%s' "$denyJSON"
printf '%s\n' "$reason" >&2
exit 2
