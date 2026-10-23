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

# EXPECT-FINDING
# The cap was fixed in review-M3.
wordHyphenId=1

# EXPECT-FINDING
# Step-T12 set it.
wordHyphenIdAtStart=1

# EXPECT-FINDING
# Fixed in set 3/5: the retry sits here.
setFraction=1

# EXPECT-FINDING
# Added after the set 9 review: the retry sits here.
setReview=1

# EXPECT-FINDING
# Added in the set 2 fix round: the retry sits here.
setFixRound=1

# EXPECT-FINDING
# Added in H10 task 4/4: the retry sits here.
trackTaskFraction=1

# EXPECT-FINDING
# Added in H9 t3: the retry sits here.
trackShortTask=1

# EXPECT-FINDING
# Added in H10 set 3: the retry sits here.
trackSet=1

# EXPECT-FINDING
# Added in the H7 backlog item: the retry sits here.
trackBacklog=1

# EXPECT-FINDING
# Added by 20261023T0023-kiko-harness-h10/1: the retry sits here.
runId=1

# EXPECT-FINDING
# Added in task 2/3: the retry sits here.
taskFraction=1

# EXPECT-FINDING
# Added after the task 3 review: the retry sits here.
taskReview=1

# EXPECT-FINDING
# Q2 = A: the retry sits here.
decisionAnswer=1

# EXPECT-FINDING
# Added in H10 Set 3: the retry sits here.
trackCapitalSet=1
