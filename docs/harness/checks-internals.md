# Checks internals: content dedup and locking

This is the full mechanism behind the one-line summary in the root
`CLAUDE.md` ("a check skips when its inputs did not change").

## Why dedup exists

`Stop` and `SubagentStop` both call the medium tier, so a
subagent-driven session runs it once per finished subagent plus once
for the coordinator; a developer agent also re-ran `check:deep` after
only an icon asset was added. To stop these duplicate runs, every
check records a fingerprint of its own real inputs when it passes,
and skips the next run whose fingerprint is identical.

## Fingerprint helpers

The fingerprint helpers live in `scripts/checks/_lib.sh`.

- The fast tier fingerprints the single target file plus its config
  and tool version.
- `dup` and `override-guard` fingerprint the changed-file set.
- `knip`, `deps`, and `mutation` fingerprint the `.ts/.tsx/.js` source
  state relative to `HEAD` plus the manifests and configs, so a
  non-source change (an icon asset, an `ios/` file, a doc) skips
  them. `mutation` also adds its scope (see "Mutation file cap"
  below).

The fingerprint state lives outside the repo, keyed by the worktree
path, and is shared across sessions in that worktree — one session's
pass lets another skip. A skip is recorded only on a PASS, so a
failing check always re-runs.

## Locking

`medium.sh` holds a per-worktree single-flight lock so parallel
`SubagentStop`/`Stop` runs do not launch concurrent
`knip`/`deps`/`jscpd`.

`mutation.sh` holds a GLOBAL (machine-wide) single-flight lock at a
fixed path NOT keyed by the worktree, so only one Stryker can run at
a time across all worktrees. If a live run already holds it, a second
run fails fast (exit 2) with a block naming the holding pid and
worktree, rather than blocking or queueing. The lock is released on
normal exit and on INT/TERM via a trap, so a killed run never strands
it. Stryker's own `concurrency` is 2.

## Mutation file cap

After the lock, `mutation.sh` refuses (exit 2, structured block) a
`KIKO_MUTATION_FULL=1` run and a `KIKO_MUTATION_BASE` that does not
resolve, directly: a whole-project run is always above the cap. It then
selects the files to mutate (the diff vs `KIKO_MUTATION_BASE`'s
merge-base; a failed `git diff` is a refusal too, never "nothing to
mutate"), applies its excludes, and counts them. Above
`MUTATION_FILE_CAP` (30) it exits 2 with the structured block before
Stryker starts. Only then does the dedup skip run, and its fingerprint
includes the scope (the merge-base sha and the selected file list), so
a pass over a narrow change set never skips a wider or refused one at
the same HEAD. No env var bypasses the cap: mutation testing runs per
small change set, with `KIKO_MUTATION_BASE` set to that change set's
own base commit.

## Guard replay: fingerprint, mark, and deadline

`guard-replay.sh` runs inside `medium.sh`'s lock and keeps two records
in the per-worktree state dir:

- The dedup fingerprint (key `guard-replay`) hashes the plan (each
  file with its BEFORE commit shas and paths, which pin the BEFORE
  content), each working-tree file's hash, and the engine: every
  `scripts/checks/*.js` and `*.ts`, `pre-write-guard.sh`,
  `guard-replay.sh`, and `rules/semgrep-prewrite.yml`. A skip is
  recorded only on a pass.
- The mark (key `guard-replay-mark`, from `harness_replay_mark` in
  `_lib.sh`) is the HEAD sha, read when the run starts and recorded on
  a pass. The next run replays only commits the mark cannot reach.
  `medium.sh` compares it with the current HEAD: when HEAD moved but no
  file changed, it runs the replay alone (about 50 ms to decide) and
  skips every other check.

On the Stop tier (`--stop-tier`) the replay starts no guard call after
`STOP_TIER_DEADLINE_SECONDS` (150 s, in `guard-replay.js`) and then
fails with a block that names how many files were left unchecked. The
Stop hook is killed at 300 s, and a killed hook ends the turn with no
error, so an unbounded replay would silently skip the check on every
later Stop too. `npm run check:guard-replay` has no deadline and
records its pass, so the next Stop skips the same files as a duplicate.

Measured on 2026-09-27 (10-core Mac, Semgrep 1.175): a cold replay
takes about 2.3 s for 1 changed file, 4.1 to 5.1 s for 5 files, and
6.6 s for 12 files (four guard calls at a time; each is one Semgrep
start). A dedup skip takes about 0.3 s. At about 0.5 s per file, the
150 s deadline covers roughly 300 files.

## `osv-scanner` is never deduped

`osv-scanner` is deliberately excluded from the dedup scheme: its
result depends on the external vulnerability database, which changes
even when the lockfile does not.
