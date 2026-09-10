# Phase B implementation plan — 10-item feedback round

Author: kiko:planner. Ground: worktree binance-category-fix @ e9d6895, which
approximates the post-Phase-A main.

## Scope and ground rules

- This plan covers the 10 locked feedback items plus one durable harness change.
- All 10 design decisions are LOCKED (see planner-brief.txt). Do not re-open
  them. This plan only orders and structures the work.
- Every file:line reference points at the source of truth in
  `scratchpad/exploration-report.md`. This plan does not copy enumerable data.
- Execution model: subagent-driven. Each task is one discrete unit of work with
  a brief, a TDD cycle (RED then GREEN), a `kiko:reviewer` pass, and skill
  upkeep in the SAME task.
- Delegation rule holds: the coordinator delegates every task to a role agent in
  the worktree. The coordinator never edits app files inline.

## Branch and commit

- Phase B runs on a FRESH branch cut from `main` AFTER Phase A merges. That
  branch does not exist yet.
- This plan doc is committed onto the Phase B branch at branch creation. It
  never enters the repo before that. Keep it in the scratchpad until then.

## Migrations

- No database migration is expected in this whole round. State this in every
  task brief.
- Item 1 needs NO schema or form change: a bond has no `contributions` data
  (`holding-metadata.ts:17-26`). The change is a label/gate only.
- Item 4 needs NO schema change: the converted value is render-only and uses the
  existing rate table (`account-detail.screen.tsx:121-122`,
  `rates/net-worth-view.ts`, `rates/conversion.ts`).

## Every designer task cites iOS HIG

- Belt-and-suspenders rule for this round: EVERY designer task brief must cite
  iOS Human Interface Guidelines (HIG) explicitly — touch targets >= 44pt, SF
  Symbol sizing against Dynamic Type, spacing, contrast, and materials/glass.
- This applies even before the durable agent update (Task 0.2) merges, so the
  round's design work stays HIG-grounded from the start.

---

## Phase order and dependencies

1. Phase 0 — Foundation. Task 0.1 (icon-size token + HIG audit) is the FIRST
   task; items 5, 6, 7 consume its token. Task 0.2 (durable HIG awareness) runs
   in parallel inside Phase 0.
2. Phase 1 — Domain. Runs in PARALLEL with Phase 0. No dependency on the icon
   token. Two developer tasks.
3. Phase 2 — Design-system consumers. Starts AFTER Task 0.1 lands. Items 5, 6,
   7 use the new icon-size token and the ghost-button-with-icon pattern.
4. Phase 3 — Surfaces and filter. Glass consistency (items 2, 10) and the trend
   filter (item 9). Item 9's hierarchy step consumes the Task 0.1 HIG contrast
   guidance, so it follows Phase 0.
5. Phase 4 — Verification. Item 3 is a no-op documentation task.

Cross-owner coordination flags appear per task.

---

## Phase 0 — Foundation (start first)

### Task 0.1 — Icon-size token scale plus iOS HIG audit  (owner: DESIGNER)
- Goal: add a consistent icon-size token scale to the theme, tied to the
  typography tokens (`theme.ts:20-28`), and define one icon-to-text ratio. No
  icon-size token exists today; call sites use inline `18`/`20`
  (`symbol.component.tsx:14` default 20; button icon 18 at
  `button.component.tsx:58`; list rows 18; cards 20).
- Also: audit the whole app against iOS HIG (touch targets >= 44pt, SF Symbol
  sizing vs Dynamic Type, spacing, contrast, materials/glass) and record the
  violation list in the task output. Items 5/6/7/9/10 read this list.
- Deliverable: the token scale in the theme, plus the ratio rule and the HIG
  violation list. Do NOT migrate every call site here; the consuming tasks swap
  their own inline sizes to the token.
- TDD: RED — a unit assertion that the icon-size tokens exist on the theme and
  map to the intended values; GREEN — add the tokens. Snapshot/style assertions
  where a token feeds a rendered size.
- Skill upkeep: update `.claude/skills/kiko-design-system/SKILL.md` — add the
  icon-size token scale and the ratio rule, pointing at `theme.ts` as the source
  of truth (do not copy the numbers). Cross-check `kiko-code-style` for any
  icon-size guidance.
