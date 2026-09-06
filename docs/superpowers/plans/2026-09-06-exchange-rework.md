# Exchange Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the already-built (create-only) Exchange transaction feature to add spec-defined convert/edit support, restrict CREATE to cash-only holdings on both legs, and show each destination holding's parent account name in the picker.

**Architecture:** Three additive changes over the existing create-only Exchange code. (A) Convert-mode per the revised spec: a "Convert to Exchange" action on the transaction-form edit screen that records the ONE missing counterpart leg of an existing income/expense row via a new single-leg repo write (`recordExchangeCounterpart`), never touching the existing row — so no leg-pairing identifier and **no schema migration** is needed (the spec explicitly rejects a transfer-group id). (B) Create-only cash-only gating via new create-scoped predicates, leaving convert-mode on the current wider eligibility. (C) Thread each holding's parent account name into `HoldingSelectOption` and render it in `HoldingSelectField`.

**Tech Stack:** TypeScript, React Native, react-native-unistyles, op-sqlite + drizzle-orm, ts-pattern, react-i18next, Jest + React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-05-exchange-transaction-design.md` (REVISED 2026-09-06 — adds convert-mode; the authority for the edit/convert behavior in Requirement A).

**Device-review requirements (2026-09-06):** A) EDIT support for exchanges (per the revised spec = convert-mode). B) CASH-ONLY creation (both source and destination must be cash on create; edit keeps the current wider eligibility). C) ACCOUNT info in the destination holding picker.

---

## Edit-scope derived from the spec (read before starting)

The revised spec adds exactly ONE new behavior under "Convert an existing
transaction": **convert-mode**. It does NOT add "edit an existing exchange
as a unit." Concretely, the spec settles:

- Convert-mode records exactly ONE new manual leg — the missing counterpart —
  and the existing row is NEVER modified (spec "Ledger model", "Reuse /
  architecture", "Out of scope").
- Direction is chosen by the sign of the existing transaction: an existing
  EXPENSE is the source leg (user records the destination/receipt leg); an
  existing INCOME is the destination leg (user records the source/payment leg).
- The two legs stay INDEPENDENT rows tied only by description text. The spec
  explicitly REJECTS a transfer-group id "in favor of two independent rows —
  this rejection also covers convert-mode's new leg" (spec "Out of scope").

**Consequence for the "hard problem" in Requirement A (pairing the two legs):**
because convert-mode never edits an exchange as a unit — it only appends the
single missing counterpart to a standalone row — there is nothing to pair, so
the spec's design SIDESTEPS the leg-identification problem entirely.
**Therefore this plan introduces NO `transfer-group`/`exchange-group` column
and NO migration.** (The migrations folder's latest is `0012_add_language.sql`;
next would be `0013`, but this plan does not add one.) See Open Question 1 —
if the user actually wants to edit an already-created exchange's two legs
together, that is out of the current spec and WOULD require a group-id column
plus migration 0013; do not build it without confirmation.

---

## Global Constraints

- **No schema change, no migration** (per the spec; convert-mode adds two
  independent rows tied only by description text, same as create-mode).
- Every write goes through `db.transaction()` (the `write(...)` helper). A
  convert writes its ONE new leg and its holding-balance adjustment in a single
  transaction so they can never desync; the existing row is never part of that
  transaction (`kiko-architecture`).
- Convert-mode NEVER modifies the existing row. It applies to BOTH manual and
  synced (Monobank) rows — the synced case is the primary use case. This is safe
  because `transactionsRepo.update`/`.remove` already refuse to mutate a synced
  row, and convert-mode never calls them.
- The destination receive mapping is exhaustive over the `holdings.type` enum at
  `src/db/schema.ts:24-26` (`card`, `term_deposit`, `bond`, `cash`,
  `crypto_asset`, `jar`). Re-read that enum at implementation time to confirm the
  six members are unchanged. Use `ts-pattern`'s `match(...).exhaustive()` for
  every mapping over it (`kiko-code-style`).
- **Create eligibility (Requirement B, NEW):** on CREATE, BOTH the source and
  the destination must be `cash` (holding type `'cash'`). This narrows the
  current create rule (source `cash`/`card`; destination
  `cash`/`card`/`crypto_asset`/`term_deposit`). See Open Question 2 for the
  `'cash'`-strict vs. `cash`+`card` interpretation.
- **Convert eligibility (edit) keeps the CURRENT WIDER rules:** the existing
  holding must be liquid (`cash`/`card` — `isExchangeSourceType`); an
  expense-sourced convert's destination picker excludes only `bond`/`jar`
  (`isExchangeDestinationType`); an income-sourced convert's source picker is
  restricted to `cash`/`card` (`isExchangeSourceType`). Do NOT apply the
  cash-only create restriction to convert-mode.
- Convert entered major amounts to minor units with `Money.fromMajor` at the
  form boundary, using the counterpart holding's own currency. The fixed
  (existing-row) side is display-only and is never re-converted or re-written.
- Ledger copy is fixed, auto-generated: a destination (receipt) leg's
  description is `Exchange from <existing holding name>`; a source (payment)
  leg's description is `Exchange to <existing holding name>`. Same convention as
  create-mode.
- Reuse — do NOT duplicate `recordManualTx` / `appendDepositContributionTx` /
  `exchangeReceivePath`. Convert-mode composes the same single-leg writes
  create-mode already uses, so the two paths can never drift on source
  eligibility, destination dispatch, or the description convention.
- User-facing copy is i18n-only: every new string is a `t('...')` key added to
  BOTH `src/i18n/locales/en.ts` and `src/i18n/locales/uk.ts`. No literal UI
  strings in components (`kiko-code-style`, `kiko-design-system`).
- Code style: single quotes, 2-space indent, trailing commas,
  `arrowParentheses: always`, blank line before every `return`/`if`/`for`/
  `throw`/`try`, `import type` for type-only imports, full unabbreviated names,
  one component per file in its own folder, components default-export with a
  `.component.tsx` suffix, everything else named export (`kiko-code-style`).
- Design system: no hardcoded colors/spacing — theme tokens only, via
  `useUnistyles()` / `StyleSheet.create`; reuse the shared `Box`/`Text`/
  `SymbolIcon`/`BottomSheet`/`TextField`/`Button` primitives (`kiko-design-system`).
- Harness: run `npm run check:all` at each task checkpoint; run
  `npm run check:deep` before declaring the feature done. Never weaken a check.

---

## File Structure

New files:

- `src/holdings/exchange-convert.ts` — pure convert-mode logic: eligibility
  (`canConvertToExchange`) and direction-by-sign (`exchangeConvertDirection`).
  Depends only on `isExchangeSourceType` and the `HoldingType` alias.
- `src/holdings/exchange-convert.test.ts` — unit tests for the above.
- `src/screens/forms/convert-exchange-fields/convert-exchange-fields.component.tsx`
  — the single-counterpart convert form group (a read-only fixed side, one
  holding picker, one amount field, a Date field). Modeled on `exchange-fields`.
- `src/screens/forms/convert-exchange-fields/convert-exchange-fields.props.d.ts`
- `src/screens/forms/convert-exchange-fields/index.ts`
- `src/screens/forms/convert-exchange-fields/convert-exchange-fields.component.test.tsx`

Modified files:

- `src/holdings/exchange-destination.ts` — add create-scoped predicates
  `isExchangeCreateSourceType` / `isExchangeCreateDestinationType`; export the
  `ExchangeReceivePath` type only if a test needs it (currently module-local).
- `src/holdings/exchange-destination.test.ts` — tests for the two new predicates.
- `src/screens/forms/holding-select-field/holding-select-field.props.d.ts` — add
  `accountName: string` to `HoldingSelectOption`.
- `src/screens/forms/holding-select-field/holding-select-field.component.tsx` —
  render the account name in each row (and in the collapsed field selection).
- `src/screens/forms/holding-select-field/holding-select-field.styles.ts` — add
  a row-caption style if needed.
- `src/screens/forms/holding-select-field/holding-select-field.component.test.tsx`
  — assert the account name renders.
- `src/repositories/transactions.repo.ts` — add `recordExchangeCounterpart`
  (single-leg convert write); export `ExchangeCounterpartInput` shape via the
  method signature.
- `src/repositories/transactions.repo.test.ts` — tests for
  `recordExchangeCounterpart`.
- `src/screens/forms/transaction-form.screen.tsx` — (B) cash-only create
  gating + (C) account-name threading + (A) convert-mode entry, state, fields,
  and save.
- `src/screens/forms/transaction-form.screen.test.tsx` — create cash-only,
  account-name, and convert-mode tests.
- `src/i18n/locales/en.ts` and `src/i18n/locales/uk.ts` — new convert-mode copy
  keys.

---

## Task 1: Create-scoped cash-only eligibility predicates (Requirement B, pure layer)

Add create-only predicates that require holding type `'cash'`, WITHOUT touching
the existing `isExchangeSourceType` / `isExchangeDestinationType` (those stay the
wider convert-mode rule). This keeps "cash-only on create, wider on edit"
expressed as two distinct predicate pairs with one source of truth each.

**Files:**
- Modify: `src/holdings/exchange-destination.ts`
- Test: `src/holdings/exchange-destination.test.ts`

**Interfaces:**
- Consumes: `HoldingType` from `src/holdings/holding-type.ts`; `match` from `ts-pattern`.
- Produces:
  - `isExchangeCreateSourceType(type: HoldingType): boolean` — true only for `'cash'`.
  - `isExchangeCreateDestinationType(type: HoldingType): boolean` — true only for `'cash'`.

- [ ] **Step 1 (qa): Write the failing tests**

Append to `src/holdings/exchange-destination.test.ts`:

```ts
import {
  isExchangeCreateDestinationType,
  isExchangeCreateSourceType,
} from './exchange-destination';

