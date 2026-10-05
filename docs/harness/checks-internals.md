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
mutate"), applies its excludes, drops the files whose diff is only
comments or whitespace and has no colocated test changed by more than
comments (`comment-only-changes.js`, fail-closed), and
counts the rest. Above
`MUTATION_FILE_CAP` (30) it exits 2 with the structured block before
Stryker starts. Only then does the dedup skip run, and its fingerprint
includes the scope (the merge-base sha and the selected file list), so
a pass over a narrow change set never skips a wider or refused one at
the same HEAD. No env var bypasses the cap: mutation testing runs per
small change set, with `KIKO_MUTATION_BASE` set to that change set's
own base commit.

## Guard replay: fingerprint, mark, and deadline

`guard-replay.sh` runs inside `medium.sh`'s lock and keeps one record
in the per-worktree state dir and two kinds of git ref in the shared
repository:

- The dedup fingerprint (key `guard-replay`, state dir) hashes the
  plan (each file with its BEFORE commit shas and paths, which pin the
  BEFORE content), each working-tree file's hash, and the engine: every
  `scripts/checks/*.js` and `*.ts`, `pre-write-guard.sh`,
  `guard-replay.sh`, and `rules/semgrep-prewrite.yml`. A skip is
  recorded only on a pass.
- The mark ref, `refs/kiko/guard-replay/<worktree id>`
  (`harness_replay_ref` in `_lib.sh`). The id is the first 16 hex
  digits of the SHA-1 of the worktree's absolute git dir
  (`<repo>/.git` for the main checkout, `<repo>/.git/worktrees/<name>`
  for a linked one): the same across a branch switch and a
  `git worktree move`, different for every live worktree, and ref-safe
  whatever the worktree is called. The run reads HEAD
  (`harness_replay_mark`) when it starts and moves the ref there with
  `git update-ref` on a pass, including a dedup skip; a failed or
  stopped run never moves it. A pass never moves it back either: when
  HEAD is the mark or an ancestor of it (a reset back, a switch to an
  older commit), the ref stays. A missing ref, one that is not a
  commit, and one HEAD diverged from (a rebase, an amend, a branch
  switch) are moved to HEAD. Every run replays only commits that NO
  worktree's mark ref reaches (`--not --glob=refs/kiko/guard-replay/*`);
  a mark vouches for the tree at its tip only (kiko-linter's "Known
  limits"). Refs are shared by all worktrees and survive a purge of
  `$TMPDIR`.
  `medium.sh` compares this worktree's ref with HEAD: when HEAD moved
  but no file changed, it runs the replay alone (about 50 ms to decide)
  and skips every other check. A removed worktree's ref stays, and
  still marks the commits it reached as checked; a new worktree that
  later gets the same git dir name reads that ref as its own mark at
  once (it reaches only passed commits, so this is harmless).
- The floor ref, `refs/kiko/guard-replay-floor`: a blob that holds a
  unix time. The repository's first replay (no floor and no mark ref
  yet) records it as 24 h before that run, whether the run then passes
  or fails. A commit older than it (by `rev-list --timestamp`, the
  committer date) is left out only when none of its parents is a
  session commit, so an old-dated commit on top of session commits
  stays in the session and hides nothing under it. It never slides,
  so a failed first replay resumed days later still replays what it
  flagged, and it bounds how far back a merge of a branch no replay
  ever passed reaches. A deleted floor is recorded again only when no
  mark ref exists either. With a mark ref present, deleting the floor
  removes the bound (a wider replay). With none (after a first replay
  that failed), or after deleting every `refs/kiko/*` ref, the next run
  is a first replay again and records a new floor 24 h before it,
  later than the old one, which drops older unchecked commits.

On the Stop tier (`--stop-tier <medium.sh start>`) the replay starts
no guard call after `stopTierDeadlineSeconds` (in `guard-replay.js`)
and then fails with a block that names how many files were left
unchecked. The deadline is the smaller of 150 s and what the hook
budget has left: 300 s, minus the time since `medium.sh` started (its
lock wait and `dup.sh` count), minus the 25 s an in-flight guard call
may still take, minus a 60 s reserve for the checks `medium.sh` runs
after the replay (knip, deps, the rule fixtures, plist, typecheck:
about 20 s cold, measured 2026-09-27). When the budget is already
spent, it fails at once. The Stop hook is killed at 300 s, and a killed
hook ends the turn with no error, so an unbounded replay would silently
skip the check on every later Stop too.
`KIKO_GUARD_REPLAY_DEADLINE_SECONDS` (a test seam) can only lower the
150 s ceiling; a value above it, or one that is not a positive finite
number, is ignored. `npm run check:guard-replay` has no deadline and
records its pass, so the next Stop skips the same files as a duplicate.
`KIKO_PREWRITE_TIMEOUT_MS` (the guard's own per-call budget) has no
ceiling yet, so a large value set in the user's environment lengthens
the in-flight tail past 25 s.

Measured on 2026-09-27 (10-core Mac, Semgrep 1.175): a cold replay
takes about 2.3 s for 1 changed file, 4.1 to 5.1 s for 5 files, and
6.6 s for 12 files (four guard calls at a time; each is one Semgrep
start). A dedup skip takes about 0.3 s. At about 0.5 s per file, the
150 s deadline covers roughly 300 files.

## `osv-scanner` is never deduped

`osv-scanner` is deliberately excluded from the dedup scheme: its
result depends on the external vulnerability database, which changes
even when the lockfile does not.
