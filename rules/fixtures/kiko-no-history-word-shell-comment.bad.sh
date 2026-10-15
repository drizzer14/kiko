#!/usr/bin/env bash
set -uo pipefail

# Semgrep fixture (POSITIVE): kiko-code-style's "Comments: WHY only, never history" bans a comment
# that narrates a change. `kiko-no-history-word-shell-comment` MUST report a finding on each pinned
# line below.

# EXPECT-FINDING
# The wait no longer polls the process table.
wait_mode=file

# EXPECT-FINDING
# It replaces the loop that scanned every process.
scan=none

# EXPECT-FINDING
# The lock used to live under the temporary directory.
lock=state

# EXPECT-FINDING
# Previously the gate ran before the queue.
order=queue

# EXPECT-FINDING
# The tests stay kept green by this order.
green=1

# EXPECT-FINDING
    # Behaves as before, with the same exit code.
exit_code=2
