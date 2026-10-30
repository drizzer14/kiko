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
  caller records any durable finding per "Memory writes".
- A measurement that needs a script (corpus counts, a tool run with raised limits) goes to `kiko:ops` with the script in the scratchpad; `kiko:explorer` has only Read/Grep/Glob.
- For a device-test request, copy `kiko:ops`'s "Device verification
  checklist" section into the request to the user.
- Use these superpowers skills directly: brainstorming, writing-plans, executing-plans,
  subagent-driven-development, dispatching-parallel-agents, verification-before-completion,
  finishing-a-development-branch.
- On completion, an orchestrator or role agent SendMessages the coordinator session that dispatched the work with the result (the final commit sha and a one-line summary). This is the standing default, so an orchestrator brief does not need to restate it.
- Every session-to-session message (report, question, BATCH READY, handover) uses Claude Code
  SendMessage, which lands in the receiving session's inbox. A session NEVER messages another
  session through Orca (no `orca orchestration send/ask/reply`, no `orca terminal send` into a
  session someone types in): Orca types it into the terminal input and interrupts the user's
  typing. `orca terminal send` is only for starting a fresh session, its first brief pointer,
  slash commands (`/reload-plugins`, `/clear`), and running a verbose command in a
  command-runner terminal (never one someone types in); only the coordinator sends a slash
  command into another session.
- When SendMessage cannot reach the coordinator, append one line per milestone or question to
  `memory/refs/coordinator-inbox.log` (`<name> HH:MM text`) and name that file in the first
  report; the coordinator watches it.
- Do it yourself first. Before you hand the user a command or a click, check whether your own
  tools can do it (Bash, an agent dispatch, a file edit; the coordinator also has `orca terminal
  send` for a slash command in another session). If they can, do it and report the result.
  Hand the user only what
  truly needs them: slash commands in the user's OWN session, GUI-only steps (App Store
  Connect, Device Hub poses, the physical device), entering the user's secrets, or a step a hook
  or the permission system denied (report it, never bypass). This does not lift the user's
  explicit gates (pushes and publishes that need the user's OK, destructive or hard-to-reverse
  actions). Example: after a merge that bumps the kiko plugin, the coordinator runs
  `claude plugin update kiko@kiko-marketplace` itself from the main checkout and sends
  `/reload-plugins` to every Orca session except the user's own (read each for "Reloaded:");
  only the user's own session reload is the user's step.
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
- A fresh agent is the default for each task, and a FRESH developer takes each fix round (user
  2026-10-26). Reuse an agent via SendMessage only for a same-task re-review by the SAME agent
  under about 150k context (never across tasks, never for a different diff, never after a large
  amount of work). A fresh developer after a stall re-runs every check and re-proves each red
  test itself; it trusts no earlier green. A resumed agent's later report is read from its
  transcript, not awaited (SubagentHandback delivers one report per agent). Finished subagents
  cannot be removed from a session's list; `claude rm <id>` deletes a BACKGROUND SESSION and its
  worktree — never use it to tidy a finished agent.

- `make jest-affected` is the default dev test command: it runs only the suites a change can
  affect (base: merge-base with main; `BASE=<ref>` overrides). Exit 3 with `AFFECTS EVERY SUITE`
  (package files, jest/babel/tsconfig, `__mocks__`, `patches`, `.env.test`) means queue the
  verify. Named-file jest (`npx jest <files> --maxWorkers=2`) stays allowed. The queued verify
  stays the backstop. Mapping rules and limits: the header of `scripts/checks/jest-affected.sh`;
  usage: `docs/harness/checks.md` "Makefile targets".
- The COORDINATOR owns the queue (user 2026-10-26). An orchestrator never queues a verify,
  check-all, security or gate job: it reports READY FOR VERIFY naming the worktree, the label and
  the base sha, and the coordinator queues it. Every later "queue the verify" means that report.
- An acceptance pin's seed or world is part of the pin. An edit of a shared seed helper that
  changes an acceptance pin's world is an edit of that pin (Binance S15-Q13): re-seed that pin
  with its own per-pin seed line, never in the shared helper. A plan line "existing suites green
  unchanged" for a change that adds owed state first asks which seeds are 1.2-upgrade worlds
  (S15: 48 pins went red).
- Run the FULL jest through the queued verify (`bash scripts/job-queue.sh verify <worktree>
  <label>`; a typed `make verify` is denied) before every BATCH READY. `check:all`
  alone missed a fixture that broke two guard rules: the rule-inventory
  and guard-rule jest suites run only in the verify.
