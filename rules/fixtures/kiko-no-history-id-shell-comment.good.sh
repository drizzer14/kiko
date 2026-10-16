#!/usr/bin/env bash
set -uo pipefail

# Semgrep fixture (NEGATIVE): `kiko-no-history-id-shell-comment` and every other rule MUST report
# zero findings from this file.

# The retry count is three because the first two attempts race the lock holder.
attempts=3

# A hash that is not a comment line never opens a match.
echo "# Bug 12 is a string here, not a comment"
count=$#
length=${#attempts}
quoted='# Task 7 in single quotes'

# A standard name that reads like an id is not one: SHA-256 and P-256 stay silent.
digest=sha256

# A git flag is not an id: git diff -U0 keeps the hunks tight, -U12 widens them, git log -M3 follows
# renames.
context=0