- Reviewer: `kiko:reviewer` pass.
- HIG: cite HIG in the brief (this task defines the HIG baseline).

### Task 0.2 — Durable HIG awareness for the designer  (owner: SCRIBE)
- Goal: make the designer permanently HIG-aware, not only for this round.
- Change 1: `harness/kiko/agents/designer.md` — add a standing rule that the
  designer references iOS HIG on EVERY task (touch targets >= 44pt, SF Symbol
  sizing vs Dynamic Type, spacing, contrast, materials/glass).
- Change 2: `.claude/skills/kiko-design-system/SKILL.md` — state iOS HIG as the
  standing reference for tokens, sizes, and materials, pointing at the source of
  truth, not copying enumerable data.
- No app code. No TDD cycle (docs only); verify by re-reading the two files.
- Reviewer: `kiko:reviewer` pass on the two edited files.
- Note: this change lands on the Phase B branch and reaches main when Phase B
  merges. It coordinates with Task 0.1 on the SAME `kiko-design-system` skill —
  sequence 0.1 then 0.2, or have one agent own both edits, to avoid a collision
  on `SKILL.md`.

---

## Phase 1 — Domain (parallel with Phase 0)

### Task 1.1 — Bond footer button label  (owner: DEVELOPER)
- Goal: a bond must not read "Add contribution". Change `isContribution` to
  cover `term_deposit` only (`holding-detail.screen.tsx:175`); the bond footer
  button then shows the generic add-transaction label
  (`holdingDetail.addTransaction`, already navigating to `TransactionForm` at
  `:227-232`).
- No schema or form change. No new derived-entry kind.
- Check: confirm no i18n string is missing; the generic label already exists.
- TDD: RED — a test asserting the bond footer button renders the
  add-transaction label (not addContribution); GREEN — the gate change.
- Skill upkeep: check `kiko-domain` (holding types and the deposit/bond split)
  and `kiko-translator` (the two footer labels). Update if either describes the
  old bond-as-contribution wording.
- Reviewer: `kiko:reviewer` pass.

### Task 1.2 — Holding-card secondary main-currency value  (owner: DEVELOPER; coordinate DESIGNER)
- Goal: under the holding's native `MoneyText`, show a smaller (caption tone)
  main-currency converted value, ONLY when the holding currency differs from the
  base currency. Account cards already show the base currency — leave them.
- Widen `HoldingCard` props to accept `baseCurrency` + `rateTable`
  (`holding-card.component.tsx:29-33`). Both are available at the render site
  (`account-detail.screen.tsx:121-122,358`). Convert with the existing utility
  (`rates/conversion.ts`).
- Design-system choice: add a secondary slot to `MoneyText`
  (`money-text.component.tsx`), OR render a sibling caption `Text`. If the
  secondary slot lands INSIDE `MoneyText`, coordinate with the DESIGNER, because
  that is a shared design-system component.
- No schema change (render-only).
- TDD: RED — tests for (a) same-currency holding shows no secondary value,
  (b) cross-currency holding shows the converted caption value; GREEN —
  implementation.
- Skill upkeep: check `kiko-domain` (Money, currency), `kiko-design-system`
  (MoneyText) if the secondary slot lands there, and `kiko-code-style`. Update
  the affected skill.
- Reviewer: `kiko:reviewer` pass.

---

## Phase 2 — Design-system consumers (after Task 0.1)

### Task 2.1 — Delete button becomes a red ghost  (owner: DESIGNER spec + DEVELOPER wiring)
- Goal: the transaction edit-form delete button moves from solid `destructive`
  (`transaction-form.screen.tsx:540`) to a red ghost:
  `variant="ghost" textColor={theme.colors.negative}`, mirroring the existing
  override-cancel button (`:1138`).
- DESIGNER: confirm the red-ghost destructive treatment against HIG (contrast of
  a red label on the ghost surface, touch target). DEVELOPER: wire the variant.
- TDD: RED — a test asserting the delete button renders the ghost variant with
  the negative label color; GREEN — the swap.
