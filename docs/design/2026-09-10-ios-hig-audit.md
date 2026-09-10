# iOS HIG audit — Phase B feedback round

Author: kiko:designer (Task 0.1b). Date: 2026-09-10.
Branch: `drizzer14/phase-b-design`, off `main` @ e88c13e.
Method: static read of `src/` only. The app was not run on a device.

## Scope

This audit checks the whole app against Apple's iOS Human Interface
Guidelines (HIG) on four axes:

- touch targets (the >= 44pt x 44pt minimum for any control),
- SF Symbol sizing against Dynamic Type,
- spacing,
- contrast and materials/glass.

Each finding is ranked by severity. Each finding maps to a Phase B
task that will absorb it, or is marked "new" when no current task
covers it.

## How severity is ranked

1. High — an accessibility defect a user hits directly: a control
   smaller than 44pt, or text/state that fails a contrast need.
2. Medium — a material or state-clarity defect that degrades the iOS
   look but does not block use.
3. Low — a consistency gap or a large-scope accessibility item that is
   out of this round's reach.

## Findings (ranked)

### H1 — Category card controls are below the 44pt touch target (High)

The set-default, delete, and reorder controls on a category card are
bare `Pressable` wrappers around a 20pt `SymbolIcon` with only
`padding: theme.spacing(1)` (4pt). The tap target is about 28pt x 28pt,
below the 44pt minimum. There is no `hitSlop`.

- Evidence: `src/screens/settings/categories.screen.tsx:61,80,48`
  (the `setDefaultButton`, `reorderButton`, `deleteButton` styles) and
  the call sites at `:211-218`, `:244-254`, `:267-284`.
- Maps to: **Task 2.3**. The replacement icon-only ghost `Button` must
  guarantee a >= 44pt tap target.

### H2 — OptionPills pills are below the 44pt touch target (High)

A pill uses `paddingVertical: theme.spacing(2)` (8pt) around a 16pt
body label, so the pill height is about 32pt, below 44pt. This affects
the trend filter chips (mode, amount, measure), the `CurrencySwitch`,
and the `LanguageSwitch`.

- Evidence: `src/design-system/components/option-pills/option-pills.styles.ts:30-31`
  (`pill` block, `paddingVertical`); consumers at
  `src/screens/statistics/trend-filter-field/trend-filter-field.component.tsx:161,177,190`.
- Maps to: **Task 3.3**. The trend-filter hierarchy work touches
  OptionPills; raise the pill to a >= 44pt minimum height there.

### H3 — The compact Button has no minimum height (High)

The `regular` Button size pins `minHeight: 50` (HIG-safe). The
`compact` size sets only padding (`paddingVertical: theme.spacing(2)`
= 8pt) and no `minHeight`, so a compact button is about 32pt tall,
below 44pt.

- Evidence: `src/design-system/components/button/button.styles.ts:35-47`
  (`regular` has `minHeight: BUTTON_MIN_HEIGHT` = 50; `compact` has
  none).
- Maps to: **new**. The icon-only ghost buttons built in Task 2.2 and
  Task 2.3 are the first new consumers; give the `compact` size a
  `minHeight` of 44 so every compact button is HIG-safe, rather than
  fixing each call site. Flag for a developer task.

### M1 — The calendar paints an opaque block over the glass sheet (Medium)

`KikoCalendar` sets its background to the opaque `surfaceHigh`, which
covers the translucent glass `BottomSheet` it sits inside. The sheet
reads as glass; the calendar reads as an opaque card on top of it.

- Evidence: `src/screens/calendar/kiko-calendar/kiko-calendar.theme.ts:36,52`
  (`calendarBackground` and the month-view background); the sheet
  token is `sheetBackground` at `bottom-sheet.styles.ts`.
- Maps to: **Task 3.1** (make the calendar background transparent).

### M2 — List rows are plain surfaces on a glass-card app (Medium)

Home transaction rows and holding-detail ledger rows are plain `Box`
fills (`styles.row`, and `surface` on the ledger row), while the rest
of the app groups content in `GlassSurface` cards.

- Evidence: `src/screens/home/home.screen.tsx:412` (plain row) and
  `src/screens/holding-detail/holding-detail.screen.tsx:336`
  (`backgroundColor: theme.colors.surface`).
- Maps to: **Task 3.2** (extend glass to the two row types; the
  designer sets the final set).

### M3 — OptionPills selected state is too subtle (Medium)

The only difference between a selected and an unselected pill is the
text tone (`textPrimary` vs `textSecondary`). On the sheet's grouped
background the selected pill does not read as clearly chosen. HIG wants
a selected control to read as unambiguously active.

