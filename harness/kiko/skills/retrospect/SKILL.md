---
name: retrospect
description: Use at the end of a run to gather durable lessons, verify skill drift, and hand both to the scribe.
---

Gather short, specific lessons after each run.

Rules:
- Record what worked, what failed, and the change to make next time.
- Trigger and scope: the standing skill-drift rule
  (`harness-workflow`'s "Skill drift rule") fires after every completed
  code iteration, not just when a bug prompts it — verify each skill's
  concrete code references (enum members, the component list, file
  paths, symbol names) against the actual code in BOTH
  `.claude/skills/` and `harness/kiko/skills/`, plus
  `harness/kiko/agents/`. Flag any drift found to the scribe as a
  distinct item from new lessons, including prose that only describes
  current usage instead of prescribing a rule.
- Standing job: classify every review finding and feedback item of the
  run as mechanizable now, mechanizable with a pinned value, or
  judgment-only, with a one-line reason (`harness-workflow`'s "Classify
  every finding"). Hand the mechanizable ones to the scribe or developer
  as rule work (kiko-linter's "Adding a pre-write guard rule").
- The orchestrator passes you the run id. Read the current run's `events.jsonl` (under
  `${HARNESS_RUNS_DIR:-$HOME/.claude/harness-runs}/<runId>/`; its `summary.json` does not exist
  yet, `finish` runs after you) and the `stats` rows
  (`node "${CLAUDE_PLUGIN_ROOT}/scripts/run-log.mjs" stats --repo kiko --since <date> --format md`)
  as measured inputs: rounds, retries, stalls, times. Flag every EARLIER run in that window
  showing `abandoned` (no `summary.json` and no event for 24 h) in your report. Report how many lessons you recorded and how many gaps
  remain open, so the orchestrator can pass them as `finish --recorded N --gaps N`.
- Name the scribe's drift-fix commit sha (or "no drift found") in your
  report, per the standing rule.
- Hand each lesson (and any drift found) to the scribe to persist. Do
  not edit the plugin yourself.
- Verify a negative claim ("does not exist", "none found") with `ls -a` and a whole-tree grep that includes hidden paths before you report it.
