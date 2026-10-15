#!/usr/bin/env bash
set -uo pipefail

# Semgrep fixture (POSITIVE): kiko-code-style's "Comments: WHY only, never history" bans a task,
# review, bug or plan id left behind in a comment. `kiko-no-history-id-shell-comment` MUST report a
# finding on each pinned line below.

# EXPECT-FINDING
# Bug 12 is why the retry sits here.
attempts=3

# EXPECT-FINDING
# Task 7 added this guard.
limit=10

# EXPECT-FINDING
# The wait is capped (P2) so a stuck job cannot hold the queue.
cap=30

# EXPECT-FINDING
  # Indented, and cited from Section 4.2 of the spec.
nested=1

# EXPECT-FINDING
# The cap came from T-12 after the review.
review=1

# EXPECT-FINDING
# A bare U0 is a task id, not a git flag.
bare=1

# EXPECT-FINDING
# The hyphen after the letter keeps U-3 an id.
hyphen=1

# EXPECT-FINDING
# The retry window is fixed in review M3.
citation=1