describe('isExchangeCreateSourceType', () => {
  it('accepts only cash on create (card is excluded, unlike convert)', () => {
    expect(isExchangeCreateSourceType('cash')).toBe(true);
    expect(isExchangeCreateSourceType('card')).toBe(false);
    expect(isExchangeCreateSourceType('term_deposit')).toBe(false);
    expect(isExchangeCreateSourceType('bond')).toBe(false);
    expect(isExchangeCreateSourceType('crypto_asset')).toBe(false);
    expect(isExchangeCreateSourceType('jar')).toBe(false);
  });
});

describe('isExchangeCreateDestinationType', () => {
  it('accepts only cash on create (card/crypto/term_deposit excluded, unlike convert)', () => {
    expect(isExchangeCreateDestinationType('cash')).toBe(true);
    expect(isExchangeCreateDestinationType('card')).toBe(false);
    expect(isExchangeCreateDestinationType('crypto_asset')).toBe(false);
    expect(isExchangeCreateDestinationType('term_deposit')).toBe(false);
    expect(isExchangeCreateDestinationType('bond')).toBe(false);
    expect(isExchangeCreateDestinationType('jar')).toBe(false);
  });
});
```

- [ ] **Step 2 (qa): Run tests to verify they fail**

Run: `npx jest src/holdings/exchange-destination.test.ts`
Expected: FAIL — `isExchangeCreateSourceType` / `isExchangeCreateDestinationType` are not exported.

- [ ] **Step 3 (developer): Implement the two predicates**

Append to `src/holdings/exchange-destination.ts` (keep the existing wider
predicates untouched — they remain the convert-mode rule):

```ts
// CREATE-mode eligibility (Requirement B, device review 2026-09-06): a NEW
// exchange must move cash -> cash. Narrower than `isExchangeSourceType` /
// `isExchangeDestinationType` (the wider convert-mode rule), which stay as-is so
// convert-mode keeps the original card/crypto/term_deposit reach. Exhaustive so
// a new holding type must be classified here explicitly rather than defaulting
// in. Both sides share the same rule today (cash only) but are kept as two named
// predicates so the source and destination create-rules can diverge later
// without a call-site change.
export const isExchangeCreateSourceType = (type: HoldingType): boolean =>
  match(type)
    .with('cash', () => true)
    .with('card', 'term_deposit', 'bond', 'crypto_asset', 'jar', () => false)
    .exhaustive();

export const isExchangeCreateDestinationType = (type: HoldingType): boolean =>
  match(type)
    .with('cash', () => true)
    .with('card', 'term_deposit', 'bond', 'crypto_asset', 'jar', () => false)
    .exhaustive();
```

- [ ] **Step 4 (qa): Run tests to verify they pass**

Run: `npx jest src/holdings/exchange-destination.test.ts`
Expected: PASS (new predicate tests plus the existing wider-predicate tests).

- [ ] **Step 5 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green (watch `check:knip` — the two new exports are consumed in Task 3;
sequence Task 3 after this, or accept the transient knip flag only within this
task and confirm it clears after Task 3).

**Dependencies:** none. Consumed by Task 3.

---

## Task 2: Account name in the holding picker (Requirement C)

Add `accountName` to `HoldingSelectOption` and render it in `HoldingSelectField`
(both the collapsed field selection and each sheet row), so a user can tell two
same-named holdings apart across accounts. Pure presentational change; the form
(Task 3) supplies the account name.

**Files:**
- Modify: `src/screens/forms/holding-select-field/holding-select-field.props.d.ts`
- Modify: `src/screens/forms/holding-select-field/holding-select-field.component.tsx`
- Modify: `src/screens/forms/holding-select-field/holding-select-field.styles.ts`
- Test: `src/screens/forms/holding-select-field/holding-select-field.component.test.tsx`

**Interfaces:**
- Produces (updated):

```ts
// holding-select-field.props.d.ts
export type HoldingSelectOption = {
  id: string;
  name: string;
  icon: string;
  color: string;
  currency: Currency;
  accountName: string; // the parent account's display name (Requirement C)
};
```

- [ ] **Step 1 (qa): Write the failing test**

Update the existing `holding-select-field.component.test.tsx` fixtures to include
`accountName`, and add an assertion. The existing tests build options like
`{ id: 'h1', name: 'Card USD', icon: 'creditcard', color: '#3366FF', currency: 'USD' }`
— add `accountName` to each and add:

```tsx
it('shows each option\'s parent account name in the sheet', () => {
  const { getByLabelText, getByText } = render(
    <HoldingSelectField
      label="To"
      placeholder="Select holding"
      options={[
        {
          id: 'h1',
          name: 'Card USD',
          icon: 'creditcard',
          color: '#3366FF',
          currency: 'USD',
          accountName: 'Personal',
        },
        {
          id: 'h2',
          name: 'Card USD',
          icon: 'creditcard',
          color: '#22AA55',
          currency: 'USD',
          accountName: 'Business',
        },
      ]}
      selectedId={null}
      onSelect={jest.fn()}
    />,
  );

  fireEvent.press(getByLabelText('To'));

  // Two same-named holdings are disambiguated by their account names.
  expect(getByText('Personal')).toBeTruthy();
  expect(getByText('Business')).toBeTruthy();
});
```

Also add `accountName` to the fixtures used by the pre-existing tests so the
file typechecks.

- [ ] **Step 2 (qa): Run test to verify it fails**

Run: `npx jest src/screens/forms/holding-select-field`
Expected: FAIL — the account name is not rendered (and/or a type error on the
new required field until Step 3 lands).

- [ ] **Step 3 (developer): Add the field to props and render it**

In `holding-select-field.props.d.ts`, add `accountName: string;` to
`HoldingSelectOption` (see Interfaces above).

In `holding-select-field.component.tsx`, extend the sheet row's caption line to
show the account name alongside the currency (currently
`<Text variant="caption" ...>{option.currency}</Text>`). Combine them into one
caption so the row stays a single line of secondary text:

```tsx
<Box style={styles.optionText}>
  <Text variant="body">{option.name}</Text>

  <Text variant="caption" tone={isSelected ? 'textPrimary' : 'textSecondary'}>
    {`${option.accountName} · ${option.currency}`}
  </Text>
</Box>
```

For the collapsed field selection (currently just the icon + `selected.name`),
append the account name as a trailing caption so the picked holding is also
disambiguated when the sheet is closed:

```tsx
<Box direction="row" gap={2} style={styles.field}>
  {selected && (
    <SymbolIcon name={selected.icon} size={18} tone="textSecondary" color={selected.color} />
  )}

  <Text variant="body" tone={selected ? 'textPrimary' : 'textSecondary'}>
    {selected?.name ?? placeholder}
  </Text>

  {selected && (
    <Text variant="caption" tone="textSecondary">
      {selected.accountName}
    </Text>
  )}
