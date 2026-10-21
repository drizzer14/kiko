#!/usr/bin/env bash
# PreToolUse hook for the Bash tool: reads the tool_input JSON payload from
# stdin and forwards it to kill-guard.js, which parses/tokenizes the shell
# command and prints the documented deny JSON when it is dangerous (pkill,
# killall, a kill/pkill/killall reached through a pattern, or a
# process-group/broadcast kill), any `git stash` subcommand, a heredoc
# whose delimiter is not quoted, a git history change on the main checkout,
# any git command that moves the branch main (from any worktree of this repository),
# or a shell write (sed -i, perl -i, a redirect, tee, a python or node
# one-liner) into a guarded tree (WRITE_GUARDED_TREES in kill-guard.js) of a worktree of this
# repository, or a while/until wait loop that scans ps or pgrep -f for a heavy
# job (it matches its own command line and never ends). See kill-guard.js for
# the full rationale, .claude/skills/kiko-linter/SKILL.md for the rules, and
# docs/harness/checks.md "Automatic wiring" for the hook wiring.
#
# This wrapper is NOT a check (see .claude/skills/kiko-linter/SKILL.md for
# that contract) — it must ALWAYS exit 0, even if node is missing or the
# payload is malformed; a deny is the JSON on stdout, never the exit code.
# An error thrown while judging a command is a deny (`internalError`), because the command that
# crashed the guard may be the one it exists to stop. A node run that does not end cleanly is a
# deny too: kill-guard.js ends every run with exit 0, so any other status means the guard never got
# to judge (a sibling module it requires is missing, a syntax error, a crash while loading), and
# only this wrapper can say so, since the failure happens before kill-guard.js has any code to
# catch it. A malformed or unreadable payload, an empty command, and a missing node still allow, so
# a broken hook process never blocks the Bash tool.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || exit 0

# The trap removes the stderr file on a signal too; /dev/null is the fallback and stays.
errors=/dev/null
trap '[ "$errors" = /dev/null ] || rm -f "$errors"' EXIT
errors="$(mktemp 2>/dev/null)" || errors=/dev/null
output="$(node "$DIR/kill-guard.js" 2>"$errors")"
status=$?

if [ "$status" -eq 0 ]; then
  printf '%s' "$output"
else
  # The first Error line is the cause; node prints a file position before it. Quotes and
  # backslashes become apostrophes and every unprintable byte a '?', so the text is safe as JSON.
  cause="$(grep -m1 -E '^[A-Za-z]*Error' "$errors" 2>/dev/null || head -n 1 "$errors" 2>/dev/null)"
  detail="$(printf 'node exited with status %s: %s' "$status" "$cause" |
    tr -c '[:print:]' '?' | tr '"\\' "''" | cut -c1-240)"
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",'
  printf '%s' '"permissionDecisionReason":"'
  printf '%s' 'WHAT FAILED:    kill-guard could not load, so it could not judge this command.\n'
  printf 'DETAILS:        %s\\n' "$detail"
  printf '%s' 'WHY IT MATTERS: a guard that allowed every command while it could not load would '
  printf '%s' 'let through the very commands it exists to stop: pattern kills, stashes, '
  printf '%s' 'unchecked writes, and skipped hooks.\n'
  printf '%s' 'HOW TO FIX:     repair scripts/checks/kill-guard.js or the module named in DETAILS '
  printf '%s' 'with the Edit or Write tool (every Bash command is denied until it loads), or '
  printf '%s' 'report the error to the coordinator.\n'
  printf '%s' 'DO NOT:         wrap the command in a script file, an alias, or a variable to get '
  printf '%s' 'past this guard."}}'
fi
exit 0
