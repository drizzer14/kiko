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
- Name the scribe's drift-fix commit sha (or "no drift found") in your
  report, per the standing rule.
- Hand each lesson (and any drift found) to the scribe to persist. Do
  not edit the plugin yourself.
