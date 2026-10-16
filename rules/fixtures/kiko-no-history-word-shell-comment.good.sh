#!/usr/bin/env bash
set -uo pipefail

# Semgrep fixture (NEGATIVE): `kiko-no-history-word-shell-comment` and every other rule MUST report
# zero findings from this file.

# The wait reads a flag file, so it never touches the process table.
wait_mode=file

# A runtime state is named as the state it is: the lock is gone once the job ends.
lock=state

# A hash that is not a comment line never opens a match.
echo "# the loop no longer polls"
note='# previously noted'