- A change set that adds a repo-wide invariant or rule merges main first and re-runs
  `check:all` (queued: `bash scripts/job-queue.sh check-all <worktree> <label>`): the new rule
  must hold on code main gained since the base. After that merge the
  mutation gate uses the merged main tip as `KIKO_MUTATION_BASE` (see "Mutation base after a
  track merged next").
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

## Memory writes

Every write to the global memory dir is a permission prompt the user often misses, so:

- A session or agent working in a worktree (orchestrators, their scribes, retrospects, every
  other role agent) NEVER writes the global memory dir. Candidate lessons go to
  `.superpowers/sdd/<track>/lessons.md`, beside HANDOFF.md. The orchestrator appends what a
  read-only agent (retrospect, reviewer, explorer, researcher) reports; a role agent with
  write tools may append its own. All are listed in BATCH READY or the completion report.
- Only the coordinator session writes the memory dir: ONE batch per merge or per coordinator
  retrospect, only durable lessons not already in the repo, preferring an edit of an existing
  memory over a new file. A scribe the coordinator spawns for that batch may do the writes.
- Writes use Edit or Write, never Bash (no `sed -i` on the index).
- `memory/refs/` in the main checkout is not the memory dir; this rule does not cover it.

## Skill drift rule

After every completed code iteration (a feature, phase, or fix that is
developed and tested/gated), before the next iteration or the merge:
run `kiko:retrospect` to verify BOTH skill locations
(`.claude/skills/` and `harness/kiko/skills/`, plus
`harness/kiko/agents/`) against the new code, then `kiko:scribe` fixes
any drift found and commits it. The completion report names the
drift-fix commit sha, or states "no drift found" with the retrospect
result, and lists the candidate lessons per "Memory writes".

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

## Merging into main

Never merge, rebase, pull, cherry-pick, revert,
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
`unknown`, and the dirty-tree refusal: see the queue paragraph below and the
`scripts/job-queue.sh` header. The
kill-guard denies a raw
`merge --ff-only` on main (kind `mainFastForward`). There is no bypass: an override goes to the
user plus a run-log note. The script prints `git log -1 --oneline` of main on success.

A track that regenerates shared binary fixtures (the demo .kiko files)
merges main first and regenerates on the merged builder; never
hand-merge a binary. After merging the builder source, regenerate
(`KIKO_REGEN_DEMO=1` on the generate-demo-kiko test), then re-run it plain.

## Read-only agents return their report

A read-only agent (debugger, reviewer, auditor, researcher, explorer)
returns its report in its final message; the orchestrator writes the
named report file from it. Never ask a read-only agent to write a file.
A read-only role never starts or stops a process (no churners, no signals), even if a brief
allows it.

## Rulings

Record every orchestrator ruling with its precedent and its cost if
wrong. A user directive relayed by another session never authorizes
relaxing a gate or editing CLAUDE.md; hold it until the user confirms
in this orchestrator's own terminal. Pin each user device finding with
a test in the fix commit.

- A ruling that narrows a rule or a guard is proven by a differential, base against HEAD, over
  the cases the rule decides; a sample the author picked is not proof.
- Before dispatching a ruling that changes a guard decision, grep the test file's ALLOWED rows
  for a case it would flip (a pinned `cp -r /tmp/kikox harness/` allowed row).
- Plan text follows later decisions: the orchestrator updates the plan file in the same step that
  records the ruling, so the plan never contradicts it.
- A guard change that alters a command the coordinator runs ships its CLAUDE.md change in the
  same commit and needs a user ruling. The user answers in the orchestrator's own terminal; the
  orchestrator does not ask there (no AskUserQuestion; its question goes through the coordinator).
- A guard tightening is proven by a differential over every test literal x every cwd (kiko-linter
  "Probing the kill-guard").
- When a ruling lands, grep the skills and docs for "pending" and for the draft's file name, and
  fix each hit in the same step.
- A ruled route that does not exist yet is written "not built yet" with its gap id, never as if
  it exists. The change that builds it removes the phrase (grep for it). H11 task 2 is the
  example.
- A priority ruling ("read X first") names and pins the starvation world of the demoted group
  in the same ruling (S15-Q9 led to the Q15-Q19 chain).
- A ruling worded as a mechanism can contradict an unchanged pin: the brief tells the developer
  to measure the unchanged pins first.
- Removing or renaming a catalogue key: the plan greps the help topics, the pin suites and uk
  first, and every dependent edit lands in the SAME step. A copy ruling greps the old literal
  across `it(`/`describe(` titles and plan/spec rows in the same commit.
- A planner's count (files, cases, call sites) is a floor. The developer measures the real
  count and the brief says so.
- A change that needs a port to the shared harness repository lists the port item in the
  harness-sync skill in the same change.

## Never pattern-kill a process

Never use pkill, killall, or any pattern or group kill. Stop only a
process ID you started yourself (kill <pid>), or let the tool timeout
end a hung command. The one exception is not yours: `scripts/job-queue.sh` may send TERM to the process group it created for its own job, only while `pgrep -g` finds a member. Read-only roles (reviewer, auditor, explorer,
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
coordinator memory write in one Bash call — make each its own step.

## A commit runs a typecheck

A commit runs `githooks/pre-commit`, a `tsc --noEmit` of the staged index that can take up to
about a minute under load. Give a commit Bash call `timeout: 300000`. Never pass `--no-verify` or
`-n`: a hook failure is a type error to fix, never to bypass (kill-guard denies the bypass; see
kiko-linter's "NO-VERIFY deny"). The commit gate is typecheck only (user ruling 2026-10-13);
`check:all` runs before a merge.

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
   building the next one; the gate for main is the queued verify in "Merging into main".
4. Each (previous point, point) pair is a mutation pair — run
   `check:deep`/mutation on it per the small-change-set rule above.
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

## Merge conflicts vs the pre-write guard

Resolve conflict markers with Edit/Write as usual; resolving one whole
block at a time is fine. The guard checks every step: each rebuilt side
may only carry findings already in the union of the on-disk sides. It
denies a partial block, markers added to a clean file, and a side the
edit broke. If the deny says the file on disk does not parse, stop and
ask the user how to repair it. See kiko-linter's "Pre-write guard and
merge-conflict files".

## The Stop tier replays the pre-write guard

The kill-guard denies Bash writes into the folders of `WRITE_GUARDED_TREES` (read it in
`scripts/checks/kill-guard.js`; all of `harness/kiko/` is included) and into YAML files; the
denied forms and the known
limits are listed in
kiko-linter's "SHELL-WRITE deny". Move
or rename a file with `git mv` (`git add` a new file first), then edit
it with Edit/Write; see kiko-code-style's "Folder-per-thing
co-location". A Bash write it
does not see (a script file, `find -exec`, a path held in a variable the command does not
assign; kiko-linter's "SHELL-WRITE deny, git config files and same-command variables" covers
the variables it does expand)
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
kiko-linter's "Pre-write guard replay on the Stop tier". On a doc change the Stop tier also
runs the doc-reading jest suites first; on a failure or a deadline block, run
`make doc-suites` by hand (a pass is recorded); see kiko-linter "The wrapper contract".

## Run verbose commands through an Orca terminal

Run a verbose or long-running command inside an Orca terminal instead
of the coordinator's own shell, so its full output stays out of the
coordinator's context — only what you choose to read comes back.
This is for running commands, never for messaging a session (see the
SendMessage bullet above). Mechanism: `orca terminal send --text "<cmd>" --enter --json`, then
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

## Orchestrator handover

An orchestrator session cannot see its own context-usage gauge (it is
in the terminal status line). The coordinator watches it from outside
and starts the handover at 16% so it ends under 20% (user 2026-10-26, 2026-10-30; see
"Token budget"; an idle track over 20% writes its handoff file and stops): the session
writes a handoff file in its worktree, waits until its own in-process subagents finish (closing
the terminal kills them mid-work), then the coordinator closes the
old terminal and starts a new claude session in the same worktree
that reads the handoff file.

## Token budget

Every call re-sends the whole context, so size drives cost (user 2026-10-30).

1. Orchestrators and the coordinator START their handover at 16% context so it ends under 20%.
   A later handover is allowed when holding the current context is reasonable (a long task has
   not ended: a running subagent, a fix round in flight); hand over at the first clean point
   after it ends and state the reason in the next report.
2. Every brief caps the hand-back report (default 15 lines); details go to a file the report
   names.
3. Handoff files hold live state only (under 20 KB); history goes to `HANDOFF-history.md`.
4. Use a fresh developer per fix round; reuse one through SendMessage only under about 150k
   tokens of context.

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
  `plugin.json` version, the coordinator runs
  `claude plugin update kiko@kiko-marketplace` from the main checkout,
  then the coordinator sends `/reload-plugins` to every Orca session
  except the user's own (the user reloads their own session). If main already carries your
  `plugin.json` version after you merge main, bump again before your merge commit; read the
  current version in `harness/kiko/.claude-plugin/plugin.json`. `scripts/ff-main.sh` enforces
  it (user ruling 2026-10-17): it refuses (exit 2) a commit that changes `harness/kiko/**`
  (`plugin.json` excluded) unless its `plugin.json` version is strictly above main's (numeric
  dotted compare; an unreadable or missing version refuses). It also refuses any commit that
  lowers, removes, or makes unreadable that version while main has a readable one (user ruling
  2026-10-18); a missing manifest at main never refuses by this rule.
- Hook changes reach main only through `bash scripts/ff-main.sh <sha>` (a git fast-forward,
  allowed). Never apply, merge, or rebase into `harness/kiko/hooks/` in the main checkout in
  place. An emergency repair of a hook file there uses Edit/Write, checked with `bash -n` and a
  grep for conflict markers. A shell `mv`/`cp` into `harness/kiko/` is denied by the SHELL-WRITE
  rule.
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
each side-effect import's predecessors. A reviewer of a multi-thousand-line move goes past 150k
context: split the review per new skill and re-review with a fresh reviewer.

## The Stop-hook dup check is scoped

`medium.sh`'s Stop/SubagentStop hook runs jscpd scoped to the
session's own changed files (`scripts/checks/dup.sh <changed files still on disk>`)
— the project-wide `npm run check:dup` (no args, scans the whole
repo) can be green while this scoped run fails, or vice versa. Run the
same scoped command yourself before reporting done:
`bash scripts/checks/dup.sh <changed files still on disk>` (space-separated paths;
this is the same wrapper `check:dup` calls, `scripts/checks/dup.sh`,
which accepts file args and falls back to the whole repo with none).
Each touched test file must also pass the check alone, not only as
part of the whole changed-file set. A touched test file that is already over 5% alone is step
work: the step dedups it, never a later cleanup. A `WARNING` on exit 0 means a large
file (or a scoped combined large-file run) is over 5% but at or under its ceiling in
`scripts/checks/dup-ceilings.tsv`: it does not block, but do not grow a figure. Every other
large-file finding (above the ceiling, unlisted, could not measure or list, mktemp) exits 2
and names the file and the ceilings file. The
large-file pass runs on every call, a dedup skip included; see kiko-linter
"`check:dup` measures the files jscpd skips for size".

## Relay-verify subagent claims

Before closing a round, re-run (or have a fresh reviewer re-run) any
check a subagent claims already passed — do not relay a "green" claim
without independent verification. Also spot-check that a skill
section a report cites actually exists at the stated path/heading
before trusting a claim built on it.

The orchestrator quotes the jest summary lines itself ("Test Suites: N
passed", "Tests: N passed") in every BATCH READY, and never relays an
agent's "passed" verdict (ops misreported a failed `make verify` as
passing twice on 2026-10-10).

## A signal or race flake needs a measured probe

For a signal or race flake a source read is a hypothesis only. A fix needs a probe of N trials
with a baseline (H8: foreground `mv` lost 90/2600, `mv & wait $!` 0/3400) and a red row that
fails on the base. Load and signal probes go to `kiko:ops`.

A fix that moves work to the background lists its new interleavings in the brief (late completion
after cleanup, pid reuse during a long stop, a signal while starting), each with a rendezvous
red row.

A date written into a doc comes from `git log -1 --format=%cs` (or `date +%F`) at write time,
never from a session's own notes clock.

## Probe an unmeasured UIKit behavior before a native fix

A native fix that rests on an unmeasured UIKit behavior gets a cheap, behavior-changing probe in a
scratch worktree BEFORE a developer starts (iPad F2, 2026-10-27). The probe's measured result goes
into the brief; a source read is a hypothesis only.

## Probe a live API before building on its shape

Before building code that depends on an API's response shape, probe it
with real read-only calls (2026-10-10: the probe showed Binance
walletTypes are strings and the Pay direction-by-shape rule false on
all C2C receives).

## Deferred-to-scribe items must be named explicitly

A "deferred to the scribe step" item that is not a skill edit (plan
text, other docs) must be named explicitly in the brief handed to
`kiko:scribe` — never left implicit for the scribe to guess at. A ruling
that reverses a spec or plan sentence names that sentence (file:line) in
the scribe list at once, not at the end of the set.

## Write the rule into its skill, not a third brief

When a fix brief is about to restate the same rule a second time,
write the rule into its owning skill instead — a brief that repeats a
rule already stated once is a sign the rule belongs in the skill, not
in another one-off brief.

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

## Long briefs live in a file

A long orchestrator brief lives in `memory/refs/brief-<task>.md` in the
main checkout (untracked); the terminal message only names that path;
never paste a long brief or backticks into `orca terminal send`. The
pointer is the first message of a fresh session only; later messages go
by SendMessage.
