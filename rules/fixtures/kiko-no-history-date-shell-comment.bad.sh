#!/usr/bin/env bash
set -uo pipefail

# Semgrep fixture (POSITIVE): kiko-code-style's "Comments: WHY only, never history" bans a date
# attached to a ruling, a finding, or a plan left behind in a comment.
# `kiko-no-history-date-shell-comment` MUST report a finding on each pinned line below.

# EXPECT-FINDING
# The queue holds on battery (user-approved 2026-10-08), so no job starts.
power=hold

# EXPECT-FINDING
# One group kill is allowed by user ruling 2026-10-08, and only for the queue's own job.
group=own

# EXPECT-FINDING
# The wait is capped; confirmed 2026-09-12 on the busy machine.
cap=30

# EXPECT-FINDING
# The pipe closes early (probed 2026-10-06) when the reader exits.
pipe=early

# EXPECT-FINDING
# Device finding: the load stays high while the CPU idles.
load=high

# EXPECT-FINDING
  # Decided on 2026-10-08 with the other captions.
nested=1
