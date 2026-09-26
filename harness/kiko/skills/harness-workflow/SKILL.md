---
name: harness-workflow
description: Use when coordinating Kiko work. States the delegation rule and points to the superpowers process skills.
---

The coordinator delegates all work to the harness agents. The coordinator never edits app files inline.

Rules:
- Split complex or parallel work into separate Orca worktrees (orca-cli).
- If no agent fits a task, report the gap. Do not do the task inline.
- Route web research and live API checks to `kiko:researcher` (read-only,
  cites a source URL + check date per claim); it writes no files, so the
  caller persists any durable finding via `kiko:scribe`.
- For a device-test request, copy `kiko:ops`'s "Device verification
  checklist" section into the request to the user.
- Use these superpowers skills directly: brainstorming, writing-plans, executing-plans,
  subagent-driven-development, dispatching-parallel-agents, verification-before-completion,
  finishing-a-development-branch.
- On completion, an orchestrator or role agent SendMessages the coordinator session that dispatched the work with the result (the final commit sha and a one-line summary). This is the standing default, so an orchestrator brief does not need to restate it.

## Skill drift rule

After every completed code iteration (a feature, phase, or fix that is
developed and tested/gated), before the next iteration or the merge:
run `kiko:retrospect` to verify BOTH skill locations
(`.claude/skills/` and `harness/kiko/skills/`, plus
`harness/kiko/agents/`) against the new code, then `kiko:scribe` fixes
any drift found and commits it. The completion report names the
drift-fix commit sha, or states "no drift found" with the retrospect
result.

## Never pattern-kill a process

Never use pkill, killall, or any pattern or group kill. Stop only a
process ID you started yourself (kill <pid>), or let the tool timeout
end a hung command. Read-only roles (reviewer, auditor, explorer,
debugger, pm, retrospect) do not stop processes at all. The
PreToolUse hook on `Bash` (`scripts/checks/kill-guard.sh`, wired in
`harness/kiko/hooks/hooks.json`) denies these commands
mechanically — this rule states it for agents to follow directly, not
just get blocked by.

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

- Hooks run from the plugin CACHE copy
  (`~/.claude/plugins/cache/kiko-marketplace/kiko/<version>`), not the
  checkout. A change under `harness/kiko/` is live only after: bump the
  `plugin.json` version, the user runs
  `claude plugin update kiko@kiko-marketplace`, then `/reload-plugins`.
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
- Run a fix round only for Critical/Important findings. Batch minors
  into the next phase.

## Orchestrator defaults never widen or contradict

An orchestrator's default choices never contradict an established
design or code pattern, and never widen a user instruction beyond
what was asked; take the narrowest reading.

## UI feedback rounds: audit before fixing

Before fixing a round of UI feedback, run a UX-consistency audit of
the affected screens against `kiko-design-system` and against how
the same pattern is already built elsewhere; fix the pattern
everywhere it appears, then distill new rules into the skill.