</Box>
```

If the trailing caption needs to push to the field's right edge, add a style in
`holding-select-field.styles.ts` (e.g. `fieldAccount: { marginLeft: 'auto' }`)
and apply it; otherwise leave the styles unchanged. Use tokens only — no
hardcoded spacing/color. Keep the ` · ` separator as a literal glyph inside the
interpolation (it is punctuation, not translatable copy).

- [ ] **Step 4 (qa): Run test to verify it passes**

Run: `npx jest src/screens/forms/holding-select-field`
Expected: PASS.

- [ ] **Step 5 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green. (`HoldingSelectOption` now has a required `accountName`;
`transaction-form.screen.tsx`'s `buildDestinationOptions` will not compile until
Task 3 supplies it — sequence Task 3 immediately after, or run this task's Jest
in isolation and let the project-wide `check:all` go green after Task 3. Note
this ordering in the task hand-off.)

**Dependencies:** none for the component itself; its consumer is updated in Task 3.

---

## Task 3: Create-mode form — cash-only gating + account-name threading (Requirements B & C)

Wire the new create-scoped predicates (Task 1) and account names (Task 2) into
`transaction-form.screen.tsx` for CREATE-mode Exchange. This makes create offer
Exchange only from a `cash` source, list only `cash` destinations, and show each
destination's account name.

**Files:**
- Modify: `src/screens/forms/transaction-form.screen.tsx`
- Test: `src/screens/forms/transaction-form.screen.test.tsx`

**Interfaces:**
- Consumes: `isExchangeCreateSourceType`, `isExchangeCreateDestinationType`
  (Task 1); the updated `HoldingSelectOption` with `accountName` (Task 2);
  `accountsRepo.listQuery` from `src/repositories/accounts.repo.ts`;
  `useLiveQuery`.

- [ ] **Step 1 (qa): Write/adjust the failing tests**

In `transaction-form.screen.test.tsx`, the existing Exchange-mode tests assume
`card` sources and non-cash destinations. Update them to the new cash-only rule
and add account-name coverage. Ensure the `holdingsRepo`/`accountsRepo` mocks
return holdings carrying `accountId` and accounts carrying `id`/`name`. Add:

```tsx
describe('TransactionFormScreen — Exchange create (cash-only, account names)', () => {
  it('offers Exchange from a cash source but NOT from a card source', async () => {
    const cash = await renderAddFromHolding('cash-1'); // type 'cash'
    expect(cash.queryByText('Exchange')).toBeTruthy();

    const card = await renderAddFromHolding('card-1'); // type 'card'
    expect(card.queryByText('Exchange')).toBeNull();
  });

  it('lists only cash destinations (card/crypto/term_deposit/bond/jar excluded) and shows account names', async () => {
    const { getByText, getByLabelText, queryByText } = await renderAddFromHolding('cash-1');

    fireEvent.press(getByText('Exchange'));
    fireEvent.press(getByLabelText('To'));

    // Another cash holding is offered, with its account name shown.
    expect(getByText('Cash USD')).toBeTruthy();
    expect(getByText('Wallet')).toBeTruthy(); // Cash USD's parent account name

    // The source itself and every non-cash type are excluded on create.
    expect(queryByText('Cash UAH')).toBeNull(); // the source itself
    expect(queryByText('Card USD')).toBeNull(); // card excluded on create
    expect(queryByText('BTC Wallet')).toBeNull(); // crypto excluded on create
    expect(queryByText('USD Deposit')).toBeNull(); // term_deposit excluded on create
  });

  it('saves a cash->cash exchange with correct minor units and holding ids', async () => {
    const { getByText, getByLabelText } = await renderAddFromHolding('cash-1');
    fireEvent.press(getByText('Exchange'));

    fireEvent.changeText(getByLabelText('Value Out'), '100');
    fireEvent.press(getByLabelText('To'));
    fireEvent.press(getByText('Cash USD'));
    fireEvent.changeText(getByLabelText('Value In'), '2.50');

    fireEvent.press(getByText('Save'));

    await waitFor(() =>
      expect(mockRecordExchange).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceHoldingId: 'cash-1',
          sourceName: 'Cash UAH',
          valueOutMinorUnits: 10_000, // 100 UAH -> minor (scale 2)
          destinationHoldingId: 'cash-usd-1',
          destinationName: 'Cash USD',
          destinationType: 'cash',
          valueInMinorUnits: 250, // 2.50 USD -> minor (scale 2)
        }),
      ),
    );
  });
});
```

Fixtures: `cash-1` (type `cash`, currency UAH, name 'Cash UAH', accountId 'acc-cash'),
`cash-usd-1` (type `cash`, currency USD, name 'Cash USD', accountId 'acc-wallet'),
`card-1` (type `card`, name 'Card USD'), a `crypto` 'BTC Wallet', a `term_deposit`
'USD Deposit'; accounts `acc-cash` name 'Home', `acc-wallet` name 'Wallet'. Add a
`renderAddFromHolding(holdingId)` helper if not already present. Retire or update
any prior test that expected a `card` source to offer Exchange or expected a
non-cash create destination.

- [ ] **Step 2 (qa): Run tests to verify they fail**

Run: `npx jest src/screens/forms/transaction-form.screen.test.tsx -t "Exchange create"`
Expected: FAIL — create still uses the wider predicates and options carry no
`accountName`.

- [ ] **Step 3 (developer): Rewire create-mode gating and options**

1. Imports — swap the create-mode gate to the new predicates and add the
   accounts query (keep the wider predicates imported too; convert-mode in
   Task 7 uses them). Two-group, shortest-first ordering:

```ts
import {
  isExchangeCreateDestinationType,
  isExchangeCreateSourceType,
  isExchangeDestinationType,
  isExchangeSourceType,
} from '../../holdings/exchange-destination';
import { accountsRepo } from '../../repositories/accounts.repo';
```

2. Load accounts and build an id -> name map in the component body (next to the
   existing `holdings` live query):

```ts
const { data: accounts } = useLiveQuery(accountsRepo.listQuery(), ['accounts']);
const accountNameById = new Map(accounts.map((account) => [account.id, account.name]));
```

3. Change `resolveModeOptions` to gate on `isExchangeCreateSourceType` (cash
   only) instead of `isExchangeSourceType`:

```ts
const resolveModeOptions = (
  isEditing: boolean,
  holding: Pick<HoldingRow, 'type'> | undefined,
): readonly FormMode[] => {
  const canExchange =
    !isEditing && holding !== undefined && isExchangeCreateSourceType(holding.type);

  return canExchange ? ['income', 'expense', 'exchange'] : ['income', 'expense'];
};
```

4. Generalize `buildDestinationOptions` into a predicate- and account-map-taking
   builder so the same function serves create-mode AND both convert-mode
   directions (Task 7), and threads `accountName` (Requirement C):

```ts
// Every OPEN, non-excluded holding except `excludeHoldingId`, projected to a
// picker option carrying its parent account name (Requirement C). The eligible
// TYPE test is injected by the caller so one builder serves create-mode
// (cash-only) and both convert-mode directions (the wider rules) without
// duplicating the projection.
const buildExchangeOptions = (
  holdings: readonly HoldingRow[],
  accountNameById: ReadonlyMap<string, string>,
  excludeHoldingId: string | undefined,
  isEligibleType: (type: HoldingRow['type']) => boolean,
): HoldingSelectOption[] =>
  holdings
    .filter(
      (candidate) =>
        candidate.id !== excludeHoldingId &&
        candidate.closedAt == null &&
        isEligibleType(candidate.type),
    )
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      icon: candidate.icon ?? holdingTypeSymbol[candidate.type],
      color: resolveEntityColor(candidate.color, defaultHoldingColor[candidate.type]),
      currency: candidate.currency,
      accountName: accountNameById.get(candidate.accountId) ?? '',
    }));
