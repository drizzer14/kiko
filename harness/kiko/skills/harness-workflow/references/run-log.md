## Run log

Every orchestrator session keeps a run folder, written with `run-log.mjs` (plain Node, no
dependencies; it must stay byte-identical to the harness repo's copy), called as
`node "${CLAUDE_PLUGIN_ROOT}/scripts/run-log.mjs" <command> ...`. Run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/run-log.mjs"` with no arguments for the exact usage;
write only the flags it lists. Runs live under
`${HARNESS_RUNS_DIR:-$HOME/.claude/harness-runs}/<runId>/` (`run.json`, `events.jsonl`,
`summary.json`), outside every worktree. Every command refreshes
`${HARNESS_RUNS_DIR:-$HOME/.claude/harness-runs}/bin/run-log.mjs`, a copy a project skill can
call without knowing where the plugin lives.

- **start**: once per "<track> task N/M", when its shape is known (`--task`, `--shape`; an Orca
  worker adds `--orca-task` and `--orca-dispatch`). It prints the run id on stdout. Keep the id
  in the worktree handoff file (`.superpowers/sdd/<track>/HANDOFF.md`), so a handed-over session
  writes to the same run.
- **event**: one per verdict, as it happens. Pass `--step N` ("step N/M", an integer) on EVERY
  event of a step, the human, stall and timeout events too: an event without it falls into a
  separate `-` row and the step's chain row shows Stalls 0 and Human rounds 0. Kiko mappings:
  - the developer's report: `--gate commit --verdict pass --role developer` (a fix round's
    report too); put the dispatch time and the estimate in `--note` on the step's first event;
  - `check:all`: `--gate check --verdict pass` or `--gate check --verdict fail`;
  - the queued verify or the full jest: `--gate test --verdict pass` or
    `--gate test --verdict fail`;
  - the queued gate (the coordinator who queues it logs it): `--gate deep --verdict pass` or
    `--gate deep --verdict fail`;
  - `kiko:reviewer` APPROVE: `--gate review --verdict approve`; FIX FIRST: `--gate review
    --verdict changes`; both with `--findings N` and `--mechanizable N` counted from the
    "Classify every finding" tags;
  - a human ruling relayed by the coordinator: `--gate human --verdict approve` or
    `--gate human --verdict changes`;
  - a stall (an agent past its estimate with no report): `--gate stall --verdict stall`;
  - a `wait-load.sh` or ops timeout: `--gate test --verdict timeout` or
    `--gate deep --verdict timeout`; a gate that did not run: `--gate check --verdict skipped`
    (or the gate that was skipped);
  - a wait (battery, load, usage limit, the user): `--gate wait --verdict pass --reason <battery|load|usage-limit|user> --minutes <N>`,
    or `--verdict timeout` when the wait ran out; log it when the wait ends, with the step (or
    group) of the work it interrupts. A wait event needs `--step N` or `--group N`; the command
    refuses a wait without one (exit 2). Tag a wait with the step of the last event before it.
    N is the waited minutes (for example from the last event's ts). Only the other gates
    (human, stall, timeout) land in the `-` row when they have no step;
  - the retrospect: `--gate retro --verdict pass`.
- **finish**: at BATCH READY (`--outcome done`), or when the track is blocked or aborted
  (`--outcome blocked` or `--outcome aborted`). `--recorded` and `--gaps` come from the
  retrospect's report. `--archive <dir>` MOVES every regular file directly in `<dir>` into the
  run's `artifacts/`; point it only at the session scratch folder, never a worktree root
  (`--archive .` would move `package.json` and `CLAUDE.md`). Before the merge, the coordinator
  checks that the run's `summary.json` exists; a run with no summary did not finish its
  bookkeeping. A `deep` event logged after `finish` is expected: `stats` shows it, but
  `summary.json` `totals` do not include it.
- **gap**: `gap --run <id> --open <text>` records an open gap and prints `<runId>/<n>`;
  `gap --run <id> --close <gapId> [--note <text>]` closes it. Open gaps one call at a
  time; never make parallel calls on one run. `stats --gaps --repo kiko`
  (add `--format md`, `tsv` or `json`) lists open gaps only, read from `<root>/gaps/<repo>.jsonl`.
- **start and finish rule**: every orchestrator starts a run before a task's first dispatch and
  finishes it at that task's BATCH READY. At a handover the run id goes into the worktree
  HANDOFF.md and the successor keeps writing to it.
- **stats**: `stats --repo kiko --format md` prints one row per review chain. The repo slug is
  the origin remote's repo name (`drizzer14/kiko.git` -> `kiko`), not the checkout folder;
  `--repo pff-ios` matches nothing and prints only the header. `Minutes` is the span from a
  step group's first verdict to its last (the developer's work before the first verdict is not
  counted; a one-event step shows 0); `Wait` is the sum of the group's wait events; `Work` =
  `Minutes` - `Wait`, never below 0. For a dispatch-to-BATCH-READY time use
  run.json `startedAt` to `summary.json` `finishedAt`. A run with no `summary.json` and no event
  for 24 hours shows as `abandoned`. The coordinator runs `finish --outcome aborted` for a
  track it stops, in the same turn as the worktree prune.

BATCH READY's TIMES line is built from the run log, never from memory. The source of each
field is listed in `kiko:estimator` only.

A project skill outside the plugin calls the installed copy. When the copy is missing, both
snippets print `run-log: not installed, skipped` and exit 0; when the copy is present, its own
exit code and error pass through. Start (prints the run id):

```bash
RUN_LOG="${HARNESS_RUNS_DIR:-$HOME/.claude/harness-runs}/bin/run-log.mjs"; if [ -f "$RUN_LOG" ]; then node "$RUN_LOG" start --task "<track> task N/M" --shape build; else echo "run-log: not installed, skipped"; fi
```

Finish, in a later Bash call (shell variables do not survive between calls), prefixed with
`RUN_ID=<printed id>;`. When start printed the skip line, there is no run id: skip the finish
snippet, never paste the skip line as `RUN_ID`:

```bash
RUN_LOG="${HARNESS_RUNS_DIR:-$HOME/.claude/harness-runs}/bin/run-log.mjs"; if [ -f "$RUN_LOG" ]; then node "$RUN_LOG" finish --run "$RUN_ID" --outcome done; else echo "run-log: not installed, skipped"; fi
```
