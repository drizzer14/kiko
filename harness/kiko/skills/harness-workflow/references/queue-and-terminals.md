## Run verbose commands through an Orca terminal

Run a verbose or long-running command inside an Orca terminal instead
of the coordinator's own shell, so its full output stays out of the
coordinator's context — only what you choose to read comes back.
This is for running commands, never for messaging a session (see the
SendMessage bullet in `SKILL.md`). Mechanism:
`orca terminal send --text "<cmd>" --enter --json`, then
read just the tail with `orca terminal read`. Full CLI usage:
`orca skills get orca-cli` (do not copy that guide's content here).

Route commands this way, including: `npm run deploy:device`, `pod install`,
`npm install`, and Metro (`npm start`). Heavy jobs (`check:all`, `check:deep`, the full jest,
verify, the mutation gate) go through `scripts/job-queue.sh`, never an Orca terminal: kill-guard
denies them typed (`heavyJob`, `fullJest`), and the guard judges a sent `orca`
`--text`/`--command` value like a typed line.

Read the tail before you close the terminal — closing
(`orca terminal close --terminal <handle>`) removes its buffer, so a
close-before-read loses the output for good. Order: run → wait for
completion → `orca terminal read` the tail → then
`orca terminal close`. For reliable completion detection, create the
terminal with the command plus a sentinel, e.g. `orca terminal create
--worktree active --title "<name>" --command "<cmd>; echo
__ORCA_DONE_$?__" --json`, then poll `orca terminal read` until the
`__ORCA_DONE_<code>__` line appears (`<code>` is the exit status).
Do not rely on `terminal wait --for exit` for a shell-backed
terminal — the shell persists after the command exits, so that wait
never fires. Close the terminal only after reading, to keep the
workspace clean.

## Load rule

The load rule lives in the ops skill's "Load rule" section; see it. One heavy job runs at a
time, queued by `scripts/job-queue.sh` (read its header for the full contract). A LOAD HOLD
brief names the exact `__tests__` suites a role may run, never the folder. The guard suites
(`guard-*.test.ts`, `guard-replay.test.ts`) spawn semgrep-core. The qa agent rule (a qa that
edits a test file runs every guard suite) yields to a hold only if the brief says so by name:
write "qa: the guard-suites rule is suspended until RESUME; owed: check:guard-replay by hand". Run
`scripts/job-queue.sh verify|check-all|security <worktree> <label>` or
`scripts/job-queue.sh gate <worktree> <label> <base> <head> [--long]` with run_in_background and
await only its exit code; its QUEUED/WAITING/START/DONE lines are its normal stdout. State lives in
`${KIKO_QUEUE_DIR:-$HOME/.claude/kiko-queue}`. Order: class 1 (verify, check-all, security) first,
then gates by `changed lines:` (smallest first), then `--long` gates (user ruling 2026-10-13: a
`--long` gate starts only on AC power, after every other ticket). `scripts/job-queue.sh hold
<reason>` stops every start until `scripts/job-queue.sh release`; `scripts/job-queue.sh status`
shows the hold, the power state, the running job, and the tickets (it reads the tickets before
the lock). `hold` stops no running job: for one that holds the lock it prints a `running:` line,
and a start racing the hold backs off, the one that line names included. On battery NO job of any
class starts (orchestrator default D1, accepted by the user 2026-10-13); an unreadable power
state holds too. A load wait at the head of the queue is in the ops skill, "Load rule". A gate
refuses a tip whose `mutation.sh` has no changed-line `--list` ("merge main first",
exit 2) and a moved HEAD (exit 3); the queue never checks out files (the old H6 overlay is gone).
On the real queue (`KIKO_QUEUE_DIR` unset or equal to `~/.claude/kiko-queue`), `verify`, `gate`
and `check-all` refuse (exit 3) a target worktree of another repository and a script copy
outside any repository; `harness-verify` and `security` are exempt. A test or scratch run never
uses `job-queue.sh` without `KIKO_QUEUE_DIR` on a temporary folder (see the `scripts/job-queue.sh`
header, `refuse_foreign_repository_on_real_queue`).
A queue label holds only letters, digits, `.`, `_` and `-` (`scripts/job-queue.sh` exits 2
"invalid label" otherwise).
Queue from the TARGET worktree's own `scripts/job-queue.sh`, never a copy from another branch
(an older copy refuses with exit 2 on the queue's `format` stamp, and a differing copy prints a
WARNING). Closing a session kills its queue waiters: the next waiter that prunes a dead waiter's
ticket writes one `lost` done.log line, and a reclaimed dead lock writes a lock-form `lost` line
(its job may have run fully). At handover or close run
`scripts/job-queue.sh status`, re-queue or hand over your own tickets, and never close a terminal
with a live waiter. When many tracks run, the load never drops below a `wait-load.sh` limit:
queue directly (the queue serializes) and throttle feature tracks with a LOAD HOLD (no new jest
or tsc agent until RESUME; a RESUME names its limits). Keep `wait-load.sh` for a lone security
run only. A queued check:all or verify reads the worktree until
the job is DONE; keep that tree untouched from the queue time until DONE, and never queue one while
a developer still edits that tree. `verify` and `gate` refuse a changed tree (untracked included)
with exit 3, at enqueue and again at START: commit it (for example `ios/Podfile.lock`) or copy
files aside, never stash. done.log's head field is `unknown` if the job itself changed the tree
(a `NOTE` names the path) or HEAD moved; `check-all` and `security` still run on a dirty tree. A
verify prints no live output: read `<queue dir>/logs/verify-<label>.log` (path printed at the
end) for a failure, and wait only for the exit code. Detail: the `scripts/job-queue.sh` header.

During a queue hold no role agent runs `check:security`, a Semgrep-spawning guard suite,
`check:all` or `make verify` outside the queue (kill-guard denies it: `heavyJob`, `fullJest`);
brief every subagent so. A green jest of a
verify plus a standalone queued `check:all` (ruling E), or a sim pass, never replaces a green
queued verify line, which `scripts/ff-main.sh` requires for the sha. The same rule is in the
ops skill's "Load rule" section.

A gate's forwarded warning and `TIMEOUT-HEAVY` lines, and their order against the DONE line,
are in the ops skill's "Load rule" section.
