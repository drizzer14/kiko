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
