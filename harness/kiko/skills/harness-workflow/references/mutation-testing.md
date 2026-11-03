## Mutation testing: small change sets only

Status: the per-change-set gate below is paused by the user since 2026-10-25 until lifted;
verify + review only. The gate text stays for when the user lifts the pause.

Strict scope (user ruling 2026-10-25, every track): a track fixes only visible wrong data or
UI, its own regressions, wrong texts, and release requirements. Everything else goes to a
per-track backlog file. Classify a finding this way before asking the user about it, so the
user sees only real decisions.

Batch merge: several READY, reviewed tracks with a clean `git merge-tree` may merge together
onto main. Merge them in one detached worktree with a real `git merge` (hooks run), run ONE
queued verify on the result, then `bash scripts/ff-main.sh <sha>`. One verify replaces one per
track.

Status is on demand (user 2026-10-26): there is no Status session, no long-lived PM and no
`EVENT:` push. The coordinator spawns a fresh `kiko:pm` only when the user asks for status; the
HANDOFF.md table is the open-loop record.

Mutation testing (`check:deep` / `check:mutation`) runs per SMALL change
set, never on a whole project or a whole release — a whole-release run
went 10 h 16 min with no result. There is no whole-release or
end-of-integration deep gate. Run it on each change set with
`KIKO_MUTATION_BASE` set to that change set's own base commit.
`scripts/checks/mutation.sh` exits 2 before Stryker starts when more
than 30 files would be mutated (`MUTATION_FILE_CAP`);
`KIKO_MUTATION_FULL=1` and a `KIKO_MUTATION_BASE` that does not resolve
are refused directly (exit 2), and no env var bypasses the cap.
See the `ops` skill for how to launch and await a run. A gate whose done.log exit is 2 and whose
only failure is osv with the tracked CVEs (`docs/harness/dependency-hygiene.md`) is a PASS for
the mutation part; read the CHANGE SET TOTAL and per-file lines in its gate log.

Who and when (coordinator ruling, 2026-09-27): the COORDINATOR runs
`bash scripts/job-queue.sh gate <worktree> <label> <base sha> <head sha>` (run_in_background)
for each reviewed change set (<= 30 source files), before its merge into next. A typed
`make deep` is denied; `KIKO_MUTATION_BASE=<base sha> make mutable` stays allowed for the file
count.
Orchestrators never run it. The orchestrator's batch-ready report (the
message that tells the coordinator a change set is reviewed and ready
to merge) names the change set's base sha and the run id (the coordinator works in the main
checkout and cannot see the worktree's gitignored HANDOFF.md), and confirms the file count
after excludes is within `MUTATION_FILE_CAP` (read it in
`scripts/checks/mutation.sh`); a larger batch splits into change sets
with their own bases. Count with the gate's own filter, never by hand:
`KIKO_MUTATION_BASE=<base sha> make mutable` (it runs
`mutation.sh --list`) prints each file's changed-line ranges, `changed lines: N`, and
`mutable files: N (cap …)`, then a `timeout share (history)` line (quote it in the BATCH READY: a high share predicts a long run),
exits 2 above the cap, and never starts Stryker or takes its lock. A
change set with 0 mutable files gets no mutation run: `mutation.sh`
exits 0 on 0 files without starting Stryker. A changed file whose diff
is only comments or whitespace is left out of that count by the script
itself (it prints `skipped (comment-only): <path>`; a file with no added line
prints `skipped (no added lines): <path>`); a `Stryker` or JSX
pragma comment, or any doubt, keeps the file; a changed colocated test beside a
comment-only source does not.

The BATCH READY quotes the CHANGE SET TOTAL line split (read it from the gate output) and any
TIMEOUT-HEAVY file with how it was cleared. A TIMEOUT-HEAVY file (rule and constants in
`scripts/checks/mutation-score.js`) is cleared by the gate itself: when it is the only
failure, the gate reruns the timed-out mutants alone and the final rerun report is the
verdict. Only if that report still fails or the rerun was skipped does the BATCH READY
carry the failed gate with each timed-out mutant proven in plain jest or written as
equivalent (`docs/harness/checks.md`, "Clearing a TIMEOUT-HEAVY file"). Proof tables are the
fallback for a REAL timeout only: the standing jest-runner patch removed the regex cost that
made heavy mutants time out. A gate scratch needs `npm ci` so the patch is applied; the
`mutation.sh` preflight exits 2 on an unpatched runner.
A proof gate whose pass criterion is 0 Timeout lists, in the same brief, the plain-jest
check for each remaining timeout (id, covering files, a bounded run), so one residual
timeout gets a verdict without a second gate.
Never raise the timeout; there is no allowlist file. `make mutable` can print a
`warning:` line after `changed lines: N` when a merged track inflates the count;
see "Mutation base after a track merged next".

- Per-task deep gates: a per-file floor miss is fixed with tests only,
  never an exclusion.
- Re-gate of named files across a big merge: `make mutable` prints one
  line per file. For `<path> a-b,c-d (N changed lines)` pass one `--mutate`
  entry per range (`<path>:a-b`, `<path>:c-d`), never the comma list
  (Stryker splits on the comma, so the later ranges are never mutated).
  Never pass a
  plain path and a range for the same file (Stryker reads that as "do not
  mutate"); Stryker accepts a plain path, but `mutation-score.js` exits 2 on any plain
  (non-range) entry. The source of truth is the `entries` variable in
  `scripts/checks/mutation.sh`. Read the per-file floor (60) from
  `reports/mutation/mutation.json`.

## Mutation base after a track merged next

Once a track has merged into `next`, set `KIKO_MUTATION_BASE` to
`next`'s own sha for that track's mutation run, so only the track's own
changed lines mutate — not everything `next` already contains. (One line; this
does not contradict the "Mutation testing: small change sets only"
section above, which sets the base to the change set's OWN base commit
before it has merged.)

A change set that merged `next` mid-way, or that stacks on earlier
unmerged change sets, takes as its mutation base the `next` tip that
already contains every earlier change set; otherwise the merge-base
diff also counts the earlier sets' files against the 30 cap.

After a merge of `main` into the change set, the base is the merged main tip. `make mutable`
(`mutation.sh --list`) prints a `warning:` line after `changed lines: N` when N is far above
what the branch's own commits added (`warn_over_count` in `scripts/checks/mutation.sh`); it
means the base is stale, and it changes no exit code.
