## Merging into main

Never commit (also `--amend`), merge, rebase, pull, cherry-pick, revert,
am, or apply in the main checkout
(`/Users/drizzer14/Developer/Projects/pff-ios`): every session's hooks
run from it, so a conflict marker there breaks every hook. The
kill-guard denies these (see kiko-linter's "MAIN-CHECKOUT deny"). Do the
real merge, conflicts and all, in a separate detached worktree. Verify
it there = a verify the coordinator queues with `scripts/job-queue.sh verify` (not a bare
`make verify`) at the MERGE COMMIT (the per-window gate ran on the branch tip, not on
the merge result). Move main only on exit 0 with the full test count. A
clean `git merge-tree` is not proof of a green merge. A merge with 0 src
files in it still gets the verify, because check:all and the hooks run
from it. Then fast-forward main with `bash scripts/ff-main.sh <sha>`. It
runs only for a sha whose LAST `verify` line in the queue's done.log is exit 0, so queue the
verify through `scripts/job-queue.sh verify` (a bare `make verify` leaves no line), keep the
tree untouched until DONE, and do not move HEAD after. When the head field is the full sha or
`unknown`, and the dirty-tree refusal: see the queue paragraph in `queue-and-terminals.md` and the
`scripts/job-queue.sh` header. The
kill-guard denies a raw
`merge --ff-only` on main (kind `mainFastForward`). There is no bypass: an override goes to the
user plus a run-log note. The script prints `git log -1 --oneline` of main on success.

A track that regenerates shared binary fixtures (the demo .kiko files)
merges main first and regenerates on the merged builder; never
hand-merge a binary. After merging the builder source, regenerate
(`KIKO_REGEN_DEMO=1` on the generate-demo-kiko test), then re-run it plain.

## Merge pattern: one conditional, gated on the conflict test

A merge runs only when the conflict test passes, in ONE conditional —
never a merge command that runs unconditionally after a separate test
step:

```
if git merge-tree --write-tree <into> <from> >/dev/null; then
  git merge --no-ff <from> ...
else
  <stop and report: exit 1 = conflicts (send them to an agent); any other exit = merge-tree error>
fi
```

Gate on the exit code, never on grepping the output for `CONFLICT`:
exit 0 = clean, exit 1 = conflicts, any other exit = error (the output
is then unspecified, so a grep reads the error as clean). Both non-zero
cases stop. Verify in `git help merge-tree`, "EXIT STATUS". On success
`--write-tree` prints the merged tree id on stdout; capture stdout
instead of discarding it where the tree id is needed (it is a tree, not
a commit).

(Incident: a merge ran after a failed conflict test and left a
conflicted merge in next.)

## Stacked merge points for gated tracks

When a track's change sets fall behind a gate on `next` (for example a
migration index that later change sets must build on), build the merge
points in a scratch worktree (`git worktree add`, detached):

1. Merge `next` into the last commit of the first change set (T1) to
   get merge point 1.
2. Merge each later change set's last commit into the previous merge
   point (T2 into point 1, T3 into point 2, ...).
3. Make `check:all` (or the relevant verify) green at each point before
   building the next one; the gate for main is the queued verify in "Merging into main".
4. Each (previous point, point) pair is a mutation pair — run
   `check:deep`/mutation on it per the small-change-set rule in `mutation-testing.md`.
5. Fast-forward the track branch to the last point with `git merge --ff-only`. This
   applies to a track branch in its own worktree, never to main (main moves through
   `bash scripts/ff-main.sh <sha>`).

A change set whose user-visible text (copy, subtitle, label) names a
feature that only a LATER change set actually implements is held after
its own mutation pass and merged into `next` together with that later
change set — never merged alone first, even once it is reviewed and
gated on its own (ruling 2026-10-01: a broker subtitle promised shares
support before the task that added it).

Example (2026-09-29, Reminders track): T3 `7d3cb4c1`, T4 `6d39f3d3`, T5
`3b267bf5` — three stacked merge points built and gated this way before
the track branch fast-forwarded.

A fix round for an earlier change set never sits on top of a later one:
fix it in its own worktree off that set's tip, then have ops run
`git rebase --onto <fix tip> <old base> <branch>` for the later set, then
run the full verify, queued by the coordinator (`bash scripts/job-queue.sh verify <worktree>
<label>`).