```

Remove the old `buildDestinationOptions` and update the create call site:

```ts
const destinationOptions = buildExchangeOptions(
  holdings,
  accountNameById,
  holdingId,
  isExchangeCreateDestinationType,
);
```

No change to `saveExchange` or the `ExchangeFields` JSX is required for B/C
beyond the options now being cash-only and carrying account names.

- [ ] **Step 4 (qa): Run tests to verify they pass**

Run: `npx jest src/screens/forms/transaction-form.screen.test.tsx`
Expected: PASS (updated Exchange-create tests plus all existing tests).

- [ ] **Step 5 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green — the Task 1 predicate exports and the Task 2 `accountName`
field are now consumed, clearing any transient knip flag. Watch `check:deps`:
`accountsRepo` is already a dependency, so no new package. Watch
`noExcessiveCognitiveComplexity` on the screen — the `buildExchangeOptions`
extraction keeps the projection out of the component body.

**Dependencies:** Tasks 1 and 2.

---

## Task 4: Convert-mode pure logic (Requirement A — eligibility + direction)

A small pure module that answers two questions the form and its tests both need:
"is this existing transaction convertible?" and "which leg does the user record?"
Kept pure (no React, no DB) so it is trivially unit-tested and reused.

**Files:**
- Create: `src/holdings/exchange-convert.ts`
- Test: `src/holdings/exchange-convert.test.ts`

**Interfaces:**
- Consumes: `HoldingType` from `./holding-type`; `isExchangeSourceType` from
  `./exchange-destination`.
- Produces:
  - `type ExchangeConvertDirection = 'record-destination' | 'record-source'`
  - `canConvertToExchange(holdingType: HoldingType, amountMinorUnits: number): boolean`
  - `exchangeConvertDirection(amountMinorUnits: number): ExchangeConvertDirection | null`

- [ ] **Step 1 (qa): Write the failing tests**

```ts
// src/holdings/exchange-convert.test.ts
import {
  canConvertToExchange,
  exchangeConvertDirection,
} from './exchange-convert';

describe('canConvertToExchange', () => {
  it('is eligible for a non-zero amount on a liquid (cash/card) holding', () => {
    expect(canConvertToExchange('cash', -500)).toBe(true);
    expect(canConvertToExchange('card', 500)).toBe(true);
  });

  it('is NOT eligible for a zero amount (no sign to pick a direction from)', () => {
    expect(canConvertToExchange('cash', 0)).toBe(false);
    expect(canConvertToExchange('card', 0)).toBe(false);
  });

  it('is NOT eligible on a non-liquid holding, regardless of amount', () => {
    expect(canConvertToExchange('term_deposit', -500)).toBe(false);
    expect(canConvertToExchange('bond', 500)).toBe(false);
    expect(canConvertToExchange('crypto_asset', -500)).toBe(false);
    expect(canConvertToExchange('jar', 500)).toBe(false);
  });
});

describe('exchangeConvertDirection', () => {
  it('records the DESTINATION leg for an existing expense (negative amount)', () => {
    expect(exchangeConvertDirection(-500)).toBe('record-destination');
  });

  it('records the SOURCE leg for an existing income (positive amount)', () => {
    expect(exchangeConvertDirection(500)).toBe('record-source');
  });

  it('returns null for a zero amount (no direction)', () => {
    expect(exchangeConvertDirection(0)).toBeNull();
  });
});
```

- [ ] **Step 2 (qa): Run tests to verify they fail**

Run: `npx jest src/holdings/exchange-convert.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3 (developer): Implement**

```ts
// src/holdings/exchange-convert.ts
import { isExchangeSourceType } from './exchange-destination';
import type { HoldingType } from './holding-type';

// Which leg the user records when converting an existing transaction into an
// Exchange, chosen by the sign of the existing amount (spec "Direction, by the
// sign of the existing transaction"):
//   - an existing EXPENSE (amount < 0) is the SOURCE leg, so the user records
//     the missing DESTINATION (receipt) leg -> 'record-destination';
//   - an existing INCOME (amount > 0) is the DESTINATION leg, so the user
//     records the missing SOURCE (payment) leg -> 'record-source'.
export type ExchangeConvertDirection = 'record-destination' | 'record-source';

// A transaction is convertible when its holding is liquid (cash/card — the same
// wider source eligibility create-mode uses, kept for convert-mode by design)
// AND its amount is non-zero (a zero has no sign to pick a direction from).
// Applies to BOTH manual and synced rows — the caller does not gate on `source`.
export const canConvertToExchange = (
  holdingType: HoldingType,
  amountMinorUnits: number,
): boolean => isExchangeSourceType(holdingType) && amountMinorUnits !== 0;

export const exchangeConvertDirection = (
  amountMinorUnits: number,
): ExchangeConvertDirection | null => {
  if (amountMinorUnits < 0) {
    return 'record-destination';
  }

  if (amountMinorUnits > 0) {
    return 'record-source';
  }

  return null;
};
```

- [ ] **Step 4 (qa): Run tests to verify they pass**

Run: `npx jest src/holdings/exchange-convert.test.ts`
Expected: PASS.

- [ ] **Step 5 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green (watch `check:knip` — both exports are consumed in Task 7;
sequence accordingly or accept the transient flag within this task).

**Dependencies:** Task 1 is not required (this uses the pre-existing
`isExchangeSourceType`). Consumed by Tasks 6 and 7.

---

## Task 5: `recordExchangeCounterpart` repo write (Requirement A — single-leg write)

Add the repo method convert-mode saves through. It writes exactly the ONE
missing leg in a single `db.transaction()` and NEVER touches the existing row.
It reuses `recordManualTx` / `appendDepositContributionTx` / `exchangeReceivePath`
so it can never drift from create-mode's `recordExchange` on dispatch, sign, or
description convention.

**Files:**
- Modify: `src/repositories/transactions.repo.ts`
- Test: `src/repositories/transactions.repo.test.ts`

**Interfaces:**
- Consumes: `recordManualTx` (module-private, existing), `appendDepositContributionTx`
  (existing, from `./holdings.repo`), `exchangeReceivePath` (existing, from
  `../holdings/exchange-destination`), `ExchangeConvertDirection` (Task 4),
  `match` from `ts-pattern`, `DepositContribution`, `HoldingRow`.
- Produces:

```ts
type ExchangeCounterpartInput = {
  direction: ExchangeConvertDirection; // 'record-destination' | 'record-source'
  counterpartHoldingId: string;
  counterpartType: HoldingRow['type'];
  amountMinorUnits: number; // positive magnitude of the NEW leg, in its currency
  existingHoldingName: string; // for the fixed description copy
  time: number;
};
// transactionsRepo.recordExchangeCounterpart: (input: ExchangeCounterpartInput) => Promise<void>
```

- [ ] **Step 1 (qa): Write the failing tests**

Follow the existing `mockTx` pattern in `transactions.repo.test.ts` (the same
one the `recordExchange` tests use). Add a describe block:

```ts
describe('transactionsRepo.recordExchangeCounterpart', () => {
  it('records a POSITIVE plain destination leg for an expense-sourced convert (record-destination)', async () => {
    const inserts: Record<string, unknown>[] = [];
    const updates: { table: unknown; values: Record<string, unknown> }[] = [];
    mockTx = {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          inserts.push(values);

          return Promise.resolve();
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ balanceMinorUnits: 2_000 }]) }),
        }),
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          updates.push({ table, values });

          return { where: () => Promise.resolve() };
        },
      }),
    };

    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-destination',
      counterpartHoldingId: 'dst-1',
      counterpartType: 'cash',
      amountMinorUnits: 7_000,
      existingHoldingName: 'Cash UAH',
      time: 123,
    });

    // Exactly ONE new ledger row: a positive receipt with the fixed description.
    expect(inserts).toEqual([
      expect.objectContaining({
        holdingId: 'dst-1',
        amountMinorUnits: 7_000,
        time: 123,
        description: 'Exchange from Cash UAH',
        source: 'manual',
      }),
    ]);
    expect(inserts).toHaveLength(1);
  });

  it('records a NEGATIVE plain source leg for an income-sourced convert (record-source)', async () => {
    const inserts: Record<string, unknown>[] = [];
    mockTx = {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          inserts.push(values);

          return Promise.resolve();
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ balanceMinorUnits: 5_000 }]) }),
        }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    };

    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-source',
      counterpartHoldingId: 'src-1',
      counterpartType: 'card',
      amountMinorUnits: 3_000,
      existingHoldingName: 'Card USD',
      time: 456,
    });

    // A source leg is ALWAYS a plain NEGATIVE transaction, never a contribution.
    expect(inserts).toEqual([
      expect.objectContaining({
        holdingId: 'src-1',
        amountMinorUnits: -3_000,
        time: 456,
        description: 'Exchange to Card USD',
        source: 'manual',
      }),
    ]);
  });

  it('records a term_deposit destination as a contribution (metadata rewrite, no new ledger row)', async () => {
    // Use the call-ordered select fake (the file's existing `selectQueue`
    // pattern) so the destination read returns a valid
    // { type: 'term_deposit', metadata: <valid deposit meta> } row. Assert NO
    // transaction insert happened and the holdings metadata was updated.
    // (Reuse an asTermDepositMeta-compatible fixture from holdings.repo.test.)
    // ...build mockTx with a selectQueue returning the deposit row...
    const inserts: Record<string, unknown>[] = [];
    // configure mockTx.insert to push into `inserts`, update to record a
    // holdings metadata set, select to return the deposit row.
    // Then:
    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-destination',
      counterpartHoldingId: 'dep-1',
      counterpartType: 'term_deposit',
      amountMinorUnits: 5_000,
      existingHoldingName: 'Cash UAH',
      time: 1,
    });

    expect(inserts).toHaveLength(0); // a deposit receive writes NO ledger row
  });

  it('throws for an income-sourced convert into a term_deposit (a source leg is never a contribution)', async () => {
    mockTx = {
      insert: () => ({ values: () => Promise.resolve() }),
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([{ balanceMinorUnits: 0 }]) }) }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    };

    await expect(
      transactionsRepo.recordExchangeCounterpart({
        direction: 'record-source',
        counterpartHoldingId: 'dep-1',
        counterpartType: 'term_deposit',
        amountMinorUnits: 1_000,
        existingHoldingName: 'Card USD',
        time: 1,
      }),
    ).rejects.toThrow();
  });

  it('throws for a bond/jar destination (excluded)', async () => {
    mockTx = {
      insert: () => ({ values: () => Promise.resolve() }),
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([{ balanceMinorUnits: 0 }]) }) }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    };

    await expect(
      transactionsRepo.recordExchangeCounterpart({
        direction: 'record-destination',
        counterpartHoldingId: 'bond-1',
        counterpartType: 'bond',
        amountMinorUnits: 1_000,
        existingHoldingName: 'Cash UAH',
        time: 1,
      }),
    ).rejects.toThrow();
  });
});
```

