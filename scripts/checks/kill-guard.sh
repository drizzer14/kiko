#!/usr/bin/env bash
# PreToolUse hook for the Bash tool: reads the tool_input JSON payload from
# stdin and forwards it to kill-guard.js, which parses/tokenizes the shell
# command and prints the documented deny JSON when it is dangerous (pkill,
# killall, a kill/pkill/killall reached through a pattern, or a
# process-group/broadcast kill), any `git stash` subcommand, or a heredoc
# whose delimiter is not quoted. See kill-guard.js for the full rationale
# and CLAUDE.md's "Automatic wiring" note for the hook wiring.
#
# This wrapper is NOT a check (see .claude/skills/kiko-linter/SKILL.md for
# that contract) — it must ALWAYS exit 0, even if node is missing or the
# payload is malformed, so a broken guard never blocks the Bash tool itself.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$DIR/kill-guard.js" 2>/dev/null
exit 0
