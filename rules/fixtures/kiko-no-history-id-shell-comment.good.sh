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

# A set, task, heading or question word beside a number that is ordinary prose is not a history id.
# The Q2 tabs-vs-chips rule decides the layout.
questionRule=1
# Q2 2026 is the quarter the data covers.
quarterYear=1
# In a pool, task 0 settles before the rest.
taskZero=1
# Pass set 0 to disable the limit.
setZero=1
# In a pool, task 0 settles before set 0 does.
taskZeroBeforeSetZero=1
# The page opens on the (H1) heading.
headingOne=1
# The page opens on the (H3) section.
headingThree=1
# H264 is the video codec.
codec=1
# H2 database engines are listed.
databaseEngine=1
# Pick a set of 3 colors.
setOfThree=1
# Show set 3 steps at a time.
setSteps=1
# Retry up to the task 3 of 3 retries.
taskOfThree=1
# The FQDN names the host; AS12-Q3 and S12-Quality are no ruling id, nor is a bare S12 or Q3.
rulingIdNearMiss=1
# A c-nr-e flag and a C-NR with no clause after it are no clause id.
clauseIdNearMiss=1
