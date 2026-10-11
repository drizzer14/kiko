---
name: harness-workflow
description: Use when coordinating Kiko work. States the delegation rule, the run log, and points to the superpowers process skills.
---

The coordinator delegates all work to the harness agents. The coordinator never edits app files inline.

Rules:
- Split complex or parallel work into separate Orca worktrees (orca-cli). A fresh worktree has no `node_modules`: the first developer runs `npm ci`, and only ONE agent runs it (parallel installs race).
- An orchestrator working in another repo (one with no kiko role agents, for
  example `drizzer14/harness`) starts with
  `claude --model opus --plugin-dir <that repo's plugin dir>` — never a
  built-in `general-purpose` agent. See
  [[no-general-purpose-use-harness-agents]] ("Sessions outside pff-ios",
  global memory dir).
- If no agent fits a task, report the gap. Do not do the task inline.
- Route web research and live API checks to `kiko:researcher` (read-only,
  cites a source URL + check date per claim); it writes no files, so the
  caller persists any durable finding via `kiko:scribe`.
- A measurement that needs a script (corpus counts, a tool run with raised limits) goes to `kiko:ops` with the script in the scratchpad; `kiko:explorer` has only Read/Grep/Glob.
- For a device-test request, copy `kiko:ops`'s "Device verification
  checklist" section into the request to the user.
- Use these superpowers skills directly: brainstorming, writing-plans, executing-plans,
  subagent-driven-development, dispatching-parallel-agents, verification-before-completion,
  finishing-a-development-branch.
- On completion, an orchestrator or role agent SendMessages the coordinator session that dispatched the work with the result (the final commit sha and a one-line summary). This is the standing default, so an orchestrator brief does not need to restate it.
- Every dispatch names an expected duration. When that time passes with no report,
  the orchestrator checks the agent itself (its output so far, its worktree state) —
  it does not keep waiting silently. The coordinator is not the watchdog for role
  agents; each role agent's own "Report back" rule (see its agent file) is what makes
  it send its result the moment it is known instead of going quiet.
  Do not add a SubagentStop hook to enforce the hand-back: the fatal malformed-call path
  ("tool call could not be parsed") ends the agent without running any Stop hook.
- "DEFAULT, pending user" means apply it now, not merely record the decision and leave the old behavior in place. A change that states a DEFAULT ruling must change the code in that same change — a later change should never have to circle back to actually apply a decision an earlier one only annotated.
- A default applied as "DEFAULT, pending user" can leave a dangling state. Give each default's
  consequence a targeted re-review that checks both "what stays" and "what goes".
- A Stop-hook failure during a developer's TDD red phase is that developer's unfinished work. The
  orchestrator forwards it to the developer and never edits the code itself.
- When a planner's recommendation conflicts with a principle the user stated, the orchestrator
  overrules toward the principle and states why in its question to the coordinator.
- User questions go through the coordinator. An orchestrator session never asks the user in its own terminal (no AskUserQuestion there). It sends each user question or blocker to the coordinator by SendMessage: the question, 2-4 options with a one-line consequence each, the recommended option, and the work it can do meanwhile. The coordinator asks the user and relays the answer in the user's own words.
- Every duration or ETA given to the user follows `kiko:estimator` — it
  owns the estimate-from-history rules. A BATCH READY's TIMES line comes
  from the run log (see "Run log"), not from hand-written text.
- Name a task or change set "<track> task N/M" (a number plus the total). Name a step inside a change set "step N/M". Never invent a letter id. Renumber M when the scope changes; a deferred item is not counted.
- A fresh agent is the default for each task. Reuse an agent via SendMessage only for a same-task re-review or fix round by the SAME agent with a small context (never across tasks, never for a different diff, never after a large amount of work). A resumed agent's later report is read from its transcript, not awaited (SubagentHandback delivers one report per agent). Finished subagents cannot be removed from a session's list; `claude rm <id>` deletes a BACKGROUND SESSION and its worktree — never use it to tidy a finished agent.