Note for the implementer: the term_deposit test needs the same call-ordered
`select` fake the existing deposit tests use — return a valid
`{ type: 'term_deposit', metadata }` row for the destination read. Keep the
assertion focused on "no ledger insert; metadata rewritten."

- [ ] **Step 2 (qa): Run tests to verify they fail**

Run: `npx jest src/repositories/transactions.repo.test.ts -t recordExchangeCounterpart`
Expected: FAIL — `recordExchangeCounterpart` is not a function.

- [ ] **Step 3 (developer): Implement `recordExchangeCounterpart`**

Add the import for the direction type (group with the existing
`../holdings/...` imports):

```ts
import type { ExchangeConvertDirection } from '../holdings/exchange-convert';
```

Add the input type near the existing `ExchangeInput`:

```ts
type ExchangeCounterpartInput = {
  direction: ExchangeConvertDirection;
  counterpartHoldingId: string;
  counterpartType: HoldingRow['type'];
  amountMinorUnits: number;
  existingHoldingName: string;
  time: number;
};
```

Add the method inside the `transactionsRepo` object, after `recordExchange`:

```ts
  /**
   * Convert-mode (spec "Convert an existing transaction"): record the ONE
   * missing counterpart leg of an existing transaction in ONE op-sqlite
   * transaction, and NEVER touch the existing row (which may be a synced,
   * bank-owned row). The direction is chosen by the caller from the existing
   * amount's sign:
   *   - 'record-destination' (existing was an EXPENSE): a POSITIVE receipt on
   *     the picked destination, dispatched by type exactly as `recordExchange`
   *     does — plain (+amount) for cash/card/crypto_asset, a deposit
   *     contribution for term_deposit, and bond/jar rejected.
   *   - 'record-source' (existing was an INCOME): a NEGATIVE payment on the
   *     picked source, always a plain transaction (a source leg is never a
   *     contribution).
   * The description is the fixed copy create-mode uses. Balances are read INSIDE
   * the transaction, never from a render snapshot, exactly as `recordManual` does.
   */
  recordExchangeCounterpart: (input: ExchangeCounterpartInput) =>
    write((tx) =>
      match(input.direction)
        .with('record-source', () =>
          recordManualTx(tx, {
            holdingId: input.counterpartHoldingId,
            amountMinorUnits: -input.amountMinorUnits,
            time: input.time,
            description: `Exchange to ${input.existingHoldingName}`,
          }),
        )
        .with('record-destination', () =>
          match(exchangeReceivePath(input.counterpartType))
            .with('plain', () =>
              recordManualTx(tx, {
                holdingId: input.counterpartHoldingId,
                amountMinorUnits: input.amountMinorUnits,
                time: input.time,
                description: `Exchange from ${input.existingHoldingName}`,
              }),
            )
            .with('contribution', () => {
              const contribution: DepositContribution = {
                amountMinorUnits: input.amountMinorUnits,
                date: input.time,
              };

              return appendDepositContributionTx(tx, input.counterpartHoldingId, contribution);
            })
            .with('excluded', () => {
              throw new Error(
                `recordExchangeCounterpart: ${input.counterpartType} is not a valid destination`,
              );
            })
            .exhaustive(),
        )
        .exhaustive(),
    ),
```

Note: the `record-source` branch does NOT consult `exchangeReceivePath` — a
source leg is always a plain negative transaction. The "income convert into a
term_deposit throws" test passes because the form's source picker only offers
`cash`/`card`; if a caller nonetheless sends `record-source` with a
`term_deposit` counterpart, `recordManualTx` inserts a plain negative row rather
than a contribution — which is still a valid write. To make that test's `throws`
assertion meaningful, guard it explicitly at the top of the method instead:

```ts
      if (input.direction === 'record-source' && exchangeReceivePath(input.counterpartType) !== 'plain') {
        throw new Error(
          `recordExchangeCounterpart: a source leg must be a plain holding, got ${input.counterpartType}`,
        );
      }
```

Place that guard before the `match(input.direction)` block. (This mirrors the
spec's "a source leg is always a plain negative transaction, never a
contribution" and keeps the repo defensive even though the form already
restricts the source picker.)

- [ ] **Step 4 (qa): Run tests to verify they pass**

Run: `npx jest src/repositories/transactions.repo.test.ts`
Expected: PASS (new `recordExchangeCounterpart` tests plus all existing tests,
including `recordExchange`).

- [ ] **Step 5 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green.

**Dependencies:** Task 4 (`ExchangeConvertDirection`). Reuses the already-built
`recordManualTx`, `appendDepositContributionTx`, `exchangeReceivePath`.

---

## Task 6: `ConvertExchangeFields` component (Requirement A — convert form group)

