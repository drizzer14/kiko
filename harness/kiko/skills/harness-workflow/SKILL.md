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
- "DEFAULT, pending user" means apply it now, not merely record the decision and leave the old behavior in place. A fix round that states a DEFAULT ruling must change the code in that same round — a later round should never have to circle back to actually apply a decision an earlier round only annotated (confirmed drift case: `5b5137f`).

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
and hands over at about 70%: the session writes a handoff file in its
worktree, waits until its own in-process subagents finish (closing
the terminal kills them mid-work), then the coordinator closes the
old terminal and starts a new claude session in the same worktree
that reads the handoff file.

## Orchestrator defaults never widen or contradict

An orchestrator's default choices never contradict an established
design or code pattern, and never widen a user instruction beyond
what was asked; take the narrowest reading.

## UI feedback rounds: audit before fixing

Before fixing a round of UI feedback, run a UX-consistency audit of
the affected screens against `kiko-design-system` and against how
the same pattern is already built elsewhere; fix the pattern
everywhere it appears, then distill new rules into the skill.

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
part of the whole changed-file set.

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