- Run the FULL jest (`make verify`) before every BATCH READY. `check:all`
  alone missed a fixture that broke two guard rules: the rule-inventory
  and guard-rule jest suites run only in `make verify`.
- Per-task deep gates: a per-file floor miss is fixed with tests only,
  never an exclusion.
- Re-gate of named files across a big merge: `mutation.sh` has no
  file-list mode, so the coordinator runs Stryker directly with
  `--mutate` on the named files and reads the per-file floor (60) from
  `reports/mutation/mutation.json`. This is a documented deviation until
  a `KIKO_MUTATION_FILES` option exists.

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
  - `make verify` or the full jest: `--gate test --verdict pass` or `--gate test --verdict fail`;
  - `make deep` (the coordinator who runs it logs it): `--gate deep --verdict pass` or
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
  - the retrospect: `--gate retro --verdict pass`.
- **finish**: at BATCH READY (`--outcome done`), or when the track is blocked or aborted
  (`--outcome blocked` or `--outcome aborted`). `--recorded` and `--gaps` come from the
  retrospect's report. `--archive <dir>` MOVES every regular file directly in `<dir>` into the
  run's `artifacts/`; point it only at the session scratch folder, never a worktree root
  (`--archive .` would move `package.json` and `CLAUDE.md`). Before the merge, the coordinator
  checks that the run's `summary.json` exists; a run with no summary did not finish its
  bookkeeping. A `deep` event logged after `finish` is expected: `stats` shows it, but
  `summary.json` `totals` do not include it.
- **stats**: `stats --repo kiko --format md` prints one row per review chain. The repo slug is
  the origin remote's repo name (`drizzer14/kiko.git` -> `kiko`), not the checkout folder;
  `--repo pff-ios` matches nothing and prints only the header. The `Minutes` column runs from a
  step group's first logged verdict to its last: the developer's work before the first verdict
  is not counted, and a one-event step shows 0. For a dispatch-to-BATCH-READY time use
  run.json `startedAt` to `summary.json` `finishedAt`. A run with no `summary.json` and no event
  for 24 hours shows as `abandoned`.

BATCH READY's TIMES line is built from the run log, never from memory. The source of each
field is listed in `kiko:estimator` only.

A project skill outside the plugin calls the installed copy. When the copy is missing, the
start snippet prints nothing and starts no run; the finish snippet prints
`run-log: not installed, skipped`. Start (prints the run id):

```bash
RUN_LOG="${HARNESS_RUNS_DIR:-$HOME/.claude/harness-runs}/bin/run-log.mjs"; [ -f "$RUN_LOG" ] && RUN_ID=$(node "$RUN_LOG" start --task "<track> task N/M" --shape build) && echo "$RUN_ID"
```

Finish, in a later Bash call (shell variables do not survive between calls), prefixed with
`RUN_ID=<printed id>;`:

```bash
RUN_LOG="${HARNESS_RUNS_DIR:-$HOME/.claude/harness-runs}/bin/run-log.mjs"; [ -f "$RUN_LOG" ] && node "$RUN_LOG" finish --run "$RUN_ID" --outcome done || echo "run-log: not installed, skipped"
```

## Skill drift rule

After every completed code iteration (a feature, phase, or fix that is
developed and tested/gated), before the next iteration or the merge:
run `kiko:retrospect` to verify BOTH skill locations
(`.claude/skills/` and `harness/kiko/skills/`, plus
`harness/kiko/agents/`) against the new code, then `kiko:scribe` fixes
any drift found and commits it. The completion report names the
drift-fix commit sha, or states "no drift found" with the retrospect
result.

## Mutation testing: small change sets only

Mutation testing (`check:deep` / `check:mutation`) runs per SMALL change
set, never on a whole project or a whole release — a whole-release run
went 10 h 16 min with no result. There is no whole-release or
end-of-integration deep gate. Run it on each change set with
`KIKO_MUTATION_BASE` set to that change set's own base commit.
`scripts/checks/mutation.sh` exits 2 before Stryker starts when more
than 30 files would be mutated (`MUTATION_FILE_CAP`);
`KIKO_MUTATION_FULL=1` and a `KIKO_MUTATION_BASE` that does not resolve
are refused directly (exit 2), and no env var bypasses the cap.
See the `ops` skill for how to launch and await a run.