- Evidence: `src/design-system/components/option-pills/option-pills.component.tsx:54`
  (tone switch) and the `pill` fill note in `option-pills.styles.ts`.
- Maps to: **Task 3.3** (strengthen the selected/unselected hierarchy;
  the designer sets weight, fill, or tone).

### M4 — The red-ghost delete label contrast (Medium) — RESOLVED, measured

Task 2.1 and Task 2.3 move the delete button from a solid `destructive`
fill to a red ghost (`negative` #FF453A label on a transparent surface).
Measured WCAG contrast of `negative` (#FF453A) against each real
background, two delete sites:

- Transaction-form delete (`transaction-form.screen.tsx:~540`): sits on
  the true-black `Screen` (#000000) — **6.16:1**. Passes AA.
- Category-card delete (`categories.screen.tsx`): sits on the
  `transparent` category-card glass. The card's `surfaceTranslucent`
  fill (`rgba(28,28,30,0.60)`) composited over the true-black screen is
  ~`rgb(17,17,18)` — **5.54:1**. Even at the lightest realistic bound
  (the glass material pinned to the full `#1C1C1E` hue) it is **4.99:1**.
  Both pass AA (>= 4.5:1).

Result: both delete labels clear AA on their real surfaces, so no color
or backing change was needed. The ratio only dips below 4.5:1 on a
`surfaceHigh` (#2C2C2E) fill (4.09:1), which neither delete sits on —
the translucent card never reaches that lightness.

- Evidence: the delete Buttons at
  `src/screens/forms/transaction-form.screen.tsx` (form delete) and
  `src/screens/settings/categories.screen.tsx` (category-card delete),
  both `variant="ghost" textColor={theme.colors.negative}`; the
  translucent fill is `surfaceTranslucent` in `theme.ts`.
- Maps to: **Task 2.1 / 2.3** (done; contrast verified).

### L1 — Icon sizes are still inline literals outside the migrated set (Low)

Task 0.1 added the icon-size token scale and moved the main call sites
(buttons, the two list rows, and the card default) onto it. Many
call sites still use inline `16` / `18` / `22`: the form fields, the
filter menu, the calendar header, the chip row, and the
pending-category glyph. They should converge onto `theme.iconSizes` as
their owning tasks touch them. (The option-pill icon was migrated to
`theme.iconSizes.body` in the Phase B fix wave.)

- Evidence: inline sizes at
  `src/screens/forms/field-trigger/field-trigger.component.tsx:36`,
  `src/screens/home/filter-menu/filter-menu.component.tsx:59,84`,
  `src/screens/calendar/calendar-header/calendar-header.component.tsx:52,61,76,85`,
  `src/screens/forms/chip-row/chip-row.component.tsx:63`,
  `src/screens/forms/transaction-form.screen.tsx:1118` (size 22).
- Maps to: **Task 2.2 / 2.3 / 3.3** for the sites they already touch;
  the remainder is **new** (a follow-up token-migration pass). The 16pt
  checkmarks map to `iconSizes.caption`; the 18pt glyphs map to
  `iconSizes.body`; the 22pt pending-category glyph maps to a value
  between `body` (20) and `heading` (25) and should round to `heading`.

### L2 — The app does not support Dynamic Type (Low)

Both the type scale (`theme.typography`) and the new icon-size scale
(`theme.iconSizes`) are fixed point values. They do not scale with the
OS text-size (Dynamic Type) setting, so a user who raises the system
text size sees no change. HIG recommends text and symbols scale with
Dynamic Type.

- Evidence: fixed `fontSize` values at `theme.ts:20-28`; the icon-size
  tokens derive from those fixed values at `theme.ts` (`iconSizes`).
- Maps to: **new**. This is a large, app-wide accessibility item,
  out of this round's scope. Record it as tracked debt; a future round
  can adopt Dynamic Type for both scales together (the icon scale's
  ratio design already ties icons to the type scale, so a later move to
  scaled units keeps the ratio intact).

## Axes that passed

- **Spacing** — padding, margin, and gap read from the shared
  `theme.spacing` 4pt scale across the components reviewed; no raw pixel
  spacing was found at the main call sites. No finding.
- **Secondary text contrast** — `textSecondary`
  (`rgba(235,235,245,0.60)`) composites over the true-black background
  to about 6:1, which passes WCAG AA for body text. No finding.
- **Native chrome** — the tab bar and navigation headers use native SF
  Symbols at system-controlled sizes, which already follow HIG. No
  finding.
