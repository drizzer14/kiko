# Visual Regression Expansion (Rich Scenario) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ~8 new deterministic shots to the RICH `check:screenshots` flow covering filled EDIT forms, open bottom-sheet modals, and selection controls in a chosen state.

**Architecture:** Extend the existing `.maestro/regression.yaml` RICH flow with new navigation + `takeScreenshot` steps, add the missing `testID`s the new steps target, append the new shot names to the single source-of-truth `REGRESSION_RICH_NAMES` list, then have ops produce and commit new stable-glass baselines. No app runtime logic changes — only `testID`/`backdropTestID` prop plumbing.

**Tech Stack:** Maestro 2.10.0 flows, React Native / TypeScript components, pixelmatch diff engine (`scripts/checks/screenshot-diff/compare-png.js`), stable-glass screenshot build (`ENVFILE=.env.screenshots.stable`).

**Spec:** This plan implements the DECIDED design described in the task brief (regression-expansion). There is no separate spec file; the decided scope is restated verbatim under Global Constraints. The authoritative harness contract is `CLAUDE.md` › "check:screenshots (App Store screenshot visual regression)".

## Global Constraints

- SCOPE: ~8 NEW shots added to the RICH flow (`.maestro/regression.yaml`) ONLY. The empty/locked flows are untouched.
- Three shot categories: (1) bottom-sheet MODALS in open/settled state; (2) SELECTION controls in a chosen state; (3) FILLED forms reached via the EDIT form of a SEEDED entity (opens pre-filled — DO NOT type).
- Error/validation states are OUT OF SCOPE (deferred to a later pass).
- DETERMINISM: capture only settled, deterministic frames. For every modal/selection shot: tap to open/select a KNOWN target, then `waitForAnimationToEnd`, then `takeScreenshot`. No typing (a visible keyboard/cursor is a flake). No mid-scroll shots.
- Runs on the STABLE-glass build (`ENVFILE=.env.screenshots.stable`), same as the existing rich flow. `SCREENSHOT_STABLE_GLASS=true` makes `GlassSurface` render an opaque, non-LiquidGlass surface for byte-stable pixels.
- The ONLY app-side change allowed is ADDING `testID`/`backdropTestID` props to targets that lack them (a testID sweep). No runtime logic change. If a target genuinely cannot be made deterministic without a runtime change, it is FLAGGED in this plan (see "Flagged targets").
- Every `takeScreenshot` step uses a BARE relative name (no `.png`, no path) — the Maestro 2.10.0 confinement constraint documented in `CLAUDE.md` and `scripts/checks/screenshot-diff/run-flow-and-collect.sh`.
- Navigation uses NO `back` command. To return a tab stack to its root, tap a DIFFERENT tab's icon then tap back to the original tab's icon; every tab stack pops to root on blur (`src/navigation/reset-tab-stack-on-blur.ts`). Because a `BottomSheet` is a full-screen RN `Modal` that covers the tab bar (`src/design-system/components/bottom-sheet/bottom-sheet.component.tsx`), an OPEN sheet must be dismissed (tap its backdrop, or pick a row that closes it) BEFORE any tab tap.
- Tolerances are unchanged: pixelmatch `threshold` 0.1, per-image `maxMismatchRatio` 0.005.
- Simulator prerequisite (ops): booted, pinned "iPhone 17 Pro Max" (6.9-inch, 1320x2868 portrait), clock AND timezone pinned to 2026-09-10 (the seed's `ANCHOR`), with the stable-glass RICH build installed — see `.maestro/appstore-screenshots.yaml`'s header and the `screenshot-build-recipe` memory.

---

## Seed facts the new shots rely on (verified in `src/screenshot/seed/screenshot-seed.ts`)

- The RICH dataset seeds 5 accounts; the FIRST is `Монобанк` (kind `bank`), whose FIRST (only) holding is `Монобанк` (type `card`, currency `UAH`, plain manual — NOT synced, since seeded accounts carry no `institution`). This is the account-card and holding-grid-item the existing flow already taps for `04-account-detail` / `05-holding-detail-ledger`.
- The Монобанк card ledger is sorted newest-first (`desc(time)` — `holding-detail.screen.tsx` `.sort((a,b) => b.time - a.time)`). The newest row is the month-0 salary at `at(2)` = 2026-09-08: description `Зарплата`, income `+₴25,000.00`, category `null`. So the FIRST `ledger-row` opens the transaction EDIT form pre-filled with that salary row (category unselected).
- The 10 default categories keep their slug keys: `groceries`, `dining`, `transport`, `shopping`, `utilities`, `entertainment`, `health`, `cash`, `transfers`, `other` (`src/db/__fixtures__/seeded-categories.ts`).
- A create HoldingForm under a BANK account offers only `term_deposit` / `bond` (card/jar are sync-only), defaulting to `term_deposit` — so the existing `r02-add-holding-form` already shows the term-deposit form (recapitalization `Switch` + compounding `ChipRow`). The Bond variant is NOT otherwise captured.

## Coverage note — selection controls already captured (do NOT duplicate)

- `CurrencySwitch` / `OptionPills` in a chosen state: already visible in `09-settings-main` (the `settings-card-base-currency` card renders `CurrencySwitch` with `UAH` selected — `src/screens/settings/settings.screen.tsx`).
- `Switch` in a chosen state: already visible in `r02-add-holding-form` (the term-deposit recapitalization `Switch`).
- Currency `ChipRow` selected: already visible in `r02-add-holding-form` (currency chips) and add-account cash path.

The new selection-control shots therefore target the pickers NOT yet covered: the category picker sheet, the date-picker sheet, the native time-picker sheet, and the bond-form chip rows.

## The 8 new shots (names + one line each)

| Name | Category | On-screen state |
|---|---|---|
| `r05-edit-account-form` | filled form | Edit-mode `AccountForm` for the seeded `Монобанк` account, pre-filled name/kind/color |
| `r06-edit-holding-form` | filled form | Edit-mode `HoldingForm` for the seeded `Монобанк` card holding, pre-filled name + balance, read-only type/currency chips |
| `r07-edit-transaction-form` | filled form | Edit-mode `TransactionForm` for the newest ledger row (`Зарплата` income), pre-filled amount/description/date/time, income mode chip selected |
| `r08-transaction-category-sheet` | modal + selection (category picker) | Category-picker `BottomSheet` open over the transaction edit form |
| `r09-transaction-date-sheet` | modal + selection (date picker) | Date-calendar `BottomSheet` open, the transaction's day marked selected |
| `r10-transaction-time-sheet` | modal + selection (native time picker) | Native time-spinner `BottomSheet` open (FLAGGED — see "Flagged targets") |
| `r11-transaction-category-override-sheet` | modal | The "Застосувати категорію до всіх" confirmation `BottomSheet` (existing `testID="category-override-sheet"`) |
| `r12-add-holding-bond-form` | filled form + selection (chip rows) | Add-holding form switched to the Bond type: bond detail fields, `bondKind` chip (`Тип облігації`, government selected), `couponFrequency` chip (`Частота купона`, semiannually selected) |

Numbering continues after the existing `r04`; `r12`'s label is out of capture order (it is captured between `r05` and `r06`) — the `r0N` value is a unique label, not an ordering key (`compare-png.js` enumerates the baseline dir, not the array order).

---

## Task 1: testID sweep on the targets the new steps drive

**Files:**
- Modify: `src/design-system/components/edit-header-button/edit-header-button.component.tsx`
- Modify: `src/screens/forms/account-form.screen.tsx:259`
- Modify: `src/screens/forms/holding-form.screen.tsx:514`
- Modify: `src/screens/forms/transaction-form.screen.tsx` (the `<Box gap={4}>` at line 1125; the `DateField`/`TimeField` in `renderFieldGroup`; the `CategoryField` in `renderModeAndActions`)
- Modify: `src/screens/forms/field-trigger/field-trigger.component.tsx` + `field-trigger.props.d.ts`
- Modify: `src/screens/forms/category-field/category-field.component.tsx` + `category-field.props.d.ts`
- Modify: `src/screens/forms/date-field/date-field.component.tsx` + `date-field.props.d.ts`
- Modify: `src/screens/forms/time-field/time-field.component.tsx` + `time-field.props.d.ts`
- Tests to verify/adjust: `src/screens/forms/field-trigger/field-trigger.component.test.tsx`, `category-field/category-field.component.test.tsx`, `date-field/date-field.component.test.tsx`, `time-field/time-field.component.test.tsx`, and the form-screen tests `account-form.screen.test.tsx`, `holding-form.screen.test.tsx`, `transaction-form.screen.test.tsx`.

**Interfaces:**
- Produces the following stable `testID`s the flow (Task 2) taps/asserts:
  - `edit-header-button` (Button; shared by account- and holding-detail headers, only one on screen at a time)
  - `account-form`, `holding-form`, `transaction-form` (form container `Box`es)
  - `transaction-category-field` (CategoryField trigger, via new `CategoryFieldProps.testID` → `FieldTriggerProps.testID`)
  - `category-picker-sheet` (CategoryField's `BottomSheet`)
  - `category-option-<key>` for every category row (e.g. `category-option-groceries`)
  - `transaction-date-field` + `transaction-date-backdrop` (DateField trigger + its sheet scrim, via new `DateFieldProps.testID` / `backdropTestID`)
  - `transaction-time-field` + `transaction-time-backdrop` (TimeField trigger + its sheet scrim, via new `TimeFieldProps.testID` / `backdropTestID`)
- Consumes: nothing from other tasks.

**Verified absent (grep before adding):** none of `edit-header-button`, `account-form`, `holding-form`, `transaction-form`, `category-picker-sheet`, `category-option-`, `transaction-date-field`, `transaction-time-field` exist today. `Box`, `Button`, `SelectableRow`, and `BottomSheet` all already forward `testID`/`backdropTestID` (confirmed in their components); `FieldTrigger`, `DateField`, `TimeField` do NOT forward a trigger `testID`/`backdropTestID` yet — those props are added here.

- [ ] **Step 1: Add `testID` to `EditHeaderButton`'s Button**

```tsx
// edit-header-button.component.tsx — inside the returned <Button ...>
<Button
  variant="ghost"
  size="compact"
  fullWidth={false}
  icon="pencil"
  testID="edit-header-button"
  accessibilityLabel={t('common.edit')}
  onPress={onPress}
>
  {t('common.edit')}
</Button>
```

- [ ] **Step 2: Add form-container testIDs**

In `account-form.screen.tsx` change the outer `<Box gap={4}>` (line 259) to `<Box gap={4} testID="account-form">`.
In `holding-form.screen.tsx` change the outer `<Box gap={4}>` (line 514) to `<Box gap={4} testID="holding-form">`.
In `transaction-form.screen.tsx` change the outer `<Box gap={4}>` (line 1125) to `<Box gap={4} testID="transaction-form">`.

- [ ] **Step 3: Thread an optional `testID` through `FieldTrigger`**

Add to `field-trigger.props.d.ts`:

```ts
  // An optional testID applied to the Pressable trigger, so a flow can tap the
  // field to open its picker sheet. Omitted leaves the trigger untagged.
  testID?: string;
```

In `field-trigger.component.tsx` destructure `testID` and pass it to the `Pressable`:

```tsx
const FieldTrigger: FC<FieldTriggerProps> = ({
  label, onPress, icon, iconColor, value, valueTone, trailing, required, testID,
}) => (
  <Box gap={1}>
    <FieldLabel label={label} required={required} />
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID}>
```

- [ ] **Step 4: Tag `CategoryField`'s trigger, sheet, and option rows**

Add to `category-field.props.d.ts`:

```ts
  // An optional testID forwarded to the field trigger, so a flow can open the
  // category picker sheet deterministically.
  testID?: string;
```

In `category-field.component.tsx`: destructure `testID`; pass `testID={testID}` to the `<FieldTrigger .../>`; add `testID="category-picker-sheet"` to the `<BottomSheet ...>`; add `testID={`category-option-${option.key}`}` to each `<SelectableRow ...>`:

```tsx
<FieldTrigger label={label} required={required} testID={testID} onPress={() => setOpen(true)} icon={selected?.icon ?? PLACEHOLDER_ICON} iconColor={selected?.color} value={selected?.title ?? t('forms.fields.selectCategory')} valueTone={selected ? 'textPrimary' : 'textSecondary'} />
// ...
<BottomSheet visible={open} onDismiss={() => setOpen(false)} gap={2} scrollable={false} testID="category-picker-sheet">
// ...
<SelectableRow key={option.key} testID={`category-option-${option.key}`} accessibilityRole="button" ... />
```

- [ ] **Step 5: Add `testID` + `backdropTestID` to `DateField` and `TimeField`**

Add to BOTH `date-field.props.d.ts` and `time-field.props.d.ts`:

```ts
  // An optional testID applied to the field's Pressable trigger, so a flow can
  // open the picker sheet deterministically.
  testID?: string;
  // An optional testID applied to the sheet's dismiss backdrop, so a flow can
  // close the sheet by tapping the scrim (the sheet is a full-screen Modal).
  backdropTestID?: string;
```

In `date-field.component.tsx`: destructure `testID`, `backdropTestID`; pass `testID={testID}` to the trigger `Pressable`; pass `backdropTestID={backdropTestID}` to the `<BottomSheet ...>`.
In `time-field.component.tsx`: the same two edits (trigger `Pressable` gets `testID`; `<BottomSheet ...>` gets `backdropTestID`).

- [ ] **Step 6: Pass the field testIDs from `TransactionForm`**

In `transaction-form.screen.tsx`, in `renderFieldGroup`'s income/expense branch, tag the `DateField` and `TimeField`:

```tsx
<DateField label={props.t('forms.fields.date')} value={props.time} onChange={props.onChangeTime} disabled={props.isReadOnly} testID="transaction-date-field" backdropTestID="transaction-date-backdrop" />
<TimeField label={props.t('forms.fields.time')} value={props.time} onChange={props.onChangeTime} disabled={props.isReadOnly} testID="transaction-time-field" backdropTestID="transaction-time-backdrop" />
```

In `renderModeAndActions`, tag the `CategoryField`:

```tsx
<CategoryField label={props.t('forms.transaction.category')} testID="transaction-category-field" options={props.categoryOptions} selectedKey={props.selectedCategory} onSelect={props.onSelectCategory} required={!props.isEditing} />
```

(These are fixed literals, so they do NOT need to be added to `FieldGroupProps`/`ModeAndActionsProps`.)

- [ ] **Step 7: Run the unit tests for the touched components and fix any that assert on prop shape**

Run: `npx jest src/screens/forms/field-trigger src/screens/forms/category-field src/screens/forms/date-field src/screens/forms/time-field src/screens/forms/account-form src/screens/forms/holding-form src/screens/forms/transaction-form`
Expected: PASS. Adding optional props / a container `testID` is additive; if any snapshot or `getByTestId`/`queryByTestId` assertion breaks, update it to reflect the new testID (a real behavior change the test should now document), never delete coverage.

- [ ] **Step 8: Run the fast+medium harness and commit**

Run: `npm run check:all`
Expected: PASS (lint, dup, knip, deps, security, rules, plist, secrets, overrides, typecheck all green). New optional props are consumed by their callers, so knip stays clean.

```bash
git add src/design-system/components/edit-header-button src/screens/forms
git commit -m "feat(screenshots): add testIDs for regression-expansion targets"
```

---

## Task 2: Author the 8 new steps in `.maestro/regression.yaml`

**Files:**
- Modify: `.maestro/regression.yaml`

**Interfaces:**
- Consumes the Task 1 testIDs (`edit-header-button`, `account-form`, `holding-form`, `transaction-form`, `transaction-category-field`, `category-picker-sheet`, `category-option-groceries`, `transaction-date-field`, `transaction-date-backdrop`, `transaction-time-field`, `transaction-time-backdrop`) and the pre-existing ones (`accounts-grid`, `account-card`, `account-detail-content`, `holding-grid-item`, `holding-value-header`, `ledger-list`, `ledger-row`, `house.fill`, `wallet.pass.fill`, `chart.xyaxis.line`, `gearshape.fill`, the KikoCalendar testID `Дата calendar`, the DateTimePicker testID `Час picker`, the override sheet testID `category-override-sheet`).
- Produces the 8 named PNG captures Task 3 registers and Task 4 baselines.

**Navigation notes:** every "return to root then re-enter" uses the tab-blur reset (tap `house.fill`, then the target tab icon). Each pushed form is reached by re-entering its base screen (no `back`). Add `- waitForAnimationToEnd` immediately before every new `takeScreenshot` (the existing flow's settle pattern).

- [ ] **Step 1: Insert `r05-edit-account-form` after the `04-account-detail` capture**

The existing block taps `account-card`, asserts `account-detail-content`, and captures `04-account-detail`. Immediately AFTER that `takeScreenshot: 04-account-detail`, insert:

```yaml
# BREADTH: edit-account form (filled from the seeded Монобанк account)
- tapOn:
    id: "edit-header-button"
- assertVisible:
    id: "account-form"
- assertVisible:
    text: "Монобанк"
- waitForAnimationToEnd
- takeScreenshot: r05-edit-account-form

# Reset the Accounts stack to root (tab-blur), then re-enter for the next push.
- tapOn:
    id: "house.fill"
- tapOn:
    id: "wallet.pass.fill"
- assertVisible:
    id: "accounts-grid"
- tapOn:
    id: "account-card"
- assertVisible:
    id: "account-detail-content"
```

This leaves the flow back on `account-detail`, ready for the existing `tapOn: text "Додати актив"` → `r02-add-holding-form` block that follows.

- [ ] **Step 2: Insert `r12-add-holding-bond-form` right after the existing `r02-add-holding-form` capture**

Immediately AFTER `takeScreenshot: r02-add-holding-form`, insert (the add-holding form defaults to the term-deposit type; tap the Bond type chip):

```yaml
# BREADTH: bond variant of the add-holding form (bond fields + bondKind /
# couponFrequency chip rows in their default selected state).
- tapOn:
    text: "Облігація"
- assertVisible:
    id: "holding-form"
- assertVisible:
    text: "Деталі облігації"
- waitForAnimationToEnd
- takeScreenshot: r12-add-holding-bond-form
```

The existing Accounts-stack reset block that follows `r02` (tap `house.fill` → `wallet.pass.fill` → assert `accounts-grid`) stays and now also resets after `r12`.

- [ ] **Step 3: Insert `r06-edit-holding-form` after the existing `05-holding-detail-ledger` capture**

Immediately AFTER `takeScreenshot: 05-holding-detail-ledger`, insert:

```yaml
# BREADTH: edit-holding form (filled from the seeded Монобанк card holding)
- tapOn:
    id: "edit-header-button"
- assertVisible:
    id: "holding-form"
- assertVisible:
    text: "Монобанк"
- waitForAnimationToEnd
- takeScreenshot: r06-edit-holding-form

# Reset to root, then re-enter the holding detail for the transaction shots.
- tapOn:
    id: "house.fill"
- tapOn:
    id: "wallet.pass.fill"
- assertVisible:
    id: "accounts-grid"
- tapOn:
    id: "account-card"
- assertVisible:
    id: "account-detail-content"
- scrollUntilVisible:
    element:
      id: "holding-grid-item"
    direction: DOWN
- tapOn:
    id: "holding-grid-item"
- assertVisible:
    id: "ledger-list"
```

Note: the existing `r03-add-transaction-form` block (tap `text "Додати транзакцію"` → capture) currently follows `05-holding-detail-ledger`. Keep `r03` where it is; place the `r06` block AFTER the `r03` capture and ITS reset. Sequence within the holding section becomes: `05-holding-detail-ledger` → `r03-add-transaction-form` → reset+re-enter holding → `r06-edit-holding-form` → reset+re-enter holding → `r07`+sheets (Step 4). (`r03` today has no reset after it — add the reset+re-enter block shown above after `r03` too, so `r06` starts from `ledger-list`.)

- [ ] **Step 4: Insert `r07`–`r11` (transaction edit form + its sheets) after `r06`'s re-entry**

With the flow on the re-entered holding detail (`ledger-list` visible), append:

```yaml
# BREADTH: edit-transaction form (filled from the newest ledger row, salary)
- tapOn:
    id: "ledger-row"
- assertVisible:
    id: "transaction-form"
- assertVisible:
    text: "Зарплата"
- waitForAnimationToEnd
- takeScreenshot: r07-edit-transaction-form

# MODAL + SELECTION: category picker sheet open
- tapOn:
    id: "transaction-category-field"
- assertVisible:
    id: "category-picker-sheet"
- waitForAnimationToEnd
- takeScreenshot: r08-transaction-category-sheet
# Pick a known category — closes the sheet AND marks the category changed
# (needed so the override sheet r11 appears on Save).
- tapOn:
    id: "category-option-groceries"

# MODAL + SELECTION: date calendar sheet open (day already marked selected)
- tapOn:
    id: "transaction-date-field"
- assertVisible:
    id: "Дата calendar"
- waitForAnimationToEnd
- takeScreenshot: r09-transaction-date-sheet
- tapOn:
    id: "transaction-date-backdrop"

# MODAL + SELECTION: native time spinner sheet open
- tapOn:
    id: "transaction-time-field"
- assertVisible:
    id: "Час picker"
- waitForAnimationToEnd
- takeScreenshot: r10-transaction-time-sheet
- tapOn:
    id: "transaction-time-backdrop"

# MODAL: "Apply category to all" confirmation sheet (category changed above)
- tapOn:
    text: "Зберегти"
- assertVisible:
    id: "category-override-sheet"
- waitForAnimationToEnd
- takeScreenshot: r11-transaction-category-override-sheet
# Dismiss (Cancel = navigation.goBack) — returns to the ledger.
- tapOn:
    text: "Скасувати"
```

After this block the flow continues into the existing Statistics section (`tapOn: id "chart.xyaxis.line"` → `06-statistics-net-worth-line`) exactly as today.

- [ ] **Step 5: Update the flow's header comment**

Extend the `BREADTH additions` comment block at the top of `.maestro/regression.yaml` to list the 8 new shots (`r05`–`r12`) and note that the transaction sheets (`r08`–`r11`) are all captured from one visit to the transaction edit form, and that each open sheet is dismissed (backdrop tap or a category pick) before any tab tap because a `BottomSheet` is a full-screen `Modal`.

- [ ] **Step 6: Lint the YAML edit and commit**

Run: `npm run check:all`
Expected: PASS (the medium tier runs on the harness-input change; `.maestro/*.yaml` is not a source or a rule/fixture/plist, so no rule check is triggered, but lint/typecheck stay green).

```bash
git add .maestro/regression.yaml
git commit -m "test(screenshots): add 8 rich-scenario regression shots"
```

---

## Task 3: Register the new shot names in the source-of-truth list

**Files:**
- Modify: `scripts/checks/screenshot-diff/run-flow-and-collect.sh` (`REGRESSION_RICH_NAMES`, lines 82–94)

**Interfaces:**
- Consumes the exact `takeScreenshot` names authored in Task 2.
- Produces the name set both `scripts/checks/screenshots.sh` (the check) and `scripts/screenshots-baseline.sh` (the baseline producer) read for the rich scenario — they MUST match the flow's names exactly.

- [ ] **Step 1: Append the 8 new names to `REGRESSION_RICH_NAMES`**

Change the array to (existing 11 unchanged, 8 appended — order is cosmetic, listed numerically for readers):

```sh
REGRESSION_RICH_NAMES=(
  01-home-networth
  03-accounts-grid
  r01-add-account-form
  04-account-detail
  r02-add-holding-form
  05-holding-detail-ledger
  r03-add-transaction-form
  06-statistics-net-worth-line
  09-settings-main
  r04-categories
  10-settings-system
  # 2026-09-12 visual-regression expansion — filled edit forms, open sheets,
  # and selection controls. Captured interleaved in the flow (see
  # .maestro/regression.yaml); the r0N value is a unique label, not an order key.
  r05-edit-account-form
  r06-edit-holding-form
  r07-edit-transaction-form
  r08-transaction-category-sheet
  r09-transaction-date-sheet
  r10-transaction-time-sheet
  r11-transaction-category-override-sheet
  r12-add-holding-bond-form
)
```

- [ ] **Step 2: Sanity-check the shell edit and commit**

Run: `bash -n scripts/checks/screenshot-diff/run-flow-and-collect.sh`
Expected: no output (syntax OK). Then `npm run check:all` — Expected: PASS.

```bash
git add scripts/checks/screenshot-diff/run-flow-and-collect.sh
git commit -m "test(screenshots): register 8 new rich shot names"
```

---

## Task 4: Produce baselines and run the gate (ops — MANUAL / DEEP step)

**This task needs a booted, pinned simulator with the stable-glass RICH build installed. It is NOT hook-wired and NOT part of `check:all`/`check:deep`. It runs manually, by kiko:ops, on real hardware.**

**Files:**
- Create (generated, committed): `screenshots/regression/6.9-inch/uk/r05-edit-account-form.png`, `r06-edit-holding-form.png`, `r07-edit-transaction-form.png`, `r08-transaction-category-sheet.png`, `r09-transaction-date-sheet.png`, `r10-transaction-time-sheet.png`, `r11-transaction-category-override-sheet.png`, `r12-add-holding-bond-form.png`

**Interfaces:**
- Consumes the flow (Task 2) and the name list (Task 3).
- Produces the committed baselines `npm run check:screenshots` diffs against.

- [ ] **Step 1: Build + install the stable-glass RICH build (ops, per the screenshot-build-recipe memory)**

Embedded build (no Metro): `ENVFILE=.env.screenshots.stable`, `FORCE_BUNDLING=1`, clean + `pod install`, grep the produced `main.jsbundle` for `isStableGlass` to confirm the flag is inlined, OpenJDK 21 on PATH for Maestro. Boot the pinned "iPhone 17 Pro Max", set clock AND timezone to 2026-09-10, install the app.

- [ ] **Step 2: First live run of the new flow steps to verify navigation (ops/qa)**

The new steps (like the rest of `regression.yaml`) were authored WITHOUT a live Maestro run. Before baselining, dry-run the flow and confirm on-device: the `edit-header-button` is hit in both detail headers, each sheet opens and is dismissed cleanly, the `ledger-row` tap opens the salary row, and `Зберегти` raises `category-override-sheet`. Adjust any step whose on-device behavior differs from its comment (e.g. a `scrollUntilVisible` needed to bring a footer button on screen), and re-commit the flow if so.

- [ ] **Step 3: Produce the rich baselines**

Run: `npm run screenshots:baseline`
Expected: it captures all 19 rich names (11 existing + 8 new) into `screenshots/regression/6.9-inch/uk/`. Confirm the 8 new `.png` files exist and are non-empty; confirm no OTHER baseline file changed unexpectedly (the existing 11 should be byte-identical unless a shared step moved — if one changed, investigate before committing).

- [ ] **Step 4: Run the gate**

Run: `npm run check:screenshots`
Expected: PASS — every captured PNG (including the 8 new) diffs under `maxMismatchRatio` 0.005 against the just-committed baseline. A FAIL on `r10-transaction-time-sheet` specifically is the FLAGGED risk — see "Flagged targets" for the fallback.

- [ ] **Step 5: Commit the baselines**

```bash
git add screenshots/regression/6.9-inch/uk/r05-edit-account-form.png \
        screenshots/regression/6.9-inch/uk/r06-edit-holding-form.png \
        screenshots/regression/6.9-inch/uk/r07-edit-transaction-form.png \
        screenshots/regression/6.9-inch/uk/r08-transaction-category-sheet.png \
        screenshots/regression/6.9-inch/uk/r09-transaction-date-sheet.png \
        screenshots/regression/6.9-inch/uk/r10-transaction-time-sheet.png \
        screenshots/regression/6.9-inch/uk/r11-transaction-category-override-sheet.png \
        screenshots/regression/6.9-inch/uk/r12-add-holding-bond-form.png
git commit -m "test(screenshots): baselines for 8 new rich shots"
```

- [ ] **Step 6: Final deep gate (before declaring done)**

Run: `npm run check:deep` (mutation + osv). Expected: PASS. Note `check:screenshots` is NOT part of `check:deep`; Step 4 above is the screenshot gate and must be green independently.

---

## Flagged targets (could not be guaranteed deterministic without a runtime change)

- **`r10-transaction-time-sheet` (native `DateTimePicker` `display="spinner"`).** The native iOS time-spinner wheel renders selected + adjacent values with system-drawn momentum/anti-aliasing that the stable-glass flag does NOT control (it is a native UIKit control, not a `GlassSurface`). Its VALUE is fixed and deterministic (the salary row's time-of-day, on a pinned clock/timezone), and no scrolling happens, so it is expected to be stable — but this is the one shot whose determinism cannot be asserted from the code alone. Ops must confirm at Step 4. If it exceeds `maxMismatchRatio` 0.005 run-to-run, the fallback (no runtime change) is to EXCLUDE it from the diff via `SCREENSHOT_EXCLUDE_CSV=r10-transaction-time-sheet` (the mechanism is live and unit-tested — `compare-png.js` `excludeCsv`), keeping the shot captured/committed but out of the pixel gate, mirroring the retired `02/07/08` exclusion pattern. Do NOT add app logic to stabilize it.

- **No target required a runtime logic change.** Every new shot is reachable with only `testID`/`backdropTestID` prop plumbing (Task 1). The `Settings > Language` sub-page remains non-existent (the language control is inline on `10-settings-system`), so it is still not captured — unchanged from the existing flow's documented investigation.

## Self-review

- Spec coverage: all three decided categories are covered — filled forms (`r05`/`r06`/`r07`/`r12`), bottom-sheet modals (`r08`/`r09`/`r10`/`r11`), selection controls (category picker `r08`, date picker `r09`, native time picker `r10`, bond chip rows `r12`; `CurrencySwitch`/`Switch`/currency-chips already covered by `09`/`r02` — documented, not duplicated). ~8 new shots (exactly 8). Error/validation states excluded. Names appended to `REGRESSION_RICH_NAMES`. Baselines produced by ops via `npm run screenshots:baseline`; gate is `npm run check:screenshots`.
- Type/name consistency: every `takeScreenshot` name in Task 2 appears verbatim in Task 3's array and Task 4's baseline file list. Every testID produced in Task 1 is consumed in Task 2. Bare relative screenshot names (no `.png`/path) throughout.
- No placeholders: every step has concrete code/commands and exact locale strings (`Монобанк`, `Зарплата`, `Облігація`, `Деталі облігації`, `Зберегти`, `Скасувати`, verified in `src/i18n/locales/uk.ts`).