Who and when (coordinator ruling, 2026-09-27): the COORDINATOR runs
`KIKO_MUTATION_BASE=<change set base sha> make deep` detached for each
reviewed change set (<= 30 source files), before its merge into next.
Orchestrators never run it. The orchestrator's batch-ready report (the
message that tells the coordinator a change set is reviewed and ready
to merge) names the change set's base sha and the run id (the coordinator works in the main
checkout and cannot see the worktree's gitignored HANDOFF.md), and confirms the file count
after excludes is within `MUTATION_FILE_CAP` (read it in
`scripts/checks/mutation.sh`); a larger batch splits into change sets
with their own bases. Count with the gate's own filter, never by hand:
`KIKO_MUTATION_BASE=<base sha> make mutable` (it runs
`mutation.sh --list`) prints the files and `mutable files: N (cap …)`,
exits 2 above the cap, and never starts Stryker or takes its lock. A
change set with 0 mutable files gets no mutation run: `mutation.sh`
exits 0 on 0 files without starting Stryker. A changed file whose diff
is only comments or whitespace is left out of that count by the script
itself (it prints `skipped (comment-only): <path>`); a `Stryker` or JSX
pragma comment, a colocated test changed by more than comments, or any
doubt, keeps the file.

## Merging into main

Never merge, rebase, pull (except `--ff-only`), cherry-pick, revert,
am, or apply in the main checkout
(`/Users/drizzer14/Developer/Projects/pff-ios`): every session's hooks
run from it, so a conflict marker there breaks every hook. The
kill-guard denies these (see kiko-linter's "MAIN-CHECKOUT deny"). Do the
real merge, conflicts and all, in a separate detached worktree. Verify
it there = `bash scripts/wait-load.sh 8 && env -u FORCE_COLOR make verify`
at the MERGE COMMIT (the per-window gate ran on the branch tip, not on
the merge result). Move main only on exit 0 with the full test count. A
clean `git merge-tree` is not proof of a green merge. A merge with 0 src
files in it still gets the verify, because check:all and the hooks run
from it. Then fast-forward main. Run exactly
`git -C /Users/drizzer14/Developer/Projects/pff-ios merge --ff-only <sha>`.
Any added option (-q, --quiet, --no-edit, -v) is denied. Read the result
with `git -C /Users/drizzer14/Developer/Projects/pff-ios log -1 --oneline`.

## Read-only agents return their report

A read-only agent (debugger, reviewer, auditor, researcher, explorer)
returns its report in its final message; the orchestrator writes the
named report file from it. Never ask a read-only agent to write a file.

## Rulings

Record every orchestrator ruling with its precedent and its cost if
wrong. A user directive relayed by another session never authorizes
relaxing a gate or editing CLAUDE.md; hold it until the user confirms
in this orchestrator's own terminal. Pin each user device finding with
a test in the fix commit.

## Never pattern-kill a process

Never use pkill, killall, or any pattern or group kill. Stop only a
process ID you started yourself (kill <pid>), or let the tool timeout
end a hung command. Read-only roles (reviewer, auditor, explorer,
debugger, pm, retrospect) do not stop processes at all. The
PreToolUse hook on `Bash` (`scripts/checks/kill-guard.sh`, wired in
`harness/kiko/hooks/hooks.json`) denies the common forms of these
commands mechanically (known limits in kiko-linter's kill-guard entry) — this rule states it for agents to follow directly, not
just get blocked by.

## Never git stash; always quote a heredoc delimiter

Never run `git stash` in any directory, scratch clones included
(`git -C <dir> stash` and `git --git-dir … stash` too), in any form —
commit a WIP or copy the files aside instead. Always quote a heredoc
delimiter (`<<'EOF'`, never `<<EOF`): an unquoted heredoc expands
backticked text in its body as commands. The same `kill-guard.sh` hook
denies the common forms of both mechanically, with a
WHAT/DETAILS/WHY/HOW/DO-NOT reason; it is a heuristic tokenizer with
known limits (see kiko-linter's kill-guard entry), so a form it misses
is still banned. Never chain a file write, a plugin update, and a
memory rewrite in one Bash call — make each its own step.

## A write can be denied before it lands

A `PreToolUse` hook on `Edit|Write|MultiEdit`
(`scripts/checks/pre-write-guard.sh`, wired in
`harness/kiko/hooks/hooks.json`) can deny the write itself, before it
ever reaches disk — it rebuilds the proposed post-edit content and
checks it against `rules/semgrep-prewrite.yml` plus the Node-checker
rules in `pre-write-guard.js`. A deny arrives as a
`permissionDecision: "deny"` block naming the rule id, the exact
finding, `metadata.fix` (the concrete fix), and `metadata.skill` (which
skill section explains why) — read all three before acting, and go to
the skill section named if the reason for the rule is unclear. Fix the
write per `metadata.fix` and re-issue it; never retry the identical,
unchanged write — it will deny again the same way. Use `// nosemgrep: <rule-id> OVERRIDE(<reason>) <why>` for a Semgrep
rule and `// kiko-override: <rule-id> OVERRIDE(<reason>) <why>` for a
Node-checker rule; a bare comment with no `OVERRIDE(...)` never
suppresses anything. A `kiko-override:` only passes the guard:
`check:all` still fails on that line, because the project-wide Node
checkers have no inline override. A Node-rule exception needs a
checker-level exemption (developer work). See kiko-linter's "Override
forms and where each is honored". A deny that says the guard
itself "could not check" the write (a Semgrep/Node crash, a timeout,
malformed input) is fail-closed by design — it means fix the guard's
own input or report the guard bug, never bypass it with an override
comment.

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
   building the next one.
4. Each (previous point, point) pair is a mutation pair — run
   `check:deep`/mutation on it per the small-change-set rule above.
5. Fast-forward the track branch to the last point with
   `git merge --ff-only`.

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
run the full `make verify`.

## Mutation base after a track merged next

Once a track has merged into `next`, set `KIKO_MUTATION_BASE` to
`next`'s own sha for that track's mutation run, so only the track's own
files mutate — not everything `next` already contains. (One line; this
does not contradict the "Mutation testing: small change sets only"
section above, which sets the base to the change set's OWN base commit
before it has merged.)

A change set that merged `next` mid-way, or that stacks on earlier
unmerged change sets, takes as its mutation base the `next` tip that
already contains every earlier change set; otherwise the merge-base
diff also counts the earlier sets' files against the 30 cap.

## Merge conflicts vs the pre-write guard

Resolve conflict markers with Edit/Write as usual; resolving one whole
block at a time is fine. The guard checks every step: each rebuilt side
may only carry findings already in the union of the on-disk sides. It
denies a partial block, markers added to a clean file, and a side the
edit broke. If the deny says the file on disk does not parse, stop and
ask the user how to repair it. See kiko-linter's "Pre-write guard and
merge-conflict files".

## The Stop tier replays the pre-write guard

The kill-guard denies Bash writes into `src/`, `__tests__/`, `rules/`,
and `e2e/`; the denied forms and the known limits are listed in
kiko-linter's "SHELL-WRITE deny". Move
or rename a file with `git mv` (`git add` a new file first), then edit
it with Edit/Write; see kiko-code-style's "Folder-per-thing
co-location". A Bash write it
does not see (a script file, `find -exec`, a variable path)
and a commit of it still skip the pre-write guard. On `Stop` and `SubagentStop`, `medium.sh`
replays the same guard over every `.ts`/`.tsx` file the session changed:
the working tree, plus every commit no worktree's passed replay reached
(rebased, cherry-picked, and merged-in ones too; a backup branch or a
new worktree hides nothing). A
violation such a write added fails the turn end with the file, rule,
and line. Fix it with Edit/Write, so the guard checks the fix. Never
rewrite the file with Bash again. The `--write` fixers and clean merges
pass, because only a finding the change added fails. If the replay stops at its Stop-tier deadline,
run `npm run check:guard-replay` by hand; its pass is recorded. See
kiko-linter's "Pre-write guard replay on the Stop tier".

## Run verbose commands through an Orca terminal

Run a verbose or long-running command inside an Orca terminal instead
of the coordinator's own shell, so its full output stays out of the
coordinator's context — only what you choose to read comes back.
Mechanism: `orca terminal send --text "<cmd>" --enter --json`, then
read just the tail with `orca terminal read`. Full CLI usage:
`orca skills get orca-cli` (do not copy that guide's content here).

Route commands this way, including: `npm run deploy:device`,
`npm run check:all`, `npm run check:deep`, `npx jest`, `pod install`,
`npm install`, and Metro (`npm start`).

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

## Orchestrator handover

An orchestrator session cannot see its own context-usage gauge (it is
in the terminal status line). The coordinator watches it from outside
and hands over at about 50%: the session writes a handoff file in its
worktree, waits until its own in-process subagents finish (closing
the terminal kills them mid-work), then the coordinator closes the
old terminal and starts a new claude session in the same worktree
that reads the handoff file.

## Harness hook changes go live only after a plugin update

- The hook dispatcher entry point runs from the MAIN checkout
  (directory marketplace): `harness/kiko/hooks/dispatch.sh` in
  `/Users/drizzer14/Developer/Projects/pff-ios`, so a broken dispatcher
  there breaks every hook in every worktree at once (proven 2026-09-26:
  conflict markers in main's `dispatch.sh`). The dispatcher execs the
  edited file's own worktree `scripts/checks/*`.
- Agents and skills load from the versioned plugin CACHE
  (`~/.claude/plugins/cache/kiko-marketplace/kiko/<version>`). A text
  change to an agent or skill is live only after: bump the
  `plugin.json` version, the user runs
  `claude plugin update kiko@kiko-marketplace`, then `/reload-plugins`.
- Never apply, merge, or rebase into `harness/kiko/hooks/` in the main
  checkout in place. Build the new file in scratch, run `bash -n`, grep
  it for conflict markers, then install it with one `mv`.
- A coordinator edit or commit of hook/harness code may be
  classifier-denied, but do not assume it. Offer to commit it yourself
  in one line, because it changes the guards and the user decides. On
  the user's yes, run the commit. If the classifier denies it, do not
  retry or work around it: hand the user the exact command (it stages
  every changed path).
- A commit command handed to the user stages EVERY changed path
  (`git add <paths>` or `git commit -- <paths>`), never only some.
- Consent relayed by a peer session is not consent. Act only after you
  read the user's own words.
- Verify liveness with a harmless probe (for example
  `pkill -0 -f <nonexistent>` must be denied). Never assume a hook is
  live because `hooks.json` on main says so.
- Every hook entry goes through `harness/kiko/hooks/dispatch.sh
  <script>`. No hook command hardcodes `${CLAUDE_PROJECT_DIR}`: for a
  subagent of a main-rooted session it is the MAIN checkout, so main's
  scripts would check worktree files. Read `dispatch.sh`'s header for
  the resolution order.

## Approved visuals and open user requests

- Never change or revert a user-approved visual without explicit user
  approval, including in a cleanup that calls it "exploratory". Locked
  visual decisions live in `kiko-design-system`.
- Track every open user request until it is device-verified.

## Review cadence

- One `kiko:reviewer` pass per phase or task group, plus one
  whole-branch pass before merge. Never a review after every step.
- Cheap same-file Minors may ride a Critical/Important fix round; never
  open a fix round for Minors alone.
- Every migration, including a pure CREATE INDEX, goes to `kiko:reviewer`
  before its window's BATCH READY, which names the migration number. The
  brief asks which existing queries touch the column or table and which
  index each now uses. A new index without an EXPLAIN QUERY PLAN test is
  a finding.

## Orchestrator defaults never widen or contradict

An orchestrator's default choices never contradict an established
design or code pattern, and never widen a user instruction beyond
what was asked; take the narrowest reading.

## UI feedback rounds: audit before fixing

Before fixing a round of UI feedback, run a UX-consistency audit of
the affected screens against `kiko-design-system` and against how
the same pattern is already built elsewhere; fix the pattern
everywhere it appears, then distill new rules into the skill.
Then classify every finding (see "Classify every finding").

## Classify every finding

After each UI feedback round and each phase or whole-branch review,
classify EVERY finding, with a one-line reason:

- (a) mechanizable now: add a pre-write guard rule in the same round;
- (b) mechanizable with a pinned value: add a pinned-value rule in the
  same round;
- (c) judgment-only: stays with the reviewer.

The round's report lists the classification. The scribe or developer
adds the rules, following kiko-linter's "Adding a pre-write guard rule"
and "Pinned-value rules for locked user-approved visuals". The
reviewer's `mechanizable: yes/pinned/no` tag is the first draft.

## Large reviews

Split a big review into parallel read-only reviewer slices by commit
range, each writing its own output file. Review a mechanical sweep by
static proof, not by sampling: resolve every import binding and
`jest.mock`/`require` target at both commits, count cycles, and check
each side-effect import's predecessors.

## The Stop-hook dup check is scoped

`medium.sh`'s Stop/SubagentStop hook runs jscpd scoped to the
session's own changed files (`scripts/checks/dup.sh <changed files>`)
— the project-wide `npm run check:dup` (no args, scans the whole
repo) can be green while this scoped run fails, or vice versa. Run the
same scoped command yourself before reporting done:
`bash scripts/checks/dup.sh <changed files>` (space-separated paths;
this is the same wrapper `check:dup` calls, `scripts/checks/dup.sh`,
which accepts file args and falls back to the whole repo with none).
Each touched test file must also pass the check alone, not only as
part of the whole changed-file set. A `WARNING` on exit 0 means a large
file (or the combined large-file run) is over 5%, or that the pass could not
measure (a could-not-measure, could-not-list, or mktemp WARNING carries no
figure): it does not block, but do not grow a figure. The non-blocking
large-file pass runs on every call, a dedup skip included; see kiko-linter
"`check:dup` measures the files jscpd skips for size".

## Relay-verify subagent claims

Before closing a round, re-run (or have a fresh reviewer re-run) any
check a subagent claims already passed — do not relay a "green" claim
without independent verification. Also spot-check that a skill
section a report cites actually exists at the stated path/heading
before trusting a claim built on it.

## Deferred-to-scribe items must be named explicitly

A "deferred to the scribe step" item that is not a skill edit (plan
text, other docs) must be named explicitly in the brief handed to
`kiko:scribe` — never left implicit for the scribe to guess at.

## Write the rule into its skill, not a third brief

When a fix brief is about to restate the same rule a second time,
write the rule into its owning skill instead — a brief that repeats a
rule already stated once is a sign the rule belongs in the skill, not
in another one-off brief.

## Load rule

Run `make verify` / `check:all` / full jest only when the 5-minute load
average (`sysctl -n vm.loadavg`) is below 10: wait first with
`bash scripts/wait-load.sh 10` (run it in the background and wait on its
exit code: 0 once the load is below 10, 2 when its 3600 s timeout, an
optional second argument, passes first, 3 when it cannot read the load,
64 for a bad argument; it prints one start line and nothing else).
Every load or "is verify still running" wait goes ONLY through
`bash scripts/wait-load.sh <max>` (background, exit code; main checkout path
when the worktree lacks it). Never write a loop that greps ps/pgrep output for
make verify, check:all, jest or stryker: the loop's own command line contains
the pattern and it matches itself. kill-guard denies this loop shape before it
runs (kiko-linter "WAIT-LOOP deny"); a `ps -p <pid>` or `kill -0 <pid>` wait
stays allowed. At most ONE jest-heavy agent per track; Semgrep or jest
timeouts at high load are environment, not code: re-run at low load,
never raise a timeout. See memory `check-security-timeout-under-load`.

## Long briefs live in a file

A long orchestrator brief lives in `memory/refs/brief-<task>.md` in the
main checkout (untracked); the terminal message only names that path;
never paste a long brief or backticks into `orca terminal send`.
