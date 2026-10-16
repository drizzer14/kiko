#!/usr/bin/env bash
set -uo pipefail

# Semgrep fixture (NEGATIVE): `kiko-no-history-date-shell-comment` and every other rule MUST report
# zero findings from this file.

# A date that is data stays: the fixture day 2026-03-29 is the spring DST change in Kyiv.
day=2026-03-29

# The queue holds on battery, so no job starts while unplugged.
power=hold

# A hash that is not a comment line never opens a match.
echo "# ruled 2026-10-08"
note='# approved 2026-10-08'
