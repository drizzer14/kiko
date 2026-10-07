---
name: estimator
description: Use when giving the user a duration or ETA for any dispatched work (an orchestrator task, a review, a fix round, a mutation window, a build/deploy), and when a task or mutation window finishes (to log its real time).
---

Quote measured history, never an agent's own guess. The source of truth is
the duration log at
`memory/refs/duration-log.md` in the main checkout.

Rules:
- Every dispatch states an estimate AND its source (which row(s) of the
  log it came from, or "no similar row" plus a wide range).
- The estimate comes from the most similar rows of the duration log (same
  item type, similar size) — never from an agent's own guess. An agent's
  own stated estimate ("60-90 min") is a data point for the log, not a
  number to relay to the user as the estimate.
- If no similar row exists, say so explicitly and give a wide range rather
  than inventing precision.
- Every BATCH READY carries a TIMES line: "developer dispatched HH:MM
  (estimate X-Y min), developer done HH:MM, review done HH:MM, fix round
  done HH:MM, re-review done HH:MM, BATCH READY HH:MM".
- The coordinator appends one row per finished task and per mutation
  window to the log, columns: Date, Track/item, Size, Estimate (source),
  Actual, Ratio, Notes — with the step split (dev/review/fix/re-review/gate
  minutes) in Notes.
- Mutation-specific: time grows faster than the file count, and with
  machine load. Renamed and comment-only files add few mutants. Stryker's
  own start-of-run ETA is unreliable — quote it only after the run has
  reached roughly 10% progress. A dry run can time out under load
  ("Initial test run timed out") — re-run it rather than treating the
  timeout as a result. Never run a 25-30-file mutation window beside heavy
  agent work (a planner session, a full jest run, a build) — queue it
  instead.
- Report a miss honestly: state the estimate and the actual side by side,
  and record the lesson in the log row's Notes (for example "ran beside a
  heavy planner agent", "renames add few mutants").

## Current numbers (snapshot, 2026-10-03 — the log is the source)

- Orchestrator small change set (developer + review + fix round + gate):
  dispatch-to-BATCH-READY is around 40 minutes once sized from history;
  an agent's own stated estimate ("60-90 min") runs roughly 2x high.
- Mutation (`make deep` / Stryker), file count to wall-clock time, all
  measured 2026-10-03:
  - 1-3 files: 2-12 min
  - 20 files: 94 min
  - 24 files: 113 min
  - 26 files: 192 min
  - 30 files: 523 min, run beside a heavy planner agent (load matters
    as much as file count)
- Mutation 10-14 files: 58-119 min; 23-25 files: 206-224 min; a re-run after
  a tests-only floor fix: ~24 min (incremental).
- Merge-result `make verify` on a quiet machine: 7-9 min.
- Rule reversal touching many tests: x1.5-2; hook-code task (kill-guard):
  x1.7-2.6 of the agent estimate.
- Stryker's start-of-run ETA is unreliable (~7 h quoted for a 224 min run).

These are a snapshot of a small sample, not a formula — always re-check
against the log's current rows, which may have more by the time you read
this.

## Plan: once the log has ~20-30 rows

Add per-item-type medians to this section, and, if it earns its keep, a
small dependency-free script that reads the log and prints an estimate
for a given item type and size. Until then, read the log directly and
pick the most similar rows by hand.
