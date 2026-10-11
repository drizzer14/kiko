#!/usr/bin/env bash
# PreToolUse hook for the Bash tool: reads the tool_input JSON payload from
# stdin and forwards it to kill-guard.js, which parses/tokenizes the shell
# command and prints the documented deny JSON when it is dangerous (pkill,
# killall, a kill/pkill/killall reached through a pattern, or a
# process-group/broadcast kill), any `git stash` subcommand, a heredoc
# whose delimiter is not quoted, a git history change on the main checkout,
# or a shell write (sed -i, perl -i, a redirect, tee, a python or node
# one-liner) into src/, __tests__/, rules/, or e2e/ of a worktree of this
# repository, or a while/until wait loop that scans ps or pgrep -f for a heavy
# job (it matches its own command line and never ends). See kill-guard.js for
# the full rationale and CLAUDE.md's "Automatic wiring" note for the hook
# wiring.
#
# This wrapper is NOT a check (see .claude/skills/kiko-linter/SKILL.md for
# that contract) — it must ALWAYS exit 0, even if node is missing or the
# payload is malformed, so a broken guard never blocks the Bash tool itself.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$DIR/kill-guard.js" 2>/dev/null
exit 0
