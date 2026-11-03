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
  from the run log (see "Run log" in `references/run-log.md`), not from hand-written text.
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
  track merged next" in `references/mutation-testing.md`).

## Reference files

Read a reference file when its topic is your task; the core is enough otherwise. Paths are
relative to this skill's base directory. Each file keeps its original headings, so a citation
of a heading resolves in the file that holds it. One bullet per file: the topic, the file, and
the entries it holds (each `##` heading and each bold lead).

- [references/run-log.md](references/run-log.md) — read when you start, log or finish a run.
  Holds Run log (start, event, finish, gap, start and finish rule, stats).
- [references/mutation-testing.md](references/mutation-testing.md) — read when you size, queue
  or read a mutation gate. Holds Mutation testing: small change sets only, Mutation base
  after a track merged next, and Status is on demand.
- [references/merging.md](references/merging.md) — read when you merge into main or stack
  merges. Holds Merging into main, Merge pattern: one conditional, gated on the conflict test,
  and Stacked merge points for gated tracks.
- [references/guards-and-rulings.md](references/guards-and-rulings.md) — read when a guard
  denies a command or write, or you record a ruling. Holds Rulings, Never pattern-kill a
  process, Never git stash; always quote a heredoc delimiter, A commit runs a typecheck,
  A write can be denied before it lands, Merge conflicts vs the pre-write guard, and
  The Stop tier replays the pre-write guard.
- [references/plugin-and-hooks.md](references/plugin-and-hooks.md) — read when you change a
  hook, an agent or a skill. Holds Harness hook changes go live only after a plugin update.
- [references/queue-and-terminals.md](references/queue-and-terminals.md) — read when you queue
  a job or run a long command. Holds Run verbose commands through an Orca terminal and
  Load rule.
- [references/review-and-probes.md](references/review-and-probes.md) — read when you review,
  probe or brief a scribe. Holds Review cadence, Orchestrator defaults never widen or
  contradict, UI feedback rounds: audit before fixing, Classify every finding, Large reviews,
  The Stop-hook dup check is scoped, Relay-verify subagent claims, A signal or race flake needs
  a measured probe, Probe an unmeasured UIKit behavior before a native fix, Probe a live API
  before building on its shape, Deferred-to-scribe items must be named explicitly, and
  Write the rule into its skill, not a third brief.

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

## Read-only agents return their report

A read-only agent (debugger, reviewer, auditor, researcher, explorer)
returns its report in its final message; the orchestrator writes the
named report file from it. Never ask a read-only agent to write a file.
A read-only role never starts or stops a process (no churners, no signals), even if a brief
allows it.

## Orchestrator handover

An orchestrator session cannot see its own context-usage gauge (it is
in the terminal status line). The coordinator watches it from outside.
An orchestrator STARTS its handover at 20% context; the coordinator starts its own at 16%
(user 2026-11-03; see "Token budget"; an idle track over 20% writes its handoff file and
stops): the session
writes a handoff file in its worktree, waits until its own in-process subagents finish (closing
the terminal kills them mid-work), then the coordinator closes the
old terminal and starts a new claude session in the same worktree
that reads the handoff file.

## Token budget

Every call re-sends the whole context, so size drives cost (user 2026-10-30).

1. Orchestrators START their handover at 20% context; the coordinator STARTS its own at 16%
   (user 2026-11-03). A later handover is allowed when holding the current context is reasonable
   (a long task has not ended: a running subagent, a fix round in flight); hand over at the
   first clean point after it ends and state the reason in the next report.
2. Every brief caps the hand-back report (default 15 lines); details go to a file the report
   names.
3. Handoff files hold live state only (under 20 KB); history goes to `HANDOFF-history.md`.
4. Use a fresh developer per fix round; SendMessage reuse is only a same-task re-review by
   the SAME agent (the fresh-agent bullet on task naming).

## Approved visuals and open user requests

- Never change or revert a user-approved visual without explicit user
  approval, including in a cleanup that calls it "exploratory". Locked
  visual decisions live in `kiko-design-system`.
- Track every open user request until it is device-verified.

## Long briefs live in a file

A long orchestrator brief lives in `memory/refs/brief-<task>.md` in the
main checkout (untracked); the terminal message only names that path;
never paste a long brief or backticks into `orca terminal send`. The
pointer is the first message of a fresh session only; later messages go
by SendMessage.
