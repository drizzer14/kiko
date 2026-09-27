#!/usr/bin/env bash
# PreToolUse hook for Edit/Write/MultiEdit: reads the tool_input JSON
# payload from stdin and forwards it to pre-write-guard.js, which rebuilds
# the proposed file content and denies the write when it introduces a known
# violation. See pre-write-guard.js for the checks it runs and
# CLAUDE.md's "Automatic wiring" note for the hook wiring
# (harness/kiko/hooks/hooks.json, through hooks/dispatch.sh).
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
# A crashing node (or its own multi-line stack trace) can put raw newlines,
# tabs, or carriage returns into $reason. Those are illegal unescaped inside
# a JSON string, so collapse them to spaces for the JSON copy BEFORE
# backslash/quote-escaping it below — $reason itself stays untouched (raw
# newlines and all) for the plain-text copy printed to stderr afterward.
jsonReason="$(printf '%s' "$reason" | tr '\n\r\t' '   ')"
escapedReason="$(printf '%s' "$jsonReason" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
denyJSON="$(cat <<JSON
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"$escapedReason"}}
JSON
)"
printf '%s' "$denyJSON"
printf '%s\n' "$reason" >&2
exit 2