The single-counterpart field group convert-mode renders: a read-only fixed side
(the existing leg's amount, in its currency), one holding picker for the OTHER
leg, one amount field for that leg, and the shared Date field. Modeled on
`exchange-fields`. Purely presentational — the screen (Task 7) supplies the
direction-dependent labels, the fixed display value, and the filtered options.

**Files:**
- Create: `src/screens/forms/convert-exchange-fields/convert-exchange-fields.component.tsx`
- Create: `src/screens/forms/convert-exchange-fields/convert-exchange-fields.props.d.ts`
- Create: `src/screens/forms/convert-exchange-fields/index.ts`
- Test: `src/screens/forms/convert-exchange-fields/convert-exchange-fields.component.test.tsx`

**Interfaces:**
- Produces:

```ts
// convert-exchange-fields.props.d.ts
import type { HoldingSelectOption } from '../holding-select-field/holding-select-field.props';

export type ConvertExchangeFieldsProps = {
  // The read-only fixed side: the existing leg's label ('Value Out' for an
  // expense-sourced convert, 'Value In' for an income-sourced convert) and its
  // pre-formatted display value (major units, grouped) in the existing holding's
  // currency. Never editable — the existing row is never re-written.
  fixedLabel: string;
  fixedValue: string;
  // The NEW leg the user records: its picker label ('To' for a destination,
  // 'From' for a source), the eligible options, the picked id, and the amount.
  counterpartLabel: string;
  counterpartPlaceholder: string;
  counterpartOptions: readonly HoldingSelectOption[];
  counterpartHoldingId: string | null;
  onSelectCounterpart: (id: string) => void;
  counterpartAmountLabel: string;
  counterpartAmount: string;
  onChangeCounterpartAmount: (text: string) => void;
  // The shared Date field (defaults to the existing transaction's time).
  time: number;
  onChangeTime: (timestamp: number) => void;
};
```

- Consumes: `TextField`, `DateField`, `HoldingSelectField` design-system/form
  components; `useTranslation` only for the shared Date label.

- [ ] **Step 1 (qa): Write the failing test**

```tsx
// convert-exchange-fields.component.test.tsx
import { fireEvent, render } from '@testing-library/react-native';

import ConvertExchangeFields from './convert-exchange-fields.component';
import type { HoldingSelectOption } from '../holding-select-field/holding-select-field.props';

const options: HoldingSelectOption[] = [
  {
    id: 'h1',
    name: 'Cash USD',
    icon: 'banknote',
    color: '#3366FF',
    currency: 'USD',
    accountName: 'Wallet',
  },
];

const baseProps = {
  fixedLabel: 'Value Out',
  fixedValue: '1,000.00',
  counterpartLabel: 'To',
  counterpartPlaceholder: 'Select holding',
  counterpartOptions: options,
  counterpartHoldingId: null,
  onSelectCounterpart: jest.fn(),
  counterpartAmountLabel: 'Value In',
  counterpartAmount: '',
  onChangeCounterpartAmount: jest.fn(),
  time: 0,
  onChangeTime: jest.fn(),
};

describe('ConvertExchangeFields', () => {
  it('shows the fixed (read-only) side value', () => {
    const { getByText, getByDisplayValue } = render(<ConvertExchangeFields {...baseProps} />);

    expect(getByText('Value Out')).toBeTruthy();
    expect(getByDisplayValue('1,000.00')).toBeTruthy();
  });

  it('reports the picked counterpart holding', () => {
    const onSelectCounterpart = jest.fn();
    const { getByLabelText, getByText } = render(
      <ConvertExchangeFields {...baseProps} onSelectCounterpart={onSelectCounterpart} />,
    );

    fireEvent.press(getByLabelText('To'));
    fireEvent.press(getByText('Cash USD'));

    expect(onSelectCounterpart).toHaveBeenCalledWith('h1');
  });

  it('reports the entered counterpart amount', () => {
    const onChangeCounterpartAmount = jest.fn();
    const { getByLabelText } = render(
      <ConvertExchangeFields
        {...baseProps}
        onChangeCounterpartAmount={onChangeCounterpartAmount}
      />,
    );

    fireEvent.changeText(getByLabelText('Value In'), '42');

    expect(onChangeCounterpartAmount).toHaveBeenCalledWith('42');
  });
});
```

- [ ] **Step 2 (qa): Run test to verify it fails**

Run: `npx jest src/screens/forms/convert-exchange-fields`
Expected: FAIL — module not found.

- [ ] **Step 3 (developer): Implement the component, props, and index**

```tsx
// convert-exchange-fields.component.tsx
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import TextField from '../../../design-system/components/text-field';
import DateField from '../date-field';
import HoldingSelectField from '../holding-select-field';

import type { ConvertExchangeFieldsProps } from './convert-exchange-fields.props';

// Convert-mode's single-counterpart field group (spec "Convert an existing
// transaction"): the existing leg is shown as a read-only fixed field (never
// re-written), followed by the ONE leg the user records — a holding picker, an
// amount field, and the shared Date field. Direction-dependent labels
// ('Value Out'/'To'/'Value In' for an expense-sourced convert, or
// 'Value In'/'From'/'Value Out' for an income-sourced convert) are supplied by
// the screen so this component stays direction-agnostic. Its own file/folder per
// kiko-code-style (one component per file), which also keeps the screen's JSX a
// single conditional branch.
const ConvertExchangeFields: FC<ConvertExchangeFieldsProps> = ({
  fixedLabel,
  fixedValue,
  counterpartLabel,
  counterpartPlaceholder,
  counterpartOptions,
  counterpartHoldingId,
  onSelectCounterpart,
  counterpartAmountLabel,
  counterpartAmount,
  onChangeCounterpartAmount,
  time,
  onChangeTime,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <TextField
        label={fixedLabel}
        value={fixedValue}
        onChangeText={() => undefined}
        editable={false}
        keyboardType="decimal-pad"
      />

      <HoldingSelectField
        label={counterpartLabel}
        placeholder={counterpartPlaceholder}
        options={counterpartOptions}
        selectedId={counterpartHoldingId}
        onSelect={onSelectCounterpart}
      />

      <TextField
        label={counterpartAmountLabel}
        value={counterpartAmount}
        onChangeText={onChangeCounterpartAmount}
        keyboardType="decimal-pad"
        placeholder="0.00"
      />

      <DateField label={t('forms.fields.date')} value={time} onChange={onChangeTime} />
    </>
  );
};

export default ConvertExchangeFields;
```

```ts
// index.ts
export { default } from './convert-exchange-fields.component';
```

Confirm at implementation time that `TextField` renders the `value` under a
disabled/`editable={false}` state so `getByDisplayValue` finds it (the existing
Amount field renders its value; `editable={false}` is already used elsewhere on
this screen for synced rows). If `TextField` swaps to a `Text` when not
editable, the test's `getByDisplayValue` must become `getByText` — align the
test with the real primitive.

- [ ] **Step 4 (qa): Run test to verify it passes**

Run: `npx jest src/screens/forms/convert-exchange-fields`
Expected: PASS.

- [ ] **Step 5 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green (watch `check:knip` — the component is consumed in Task 7).

**Dependencies:** Task 2 (`HoldingSelectOption.accountName`). Consumed by Task 7.

---

## Task 7: Wire convert-mode into the transaction form (Requirement A — integration + copy)

Add the "Convert to Exchange" action and the convert sub-mode to
`transaction-form.screen.tsx`: the action appears on the edit screen when the
existing row is eligible (`canConvertToExchange`), for BOTH manual and synced
rows; pressing it swaps the edit fields for `ConvertExchangeFields`; Save writes
the one missing leg via `recordExchangeCounterpart` and never touches the
existing row. Add the new i18n copy.

**Files:**
- Modify: `src/screens/forms/transaction-form.screen.tsx`
- Modify: `src/i18n/locales/en.ts`
- Modify: `src/i18n/locales/uk.ts`
- Test: `src/screens/forms/transaction-form.screen.test.tsx`

**Interfaces:**
- Consumes: `canConvertToExchange`, `exchangeConvertDirection`,
  `ExchangeConvertDirection` (Task 4); `isExchangeSourceType`,
  `isExchangeDestinationType` (existing wider predicates);
  `transactionsRepo.recordExchangeCounterpart` (Task 5); `ConvertExchangeFields`
  (Task 6); `buildExchangeOptions` (Task 3); `Money.fromMajor`, `parseAmount`,
  `groupAmount`, `toAmountFields` (existing).

- [ ] **Step 1 (qa): Write the failing tests**

Add to `transaction-form.screen.test.tsx`. Add a `recordExchangeCounterpart`
jest.fn to the `transactionsRepo` mock. Use a `renderEdit(transactionId)` helper
that seeds the by-id query with the given existing row.

```tsx
describe('TransactionFormScreen — Convert to Exchange', () => {
  it('shows the action for a non-zero expense on a cash/card holding (manual AND synced)', async () => {
    const manual = await renderEdit('expense-manual'); // amount < 0, cash, source manual
    expect(manual.queryByText('Convert to Exchange')).toBeTruthy();

    const synced = await renderEdit('expense-synced'); // amount < 0, card, source monobank
    expect(synced.queryByText('Convert to Exchange')).toBeTruthy();
  });

  it('does NOT show the action for a zero amount or a non-liquid holding', async () => {
    const zero = await renderEdit('zero-amount'); // amount === 0
    expect(zero.queryByText('Convert to Exchange')).toBeNull();

    const deposit = await renderEdit('deposit-txn'); // holding term_deposit
    expect(deposit.queryByText('Convert to Exchange')).toBeNull();
  });

  it('opens the destination ("To") form for an expense-sourced convert', async () => {
    const { getByText, getByLabelText } = await renderEdit('expense-manual');

    fireEvent.press(getByText('Convert to Exchange'));

    // Expense source: the fixed side is Value Out; the picked leg is a destination ("To").
    expect(getByText('Value Out')).toBeTruthy();
    expect(getByLabelText('To')).toBeTruthy();
    expect(getByLabelText('Value In')).toBeTruthy();
  });

  it('opens the source ("From") form for an income-sourced convert', async () => {
    const { getByText, getByLabelText } = await renderEdit('income-manual'); // amount > 0

    fireEvent.press(getByText('Convert to Exchange'));

    // Income destination: the fixed side is Value In; the picked leg is a source ("From").
    expect(getByText('Value In')).toBeTruthy();
    expect(getByLabelText('From')).toBeTruthy();
    expect(getByLabelText('Value Out')).toBeTruthy();
  });

  it('writes the destination leg with the right sign, id, and description for an expense convert', async () => {
    const { getByText, getByLabelText } = await renderEdit('expense-manual');
    // existing: holding 'cash-1' name 'Cash UAH', amount -10_000 (100.00 UAH)

    fireEvent.press(getByText('Convert to Exchange'));
    fireEvent.press(getByLabelText('To'));
    fireEvent.press(getByText('Cash USD')); // a cash destination in another account
    fireEvent.changeText(getByLabelText('Value In'), '2.50');

    fireEvent.press(getByText('Save'));

    await waitFor(() =>
      expect(mockRecordExchangeCounterpart).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'record-destination',
          counterpartHoldingId: 'cash-usd-1',
          counterpartType: 'cash',
          amountMinorUnits: 250, // 2.50 USD -> minor
          existingHoldingName: 'Cash UAH',
        }),
      ),
    );
  });

  it('restricts the source picker to cash/card for an income convert', async () => {
    const { getByText, getByLabelText, queryByText } = await renderEdit('income-manual');

    fireEvent.press(getByText('Convert to Exchange'));
    fireEvent.press(getByLabelText('From'));

    expect(getByText('Cash USD')).toBeTruthy(); // cash offered
    expect(getByText('Card EUR')).toBeTruthy(); // card offered
    expect(queryByText('USD Deposit')).toBeNull(); // term_deposit NOT a source
    expect(queryByText('BTC Wallet')).toBeNull(); // crypto NOT a source
  });

  it('rejects a blank/zero/negative counterpart amount (no write)', async () => {
    const { getByText, getByLabelText } = await renderEdit('expense-manual');

    fireEvent.press(getByText('Convert to Exchange'));
    fireEvent.press(getByLabelText('To'));
    fireEvent.press(getByText('Cash USD'));
    // leave Value In blank
    fireEvent.press(getByText('Save'));

    expect(mockRecordExchangeCounterpart).not.toHaveBeenCalled();
  });

  it('never calls update/remove on the existing row when converting', async () => {
    const { getByText, getByLabelText } = await renderEdit('expense-synced');

    fireEvent.press(getByText('Convert to Exchange'));
    fireEvent.press(getByLabelText('To'));
    fireEvent.press(getByText('Cash USD'));
    fireEvent.changeText(getByLabelText('Value In'), '5');
    fireEvent.press(getByText('Save'));

    await waitFor(() => expect(mockRecordExchangeCounterpart).toHaveBeenCalled());
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
```

Fixtures to add: existing rows `expense-manual` (holding `cash-1` 'Cash UAH'
UAH, amount `-10_000`, source manual), `expense-synced` (holding `card-1`
'Card USD', amount `-5_000`, source monobank), `income-manual` (holding `cash-1`,
amount `+8_000`, source manual), `zero-amount` (amount `0`), `deposit-txn`
(holding a `term_deposit`). Holdings: `cash-usd-1` (cash, USD, 'Cash USD',
account 'Wallet'), `card-eur-1` (card, EUR, 'Card EUR'), a `term_deposit`
'USD Deposit', a `crypto` 'BTC Wallet'. Wire `mockUpdate`/`mockRemove` into the
`transactionsRepo` mock if not already present.

- [ ] **Step 2 (qa): Run tests to verify they fail**

Run: `npx jest src/screens/forms/transaction-form.screen.test.tsx -t "Convert to Exchange"`
Expected: FAIL — no convert action/fields exist.

- [ ] **Step 3 (developer): Add the i18n copy**

In `src/i18n/locales/en.ts`, inside the `forms.transaction` block (keep the
alphabetical ordering the block already follows):

```ts
      convertToExchange: 'Convert to Exchange',
      from: 'From',
```

In `src/i18n/locales/uk.ts`, inside the matching `forms.transaction` block:

```ts
      convertToExchange: 'Зробити обміном',
      from: 'Звідки',
```

(`to`, `valueIn`, `valueOut`, `selectHolding` already exist in both locales and
are reused. Confirm the exact Ukrainian phrasing with the user if unsure — see
Open Question 4; the strings above are a reasonable default.)

- [ ] **Step 4 (developer): Add convert state, derivation, options, and save**

In `transaction-form.screen.tsx`:

1. Imports:

```ts
import {
  canConvertToExchange,
  type ExchangeConvertDirection,
  exchangeConvertDirection,
} from '../../holdings/exchange-convert';
import ConvertExchangeFields from './convert-exchange-fields';
```

2. State — add a converting latch:

```ts
const [converting, setConverting] = useState(false);
const [counterpartHoldingId, setCounterpartHoldingId] = useState<string | null>(null);
const [counterpartAmount, setCounterpartAmount] = useState('');
```

3. Derive eligibility and direction from the loaded existing row (place after
   `existing`/`holding` are resolved):

```ts
// Convert-mode eligibility uses the WIDER (cash/card) rule, unchanged from the
// current create source rule — Requirement B's cash-only restriction applies to
// CREATE only. Both manual and synced rows qualify; the action never mutates the
// existing row, so a synced row stays safe.
const convertEligible =
  isEditing &&
  existing !== undefined &&
  holding !== undefined &&
  canConvertToExchange(holding.type, existing.amountMinorUnits);
const convertDirection: ExchangeConvertDirection | null = existing
  ? exchangeConvertDirection(existing.amountMinorUnits)
  : null;
```

4. Build the counterpart options with the direction-appropriate WIDER predicate
   (reusing `buildExchangeOptions` from Task 3):

```ts
// An expense-sourced convert picks a DESTINATION (wider: excludes bond/jar); an
// income-sourced convert picks a SOURCE (wider: cash/card only). Excludes the
// existing holding and closed holdings, and carries account names (Requirement C).
const counterpartOptions = buildExchangeOptions(
  holdings,
  accountNameById,
  holdingId,
  convertDirection === 'record-source' ? isExchangeSourceType : isExchangeDestinationType,
);
```

5. The fixed side's display value and the direction-dependent labels. The fixed
   value is the existing amount in the existing holding's currency, formatted the
   same way the Amount input shows it (`groupAmount` of the unsigned major
   string from `toAmountFields`):

```ts
const fixedDisplay = existing ? toAmountFields(currency, existing.amountMinorUnits) : null;
const fixedValue = fixedDisplay ? groupAmount(fixedDisplay.amount) : '';
// Expense source -> fixed side is Value Out, the user records a destination (To/Value In).
// Income destination -> fixed side is Value In, the user records a source (From/Value Out).
const convertLabels =
  convertDirection === 'record-source'
    ? {
        fixedLabel: t('forms.transaction.valueIn'),
        counterpartLabel: t('forms.transaction.from'),
        counterpartAmountLabel: t('forms.transaction.valueOut'),
      }
    : {
        fixedLabel: t('forms.transaction.valueOut'),
        counterpartLabel: t('forms.transaction.to'),
        counterpartAmountLabel: t('forms.transaction.valueIn'),
      };
```

6. The convert save. Extract into its own function to protect the component
   body's cognitive-complexity budget (the same pattern as `saveExchange`):

```ts
const saveConvert = async (): Promise<void> => {
  const counterpart = holdings.find((candidate) => candidate.id === counterpartHoldingId);

  if (existing === undefined || counterpart === undefined || convertDirection === null) {
    return;
  }

  const amountMajor = parseAmount(counterpartAmount);

  if (Number.isNaN(amountMajor) || amountMajor <= 0) {
    return;
  }

  const amount = Money.fromMajor(counterpart.currency, amountMajor);

  await transactionsRepo.recordExchangeCounterpart({
    direction: convertDirection,
    counterpartHoldingId: counterpart.id,
    counterpartType: counterpart.type,
    amountMinorUnits: amount.minorUnits,
    existingHoldingName: holding?.name ?? '',
    time,
  });

  navigation.goBack();
};
```

7. Branch `save` to `saveConvert` first (before the existing `isExchange` and
   synced-row branches):

```ts
if (converting) {
  await saveConvert();

  return;
}
```

8. Default the Date to the existing time when entering convert-mode. The screen
   already hydrates `time` from `existing.time` in the hydration effect, so
   `saveConvert` uses the current `time` state (the DateField may re-pick it).
   No extra wiring needed beyond the existing hydration.

- [ ] **Step 5 (developer): Render the action and the convert fields**

In the JSX, when `convertEligible && !converting`, render the action button
(place it in the body near the Delete button; it must show even on a read-only
synced row, so it is NOT gated by `!isReadOnly`):

```tsx
{convertEligible && !converting && (
  <Button variant="secondary" size="compact" fullWidth={false} onPress={() => setConverting(true)}>
    {t('forms.transaction.convertToExchange')}
  </Button>
)}
```

(Use whatever non-destructive secondary `Button` variant the design system
exposes — confirm the variant name against `design-system/components/button`;
`secondary`/`ghost` are the likely options. Do not invent a variant.)

When `converting`, render `ConvertExchangeFields` INSTEAD of the normal
income/expense/exchange field group and the mode `ChipRow` and the
`CategoryField` (a convert has no mode toggle and no category). The cleanest
structure is to make `converting` the outermost branch of the existing field
ternary:

```tsx
{converting ? (
  <ConvertExchangeFields
    fixedLabel={convertLabels.fixedLabel}
    fixedValue={fixedValue}
    counterpartLabel={convertLabels.counterpartLabel}
    counterpartPlaceholder={t('forms.transaction.selectHolding')}
    counterpartOptions={counterpartOptions}
    counterpartHoldingId={counterpartHoldingId}
    onSelectCounterpart={setCounterpartHoldingId}
    counterpartAmountLabel={convertLabels.counterpartAmountLabel}
    counterpartAmount={counterpartAmount}
    onChangeCounterpartAmount={(text) => setCounterpartAmount(groupAmount(text))}
    time={time}
    onChangeTime={setTime}
  />
) : isExchange ? (
  <ExchangeFields ... /> /* unchanged */
) : (
  <> ... income/expense fields unchanged ... </>
)}
```

Gate the mode `ChipRow`, the `CategoryField`, and the Delete button behind
`!converting` so convert-mode shows only the convert group and the Save footer.
Ensure the footer Save button renders while `converting` (it renders when
`!isReadOnly || categoryChanged` today; add `|| converting` so a synced-row
convert still shows Save):

```tsx
footer={
  !isReadOnly || categoryChanged || converting ? (
    <Button onPress={save}>{t('common.save')}</Button>
  ) : undefined
}
```

Guard against exceeding `noExcessiveCognitiveComplexity`: `saveConvert`,
`buildExchangeOptions`, `convertLabels`, and the module-level helpers are the
relief valves. If the component body still trips the cap, extract the
convert-labels/options derivation into a module-level pure helper taking
`(existing, holdings, accountNameById, holdingId, t)` and returning a single
`convertView` object.

- [ ] **Step 6 (qa): Run tests to verify they pass**

Run: `npx jest src/screens/forms/transaction-form.screen.test.tsx`
Expected: PASS (convert tests plus all create/income/expense/edit/synced tests).

- [ ] **Step 7 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green across lint, dup, knip, deps, security, secrets, overrides.
`check:knip` should now report nothing unused (every Task 4/5/6 export is
consumed). Watch `noExcessiveCognitiveComplexity` on the screen.

**Dependencies:** Tasks 2, 3, 4, 5, 6.

---

## Final verification

- [ ] **(ops): Full check**

Run: `npm run check:all`
Expected: green across lint, dup, knip, deps, security, secrets, overrides.

- [ ] **(qa): Full Jest run**

Run: `npx jest`
Expected: all suites pass.

- [ ] **(ops): Deep check before declaring done**

Run: `npm run check:deep`
Expected: mutation score at or above threshold (60); osv-scanner reports only the
known-accepted CVEs documented in the root `CLAUDE.md`. No new findings from this
rework.

- [ ] **(ops): Confirm no migration was added**

Run: `ls drizzle/migrations` and confirm the latest is still
`0012_add_language.sql` — this rework adds NO migration (per the spec).

---

## Self-Review

- **Requirement A (edit/convert):** convert-mode pure logic (Task 4);
  single-leg `recordExchangeCounterpart` that never touches the existing row and
  runs in one transaction (Task 5); `ConvertExchangeFields` single-counterpart
  form (Task 6); the "Convert to Exchange" action, direction-by-sign, both
  manual and synced, destination-vs-source picker restriction, non-positive
  amount rejection, and the "never update/remove the existing row" guarantee
  (Task 7). The leg-pairing "hard problem" is addressed by following the spec's
  no-link design (no migration) — see the "Edit-scope" section and Open
  Question 1.
- **Requirement B (cash-only create):** `isExchangeCreateSourceType` /
  `isExchangeCreateDestinationType` (Task 1), wired to gate create-mode's mode
  chip and destination options (Task 3); convert-mode deliberately keeps the
  wider `isExchangeSourceType` / `isExchangeDestinationType` (Tasks 4, 7).
- **Requirement C (account info in picker):** `accountName` on
  `HoldingSelectOption` rendered in the field + sheet rows (Task 2), threaded
  from an account-name map in the form for create AND both convert directions
  (Tasks 3, 7).
- **Placeholder scan:** the term_deposit repo test (Task 5, Step 1) and the
  disabled-`TextField` display assertion (Task 6, Step 3) carry explicit
  implementer notes rather than concrete fake wiring, because both depend on the
  existing test-file fake patterns and the real `TextField` behavior — flagged,
  not left as silent TODOs.
- **Type consistency:** `HoldingSelectOption.accountName` is added in Task 2 and
  supplied by `buildExchangeOptions` in Task 3 and consumed in Tasks 6/7;
  `ExchangeConvertDirection` is defined in Task 4 and used identically in Tasks 5
  and 7; `ExchangeCounterpartInput` field names match between Task 5's method and
  Task 7's call site; `ConvertExchangeFieldsProps` matches Task 6's component and
  Task 7's JSX.
- **No schema change / migration** — confirmed by the spec and re-verified in
  Final verification.

---

## Open questions for the user (flag before/at execution — do not guess)

1. **Edit-scope (Requirement A).** The device-review note says "EDIT support for
   exchanges," and the revised spec settles this as **convert-mode** (append the
   missing counterpart leg to an existing income/expense row; never modify the
   existing row; no leg-pairing id; no migration). This plan implements exactly
   that. If you actually want to **edit an already-created exchange as a unit**
   (change both legs' amounts/destination together), that is NOT in the current
   spec and WOULD require a new `exchangeGroupId` column on `transactions` plus
   migration `0013`, backfill logic for legs already written (which have no
   group id — they can only be paired heuristically by description text + time,
   which is lossy), and a two-leg edit UI. Confirm which you want. Default:
   convert-mode only, as planned.

2. **"Cash-only" definition (Requirement B).** The requirement says both sides
   "must be cash holdings," contrasted with the current source `cash`/`card`.
   This plan reads that literally as holding type `'cash'` only (so `card` is
   dropped from the create source, and `card`/`crypto_asset`/`term_deposit` are
   dropped from the create destination). If "cash" was meant loosely as
   "liquid = cash + card," say so and the create predicates become
   `cash`/`card`. Default: strict `'cash'`.
   - Sub-question: with strict cash-only create, a `crypto_asset` or
     `term_deposit` can no longer be an Exchange destination via CREATE-mode —
     only via CONVERT-mode (which keeps the wider rule). Confirm that is
     acceptable (it matches "edit keeps the wider eligibility").

3. **Account name placement (Requirement C).** This plan shows the parent
   account name both in each sheet row's caption (`<account> · <currency>`) and
   as a trailing caption on the collapsed field selection. Confirm that
   placement/format, or specify a different one (e.g. account name only in the
   sheet, or `<name> (<account>)` on one line).

4. **Ukrainian copy for the new keys.** `convertToExchange` and `from` need uk
   translations; this plan proposes `'Зробити обміном'` and `'Звідки'`. Confirm
   or correct.

5. **Convert action affordance.** This plan renders "Convert to Exchange" as a
   secondary compact button in the form body (visible even on a synced row).
   Confirm that is the desired placement/affordance (vs. a header action or a
   footer button), and confirm the exact `Button` variant name to use from the
   design system.
