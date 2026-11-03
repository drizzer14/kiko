---
name: kiko-competitors
description: Invoke whenever you do a competitor comparison, a gap review, or answer what other apps do (what a competitor budgeting, banking or portfolio app has that Kiko lacks), or before you cite a competitor fact, an exchange research fact, or the last gap review. Read before you start a new review, before you claim that Kiko lacks a feature, and before you add a competitor fact to a report or a plan. Facts live in the data file beside this skill; for the 2.5.19 rule see kiko-architecture.
---

# Kiko competitors

Facts live in the data file; read the level of a row before you rely on it.

- [competitor-facts.md](competitor-facts.md) — "Evidence levels (sections A to D)"; "A. Feature
  facts (check date 2026-11-02 for every row)": rows with levels per app; "B. Gaps and
  negative findings (2026-11-02)"; "C. Weak demand notes ("Most requested by users")";
  "D. Pages that failed, and what was not read"; "E. Exchanges (checked 2026-10-15, not
  2026-11-02)": own check date and own wording; "F. Last gap review (2026-11-02)": the
  coordinator's judgment with no user ruling.

## Procedure for a new review

1. Run two read-only agents in parallel. `kiko:explorer` inventories Kiko from the code.
   `kiko:researcher` lists competitor features WITHOUT seeing the Kiko list, so the list is not
   anchored on ours. Both return reports; the caller writes files.
2. The coordinator compares the two lists.
3. Re-verify every "absent from Kiko" with a grep of the code before it goes in a report. A
   claim that Kiko lacks a feature is not accepted from the inventory alone.
4. Researcher rows carry a source URL, a check date and an evidence level: READ, SEARCH or
   UNVERIFIED, defined under "Evidence levels" in
   `.claude/skills/kiko-competitors/competitor-facts.md`.

## Fit filter (check each candidate)

Report the line that a candidate fails. Only the user rules on it or changes a rule.

- No Kiko server.
- Data stays on the device.
- Guideline 2.5.19: see `.claude/skills/kiko-architecture/SKILL.md`, "Guideline 2.5.19 — no
  hidden features".
- Users are Ukrainian and displaced.
- Kiko answers how much money do I have now: budgets, savings goals and other future planning
  fail this line (user ruling 2026-11-03).
- Standing rulings: shares cut 2026-10-02 (broker accounts and bonds stay; a return needs a new
  design). Bybit is in 1.4 (the coordinator's task brief of 2026-11-02; spec R-Scope and the older
  plan text say 1.3-b). OKX and later
  exchanges need a key: ship only exchanges verified on device with a real key. The exact words
  are R-Scope at docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md:85.

## Update rules

- A fact older than 6 months is re-checked before anyone relies on it.
- Never fill a fact from memory: mark it UNVERIFIED or leave it out.
- Every new review updates the data file: new check date, level, and the last gap review
  section (F).
- A re-check promotes a level only through a new read of the page, with a new date.
