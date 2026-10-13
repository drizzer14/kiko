---
name: estimator
description: Use when giving the user a duration or ETA for any dispatched work (an orchestrator task, a review, a fix round, a mutation window, a build/deploy), and when a task or mutation window finishes (to log its real time).
---

Quote measured history, never an agent's own guess. Two sources:
- The run log: `node "${CLAUDE_PLUGIN_ROOT}/scripts/run-log.mjs" stats --format md` (add
  `--since YYYY-MM-DD`, and `--repo kiko`: the slug is the origin remote's repo name, not
  `pff-ios`). Quote `Work`, not `Minutes`: `Work` is `Minutes` (a step group's first
  logged verdict to its last) minus `Wait` (the sum of its wait events: battery, load, usage
  limit, user), which is excluded. Developer work before the first verdict is not counted and
  a one-event step shows 0; for a
  dispatch-to-BATCH-READY time use run.json `startedAt` to summary.json `finishedAt`. Each row
  gives minutes, rounds to first approve, check/test retries, stalls and human rounds (see `harness-workflow`'s "Run log").
- The duration log at `memory/refs/duration-log.md` in the main checkout. It stays: it holds
  the mutation windows and the history from before the run log.
Read both side by side.

Rules:
- Every dispatch states an estimate AND its source (which `stats` row(s) and/or
  duration-log row(s) it came from, or "no similar row" plus a wide range).
- The estimate comes from the most similar rows of the two sources (same
  item type, similar size; `stats` rows have no task/shape/size columns, so match them via
  run.json `task`/`shape`) — never from an agent's own guess. An agent's
  own stated estimate ("60-90 min") is a data point for the log, not a
  number to relay to the user as the estimate.
- If no similar row exists, say so explicitly and give a wide range rather
  than inventing precision.
- Every BATCH READY carries a TIMES line, built from the run log, not hand-written. Sources:
  dispatch time and estimate = the dispatch message (also put them in the step's first event
  `--note`); developer done and fix round done = the event `--gate commit --verdict pass
  --role developer --step N`; review times = the review events' `ts`; BATCH READY = the
  `finish` time. `ts` is UTC ISO; the line uses local HH:MM: "developer dispatched HH:MM
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
- Mutation (`make deep` / Stryker), whole-file history: these file counts
  predate changed-line runs, which mutate only the changed lines. The
  driver is now `changed lines:` from `make mutable`, not the file count;
  quote a changed-line run from the log once it has rows. Measured
  2026-10-03:
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
small script that prints an estimate for a given item type and size. `run-log.mjs stats`
already prints the measured run rows; until then, pick the most similar duration-log rows
by hand and match `stats` rows through run.json `task`/`shape`.