- Skill upkeep: check `kiko-design-system` (Button variants) and
  `kiko-code-style`. Update the Button variant guidance if needed.
- Reviewer: `kiko:reviewer` pass.
- HIG: cite HIG in the brief.

### Task 2.2 — Icons on ghost buttons  (owner: DESIGNER picks icons + DEVELOPER)
- Goal: add the right SF Symbol per ghost button (for example `trash` on the
  delete button). `Button` already supports `icon`/`trailingIcon` via
  `SymbolIcon` (`button.component.tsx:18-19,58-62`). The icon size uses the
  Task 0.1 icon-size token (replace the inline `18`).
- DESIGNER: pick the symbol and placement (leading vs trailing) per button, per
  HIG. DEVELOPER: wire the icon prop and the token size.
- This task defines the ghost-button-with-icon pattern that Tasks 2.1 and 2.3
  consume; sequence it with, or just after, 2.1.
- TDD: RED — a test asserting the ghost button renders its chosen symbol at the
  token size; GREEN — implementation.
- Skill upkeep: check `kiko-design-system` (Button icon slot, icon-size token)
  and `kiko-code-style`. Update as needed.
- Reviewer: `kiko:reviewer` pass.
- HIG: cite HIG in the brief.

### Task 2.3 — Reuse ghost buttons on the settings category cards  (owner: DESIGNER + DEVELOPER)
- Goal: replace the hand-rolled `Pressable`+`SymbolIcon` controls on the
  category cards (`categories.screen.tsx:211-284`: set-default `star`, delete
  `trash`, reorder `arrow.up.to.line`/`arrow.down.to.line`) with the shared
  icon-only ghost `Button`. Keep the red tint on delete.
- Uses the icon-size token (Task 0.1) and the icon pattern (Task 2.2).
- DESIGNER: confirm icon-only ghost button geometry and touch target >= 44pt per
  HIG. DEVELOPER: swap the controls, preserve accessibility labels and handlers.
- TDD: RED — tests asserting each action renders a ghost Button with the right
  symbol and keeps its handler and accessibility label; GREEN — the swap.
- Skill upkeep: check `kiko-design-system` (Button reuse, ghost pattern) and
  `kiko-code-style` (no hand-rolled controls when a shared component fits).
  Update the "always use shared components" guidance if present.
- Reviewer: `kiko:reviewer` pass.
- HIG: cite HIG in the brief.

---

## Phase 3 — Surfaces and filter

### Task 3.1 — Calendar background transparent  (owner: DESIGNER)
- Goal: set the `KikoCalendar` background transparent so the glass `BottomSheet`
  shows through. Drop the opaque `surfaceHigh` block
  (`kiko-calendar.theme.ts:36,52`). Consistent with item 10.
- Verify both call sites read correctly: the single-day date field
  (`date-field.component.tsx:97-106`) and the Home date-range field.
- TDD: RED — a unit assertion on `buildCalendarTheme` that the calendar
  background is transparent (not `surfaceHigh`); GREEN — the change.
- Skill upkeep: check `kiko-design-system` (surfaces/materials, the calendar
  theme mapping). Update if it documents the opaque calendar background.
- Reviewer: `kiko:reviewer` pass.
- HIG: cite HIG (materials/glass) in the brief.

### Task 3.2 — Extend glass to the two list-row types  (owner: DESIGNER)
- Goal: apply `GlassSurface` to the two list-row types — Home transaction rows
  (`home.screen.tsx:412`) and holding-detail ledger rows
  (`holding-detail.screen.tsx:336`). Form inputs and progress tracks stay
  controls (no glass). The DESIGNER decides the FINAL set per HIG.
- Watch the swipe interaction on the holding-detail rows: the row sits inside a
  `SwipeableRow` (`holding-detail.screen.tsx:324`); confirm glass corners and
  the reveal still render correctly (see `swipeable-row` glass notes).
- TDD: RED — tests asserting each row type renders a `GlassSurface` (testID);
  GREEN — the wrap. Keep the existing row layout and handlers.
- Skill upkeep: check `kiko-design-system` (GlassSurface usage list, materials).
  Update the usage guidance to include the two row types.
- Reviewer: `kiko:reviewer` pass.
- HIG: cite HIG (materials/glass, contrast on translucent rows) in the brief.

### Task 3.3 — Trend filter chips and manual-list scroll  (owner: DEVELOPER + DESIGNER)
- Target: the TREND filter (`TrendFilterField` / `OptionPills`), NOT the pie
  `FilterMenu`.
- Change 1: center the chip text — `option-pills.styles.ts:25-26`,
  `justifyContent: 'flex-start'` becomes `center`. Confirm no other OptionPills
  call site depends on left alignment (`CurrencySwitch`, `LanguageSwitch`,
  and the trend controls).
- Change 2: strengthen the selected/unselected hierarchy. Today selected is
  `textPrimary`, unselected `textSecondary` (`option-pills.component.tsx:54`).
  Make the difference clearly stronger per HIG (the DESIGNER sets the exact
  treatment — weight, fill, or tone).
- Change 3: verify the manual-mode category list scrolls itself with pinned
  Save/Clear (`trend-filter-field.component.tsx:145,149-254`: sheet
  `scrollable={false}` plus an inner `ScrollView`, actions outside it). Fix if
  the whole modal scrolls instead of the inner list.
- DESIGNER owns the alignment and hierarchy spec; DEVELOPER owns the code and
  the scroll fix.
- TDD: RED — tests for (a) centered chip text, (b) the stronger selected style,
  (c) the manual list scroll region vs pinned actions; GREEN — implementation.
- Skill upkeep: check `kiko-design-system` (OptionPills alignment and states)
  and `kiko-code-style`. Update the OptionPills guidance. `kiko-charts` is NOT
  in scope — the filter is a control, not a chart.
- Reviewer: `kiko:reviewer` pass.
- HIG: cite HIG (contrast, selected-state clarity, touch target) in the brief.

---

## Phase 4 — Verification

### Task 4.1 — Confirm syncable transactions are not editable  (owner: DEVELOPER; no code)
- Goal: document item 3 as ALREADY SATISFIED, with evidence. Write no app code.
- Evidence to record: `isReadOnly = existing.source !== 'manual'`
  (`transaction-form.screen.tsx:658`) covers every synced source; swipe-delete
  is gated by `isSyncedTransaction` (`holding-detail.screen.tsx:326`,
  `deletable.ts:12`); Home has no delete path; the category stays editable on a
  synced row by design (`transaction-form.screen.tsx:506-510`).
- Optional hardening: a regression test that asserts a non-`manual` transaction
  opens the form read-only and cannot be swipe-deleted, if such a test does not
  already exist. This guards the invariant without changing behavior.
- Skill upkeep: none required (behavior unchanged). If a regression test is
  added, confirm `kiko-code-style` test conventions.
- Reviewer: `kiko:reviewer` pass if a test is added; otherwise no review needed.

---

## Owner grouping (quick view)

- DESIGNER: 0.1, 2.1 (spec), 2.2 (icons), 2.3 (spec), 3.1, 3.2, 3.3 (spec).
- DEVELOPER: 1.1, 1.2, 2.1 (wiring), 2.2 (wiring), 2.3 (wiring), 3.3 (code),
  4.1.
- SCRIBE: 0.2.
- REVIEWER: one pass per code task.

Cross-owner coordination points: 0.1 -> 0.2 (same `kiko-design-system` skill);
1.2 (MoneyText secondary slot, if inside the shared component); 2.1/2.2/2.3
(shared ghost-button pattern and icon token); 3.3 (OptionPills spec vs code).

## Dependency summary

- Task 0.1 blocks Phase 2 (items 5/6/7) and the hierarchy step of Task 3.3.
- Phase 1 (1.1, 1.2) has no dependency on Phase 0 and runs in parallel.
- Tasks 2.1, 2.2, 2.3 share the ghost-button pattern; run 2.2 with or just
  after 2.1, then 2.3.
- Phase 3 tasks are independent of each other except 3.3's hierarchy step, which
  follows Task 0.1.
- Task 4.1 has no dependency and can run any time.
