# Forms + Bank Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework every form's Save button to the always-enabled, validate-on-press
model (replacing the disabled-Save model the `form-validation` track shipped),
and ship the Option A bank-type picker (all 6 banks, Monobank live-connect,
the other 5 import-only, no fake connect), scoped statement import, and two
account-detail UI fixes (a selector that never disappears, a footer that
never overflows).

**Architecture:** No new screens. Every touched form keeps its existing
`FieldError` component and its existing pure `isXValid`/`xReasonKey` helpers —
only the RENDER TRIGGER changes, from "always visible while invalid" to
"visible once Save has been pressed at least once while invalid, then live
while that attempt stands." A new `BankId` catalog (`src/bank-sync/bank-catalog/`)
is a sibling of the existing `BankProviderId` catalog
(`src/bank-sync/provider-catalog/`) — the provider catalog stays exactly
Monobank-only (real API connect); the new bank catalog lists all 6 banks and
maps each to its already-shipped `StatementFormatId`
(`src/statement-import/registry/`), so an account can be tagged with a bank
identity independent of whether it has a live sync connection. A new nullable
`accounts.bankId` column carries that tag; it is never read by any
`isSyncedAccount`/`isSyncedHolding`/registry code path (those stay keyed on
`institution`), so tagging an account `bankId: 'privatbank'` can never make it
look connected.

**Tech Stack:** React Native, TypeScript, Drizzle ORM (op-sqlite), `react-i18next`,
Jest + `@testing-library/react-native`, Biome, the Kiko harness (`make gate`,
`make verify`, `make deep`).

**Spec:** `/Users/drizzer14/.claude/projects/-Users-drizzer14-Developer-Projects-pff-ios/memory/refs/device-feedback-round-1.md`,
section "TRACK B — Forms + bank model" (items 1-6), the "Decision taken
(Option A)" section, and "5.6 guard for Track B". This plan's own
ground-truth citations (exact file:line) supersede the spec's own
descriptions of current behavior where the two differ — the spec was written
before this plan's grounding pass and the tree has moved under it (e.g. the
form-validation track already shipped the disabled-Save model this plan
reworks, and the bank catalog already carries `bankProviderIds = ['monobank']`
with the 5.6-remediated registry architecture this plan extends, never
resurrects).

## Global Constraints

- **Always-enabled Save, validate on press.** Every footer Save button is
  enabled whenever the screen is not mid-submit (`disabled={isSubmitting}`
  only — never `|| !canSave` / `|| disableSave` / `|| !isValid`). Pressing it
  runs the SAME validity check that used to gate the disabled state; if
  invalid, set a local `attempted`/`showXError` boolean true and RETURN
  before any write or confirmation-sheet open; if valid, proceed exactly as
  before (open the confirmation sheet where one exists — `transaction-form`'s
  category-override `BottomSheet` — else write and navigate back).
- **Reason visibility is `attempted && stillInvalid`, recomputed live.** Once
  a failed Save press sets the attempted flag, the reason line stays reactive
  to every further edit (hides the moment that specific condition clears) —
  there is no second flag to reset it back to hidden, and no reset on an
  unrelated field/mode change. This is a deliberate, uniform rule across all
  four forms — do not add a per-form reset.
- **`FieldError` stays unchanged.** Every task reuses the existing
  `src/design-system/components/field-error/` component verbatim — only the
  boolean expression gating whether it renders changes at each call site.
- **5.6 honesty.** No `SHOW_*`/`HIDE_*`/`ENABLE_*` `@env` flag anywhere in
  this plan. The 5 import-only banks are a plain, always-rendered array
  entry each (`src/bank-sync/bank-catalog/`) — never conditionally compiled
  or conditionally hidden. An import-only bank row NEVER renders a Connect
  affordance — only Monobank's row does, driven by `entry.connectable`, a
  plain data field on a fully-visible static catalog (not a build/runtime
  gate). `npm run check:security` (the `kiko-no-hidden-feature-flag-or-demo-import`
  Semgrep rule) must stay green at every checkpoint.
- **Single-editor discipline.** This track owns `account-form`,
  `account-detail` (including `bank-sync-section`), `holding-form`,
  `transaction-form`, `contribution-form`, `statement-import`, and every new
  file under `src/bank-sync/bank-catalog/` and
  `src/screens/forms/bank-type-field/`. Do not touch `src/data-transfer/` or
  any Settings export/import screen (Track A owns that).
- **i18n key placement.** `en.ts`/`uk.ts` stay in lockstep. `forms.account`,
  `forms.fields`, and `accountDetail` are alphabetically ordered blocks —
  insert new keys alphabetically. `statementImport` is NOT alphabetical (it
  is append-ordered by shipping phase) — append new keys at the end of that
  block, matching its own established convention. Never interleave with a
  parallel track's own additions.
- **Do not touch already-shipped sync internals.** `MonobankConnectField`,
  `WalletAddressField`, `BinanceCredentialsField`, `CryptoSyncForm`, the
  `ensureAccount`/`accountCreate` latch's CORE shape, `monobank/sync.ts`'s
  `markMonobankAccount`, and the Monobank sync pipeline stay untouched except
  for the one, explicitly-scoped edit each task below names.
- **TDD every task.** RED test fails for the right reason, then GREEN
  implementation makes it pass. `make gate` must be green at the end of every
  task. `npx tsc --noEmit` (part of `make gate`) is the mechanical backstop
  for the `AccountRow`-literal ripple in Task 2. `make deep` before the plan
  is done.
- **Code style.** Blank line before every `return`/`if`, arrow functions
  always parenthesized, imports hand-sorted by length ascending within their
  group (Biome does not check this — the reviewer does), `ts-pattern` for any
  new exhaustive mapping over a closed set (the `BankId` tuple).

---

## Task 1: `contribution-form` — always-enabled Save, reason shown only after a failed press

**Files:**
- Modify: `src/screens/forms/contribution-form/contribution-form.screen.tsx`
- Modify: `src/screens/forms/contribution-form/contribution-form.screen.test.tsx`

**Interfaces:**
- Consumes: `FieldError` (already imported in this file).
- Establishes the pattern (`attempted` boolean, reason gated on
  `attempted && stillInvalid`) every later task in this plan follows.

- [ ] **Step 1: Write the failing tests.** In
  `contribution-form.screen.test.tsx`, REPLACE the existing
  `'disables Save until a positive amount is entered'` (lines 203-218) and
  `'shows an inline reason once a non-positive amount is entered'` (lines
  220-233) tests with:

```tsx
it('keeps Save always enabled, regardless of the amount', async () => {
  const utils = await renderScreen();
  const isSaveDisabled = (): boolean | undefined =>
    utils.getByText('Save contribution').parent?.props.accessibilityState.disabled;

  expect(isSaveDisabled()).toBe(false);

  await fireEvent.changeText(utils.getByLabelText('Amount'), '0');
  expect(isSaveDisabled()).toBe(false);
});

it('shows the inline reason only after Save is pressed with an invalid amount, and does not append', async () => {
  const utils = await renderScreen();

  expect(utils.queryByText('Enter an amount greater than 0.')).toBeNull();

  await fireEvent.press(utils.getByText('Save contribution'));
  expect(utils.getByText('Enter an amount greater than 0.')).toBeTruthy();
  expect(holdingsRepo.appendDepositContribution).not.toHaveBeenCalled();

  await fireEvent.changeText(utils.getByLabelText('Amount'), '10');
  expect(utils.queryByText('Enter an amount greater than 0.')).toBeNull();
});
```

  Leave `'does not append when the amount is zero'` (194-201) and the two
  blank-amount tests above them unchanged — they already only assert on
  `appendDepositContribution`/`navigation.goBack`, not on `disabled`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/screens/forms/contribution-form --no-coverage`
Expected: FAIL — Save is currently disabled for a zero amount (first new
test), and the reason currently renders on every keystroke, not only after a
press (second new test's first assertion, "no reason yet", fails because
`amount.trim() !== ''` is not the gate).

- [ ] **Step 3: Write the minimal implementation.** In
  `contribution-form.screen.tsx`, add local state and gate the reason on it:

```tsx
const [attemptedSave, setAttemptedSave] = useState(false);
```

Change `save`:

```tsx
const save = async (): Promise<void> => {
  if (!holding) {
    return;
  }
  // parseAmount (accepting a comma decimal) yields NaN for a blank or junk
  // field, and `!(NaN > 0)` rejects it: require a strictly positive major
  // amount before persisting anything.
  const majorAmount = parseAmount(amount);
  if (!(majorAmount > 0)) {
    setAttemptedSave(true);
    return;
  }
  const amountMinorUnits = Money.fromMajor(currency, majorAmount).minorUnits;
  try {
    await holdingsRepo.appendDepositContribution(holding.id, { amountMinorUnits, date });
  } catch {
    // Keep the screen open on failure so the entered values are not lost.
    Alert.alert(t('forms.contribution.errorTitle'), t('forms.contribution.errorMessage'));
    return;
  }
  navigation.goBack();
};
```

Change the footer Button and the reason render condition:

```tsx
footer={
  <Button onPress={onSave} disabled={isSubmitting}>
    {t('forms.contribution.save')}
  </Button>
}
```

```tsx
{attemptedSave && !(parseAmount(amount) > 0) && (
  <FieldError message={t('forms.contribution.amountError')} />
)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/screens/forms/contribution-form --no-coverage`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/screens/forms/contribution-form
git commit -m "refactor(forms): always-enable contribution Save, validate on press"
```

- [ ] **Step 6 (kiko:reviewer): review.** Confirm the removed
  `!(parseAmount(amount) > 0)` disabled-gate leaves no other reader (grep the
  file), confirm blank-line-before-`if` style, run `make gate`.

## Task 2: `accounts.bankId` column + `BankId` bank catalog (foundation)

**Files:**
- Create: `src/bank-sync/bank-catalog/bank-catalog.ts`
- Create: `src/bank-sync/bank-catalog/bank-catalog.test.ts`
- Create: `src/bank-sync/bank-catalog/index.ts`
- Modify: `src/db/schema.ts` (`accounts` table — add `bankId` column)
- Create: `drizzle/migrations/00NN_add_account_bank_id.sql` (+ its
  `meta/NNNN_snapshot.json` + journal entry, generated — see Step 3)
- Modify: `src/accounts/accounts.repo.ts` (`NewAccount` type)
- Modify (add `bankId: null,` to the `AccountRow`-typed test factory —
  mechanical, verified by `npx tsc --noEmit`):
  `src/statistics/account-contribution/account-contribution.test.ts`,
  `src/crypto-sync/sync/sync.test.ts`,
  `src/holdings/entity-symbols/entity-symbols.test.ts`,
  `src/holdings/entity-colors/entity-colors.test.ts`,
  `src/screens/account-detail/crypto-sync-section/crypto-sync-section.component.test.tsx`,
  `src/screens/account-detail/bank-sync-section/bank-sync-section.component.test.tsx`,
  `src/monobank/sync/sync.test.ts`,
  `src/sync/use-sync-all/use-sync-all.test.ts`,
  `src/data-transfer/secrets/read-secrets.test.ts`

**Interfaces:**
- Produces: `bankIds` (`readonly ['monobank', 'privatbank', 'sensebank',
  'procredit', 'ukrsib', 'alfa']`), `type BankId`, `type BankCatalogEntry = {
  id: BankId; displayName: string; connectable: boolean; statementFormatId:
  StatementFormatId }`, `bankCatalog: readonly BankCatalogEntry[]`,
  `isBankId(value: string | null | undefined): value is BankId`,
  `statementFormatIdForBank(bankId: string | null | undefined):
  StatementFormatId | undefined` — every later task in this plan imports
  from `src/bank-sync/bank-catalog`.
- Produces: `accounts.bankId` column (`string | null`), consumed by Task 4
  (write), Task 9 (read).

- [ ] **Step 1: Write the failing test** — `bank-catalog.test.ts`:

```ts
import { bankCatalog, bankIds, isBankId, statementFormatIdForBank } from '.';

describe('bankCatalog', () => {
  it('lists exactly the six banks, Monobank first', () => {
    expect(bankCatalog.map((entry) => entry.id)).toEqual([
      'monobank',
      'privatbank',
      'sensebank',
      'procredit',
      'ukrsib',
      'alfa',
    ]);
    expect(bankIds).toEqual(bankCatalog.map((entry) => entry.id));
  });

  it('marks only Monobank connectable; every other entry is import-only', () => {
    const connectable = bankCatalog.filter((entry) => entry.connectable).map((entry) => entry.id);

    expect(connectable).toEqual(['monobank']);
  });

  it('maps every entry to its already-shipped statement format id', () => {
    const byId = Object.fromEntries(bankCatalog.map((entry) => [entry.id, entry.statementFormatId]));

    expect(byId).toEqual({
      monobank: 'monobank-csv',
      privatbank: 'privatbank-xlsx',
      sensebank: 'sensebank-csv',
      procredit: 'procredit-business-csv',
      ukrsib: 'ukrsib-business-csv',
      alfa: 'alfa-business-csv',
    });
  });

  it('isBankId guards a stored institution/bankId value', () => {
    expect(isBankId('monobank')).toBe(true);
    expect(isBankId('privatbank')).toBe(true);
    expect(isBankId('revolut')).toBe(false);
    expect(isBankId(null)).toBe(false);
    expect(isBankId(undefined)).toBe(false);
  });

  it('statementFormatIdForBank resolves a stored bankId to its format id, or undefined', () => {
    expect(statementFormatIdForBank('privatbank')).toBe('privatbank-xlsx');
    expect(statementFormatIdForBank(null)).toBeUndefined();
    expect(statementFormatIdForBank(undefined)).toBeUndefined();
    expect(statementFormatIdForBank('not-a-bank')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/bank-sync/bank-catalog --no-coverage`
Expected: FAIL — `Cannot find module '.' from 'bank-catalog.test.ts'`.

- [ ] **Step 3: Write the minimal implementation.**

`bank-catalog.ts`:

```ts
import type { StatementFormatId } from '../../statement-import/parser';

/**
 * The Option A "which bank is this account" catalog (device-feedback-round-1
 * item 3): all 6 banks Kiko can represent an account under, independent of
 * whether that bank has a LIVE sync connection. Sibling of, and deliberately
 * narrower-scoped than, `BankProviderId` (`../provider`) — that tuple stays
 * exactly `['monobank']` (the only bank with a real API connect, per the
 * Guideline 5.6 remediation); THIS tuple additionally covers the 5
 * statement-import-only banks the `statement-import` track already ships
 * parsers for. `connectable` is a plain, always-visible data field on a
 * fully-rendered static array — never a build/runtime visibility gate — so
 * every row always renders; only the AFFORDANCE differs (a real Connect
 * field for Monobank, an "import only" caption for the rest). Never wire a
 * `SHOW_*`/`HIDE_*`/`ENABLE_*` flag around any entry here (Guideline 5.6).
 */
export const bankIds = ['monobank', 'privatbank', 'sensebank', 'procredit', 'ukrsib', 'alfa'] as const;

export type BankId = (typeof bankIds)[number];

export type BankCatalogEntry = {
  id: BankId;
  /** The plain bank name shown in the account-form picker — distinct from
   * the matching `StatementFormat.displayName` (`../../statement-import/parser`),
   * which additionally names the file format (e.g. "PrivatBank (XLSX)"). */
  displayName: string;
  /** Whether this bank offers a LIVE API Connect (Monobank only, per the
   * `bankProviderIds` registry). An import-only bank (`false`) must never
   * render a Connect field — only its statement-import affordance. */
  connectable: boolean;
  /** The `statement-import` format this bank's account scopes import
   * recognition to (see `statementFormatIdForBank` below). */
  statementFormatId: StatementFormatId;
};

export const bankCatalog: readonly BankCatalogEntry[] = [
  { id: 'monobank', displayName: 'Monobank', connectable: true, statementFormatId: 'monobank-csv' },
  {
    id: 'privatbank',
    displayName: 'PrivatBank',
    connectable: false,
    statementFormatId: 'privatbank-xlsx',
  },
  {
    id: 'sensebank',
    displayName: 'Sensebank',
    connectable: false,
    statementFormatId: 'sensebank-csv',
  },
  {
    id: 'procredit',
    displayName: 'ProCredit Bank',
    connectable: false,
    statementFormatId: 'procredit-business-csv',
  },
  {
    id: 'ukrsib',
    displayName: 'UKRSIBBANK',
    connectable: false,
    statementFormatId: 'ukrsib-business-csv',
  },
  { id: 'alfa', displayName: 'Alfa-Bank', connectable: false, statementFormatId: 'alfa-business-csv' },
];

export const isBankId = (value: string | null | undefined): value is BankId =>
  value !== null && value !== undefined && (bankIds as readonly string[]).includes(value);

/** Resolves a stored `accounts.bankId` (or any other free-text candidate) to
 * the `StatementFormatId` its statement import should scope to — `undefined`
 * for an unset or unrecognized value (an older account created before this
 * feature, or a value from a since-removed bank), so the caller falls back
 * to the existing multi-format auto-detect rather than throwing. */
export const statementFormatIdForBank = (
  bankId: string | null | undefined,
): StatementFormatId | undefined =>
  isBankId(bankId) ? bankCatalog.find((entry) => entry.id === bankId)?.statementFormatId : undefined;
```

`index.ts`:

```ts
export * from './bank-catalog';
```

Now extend the schema. In `src/db/schema.ts`, add the column right after
`institution` on the `accounts` table:

```ts
  institution: text('institution'),
  // The bank this account REPRESENTS (device-feedback-round-1 item 3,
  // `src/bank-sync/bank-catalog/`), independent of `institution`
  // (which marks a LIVE sync connection). Set from the account-form's bank
  // picker at create time; import-only for 5 of the 6 catalog entries.
  // Deliberately NEVER read by `isSyncedAccount`/`isSyncedHolding`
  // (`src/holdings/deletable/`) or any registry lookup — those stay keyed
  // on `institution` alone, so tagging an account `bankId: 'privatbank'`
  // can never make it look connected. TS-only enum (no DB CHECK), matching
  // every other free-text catalog-id column in this table.
  bankId: text('bank_id'),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/bank-sync/bank-catalog --no-coverage`
Expected: PASS (5 tests).

- [ ] **Step 5: Generate the migration.**

Run: `npx drizzle-kit generate --name add_account_bank_id`

This writes `drizzle/migrations/00NN_add_account_bank_id.sql` (a single
`ALTER TABLE accounts ADD COLUMN bank_id text;`), its
`meta/NNNN_snapshot.json`, and a journal entry — and REWRITES
`drizzle/migrations/migrations.js` wholesale in its own formatting
(kiko-architecture: "Re-check that file after every generate"). Diff
`migrations.js` against its prior state; if drizzle-kit clobbered the
import/export layout or comma style, restore it by hand. Then run
`npx biome check --write drizzle/migrations/` (the generated `.sql`,
snapshot, and journal JSON are lint-checked like any other file).

- [ ] **Step 6: Add `bankId` to `NewAccount`.** In
  `src/accounts/accounts.repo.ts`:

```ts
type NewAccount = Pick<AccountRow, 'name' | 'kind'> &
  Partial<Pick<AccountRow, 'id' | 'institution' | 'bankId' | 'sortOrder' | 'color'>>;
```

No other change to `accounts.repo.ts` in this task — `create`'s
`tx.insert(accounts).values({ ...input, id: accountId, sortOrder })` already
forwards any `bankId` in `input` unchanged, and `update`'s
`Partial<AccountRow>` patch type already admits it.

- [ ] **Step 7: Run `npx tsc --noEmit` and fix every resulting error.**

Every `AccountRow`-typed test factory listed under **Files** above is now
missing the required `bankId` key. For each, add `bankId: null,` to its
default object literal (not to every call site — the factory's own defaults
plus each test's `overrides` cover the rest). Example
(`bank-sync-section.component.test.tsx`):

```ts
const bankAccount = (overrides: Partial<AccountRow> = {}): AccountRow => ({
  id: 'a',
  name: 'My Bank',
  kind: 'bank',
  institution: null,
  bankId: null,
  icon: null,
  color: null,
  sortOrder: 0,
  archivedAt: null,
  createdAt: 0,
  ...overrides,
});
```

Re-run `npx tsc --noEmit`; repeat for every file it still flags. This is the
mechanical, self-verifying completeness check for this ripple — do not trust
the file list above over the compiler.

- [ ] **Step 8: Run the full suite**

Run: `npx jest --no-coverage`
Expected: PASS (no existing test's behavior changed — `bankId: null` is a new
column with no reader yet outside Task 2's own test).

- [ ] **Step 9: Commit**

```bash
git add src/bank-sync/bank-catalog src/db/schema.ts drizzle/migrations \
  src/accounts/accounts.repo.ts src/statistics/account-contribution \
  src/crypto-sync/sync src/holdings/entity-symbols src/holdings/entity-colors \
  src/screens/account-detail/crypto-sync-section src/screens/account-detail/bank-sync-section \
  src/monobank/sync src/sync/use-sync-all src/data-transfer/secrets
git commit -m "feat(bank-sync): add the 6-bank BankId catalog and accounts.bankId column"
```

- [ ] **Step 10 (kiko:reviewer): review.** Confirm `bankId` has NO reader in
  `src/holdings/deletable/deletable.ts`, `src/bank-sync/registry/`, or
  `src/bank-sync/provider/` (grep `bankId` across `src/` — every hit should
  be this task's own files, plus Tasks 4/9 once they land). Confirm the
  migration is additive-only (`ALTER TABLE ... ADD COLUMN`, no backfill, no
  `NOT NULL`). Run `make gate`.

## Task 3: `account-form` — always-enabled Save, on-press name validation, remove the standing sync hint

**Files:**
- Modify: `src/screens/forms/account-form/account-form.screen.tsx`
- Modify: `src/screens/forms/account-form/account-form.screen.test.tsx`
- Modify: `src/i18n/locales/en.ts` (`forms.fields`, `forms.account` blocks)
- Modify: `src/i18n/locales/uk.ts` (same blocks)

**Interfaces:**
- Consumes: `FieldError` (not yet imported in this file — add it).
- Produces: `forms.fields.nameRequiredError` — Task 5 (holding-form) reuses
  this exact key verbatim; do not add a per-form duplicate.

- [ ] **Step 1: Write the failing tests.**

In `src/i18n/locales/en.ts`, inside `forms.fields`, add (alphabetically,
between `name` and `saveErrorMessage`):

```ts
      nameRequiredError: 'Enter a name.',
```

In `src/i18n/locales/uk.ts`, same position:

```ts
      nameRequiredError: 'Введіть назву.',
```

In `src/i18n/locales/en.ts`, REMOVE `nameRequiredForSync` from `forms.account`
(line 194). In `src/i18n/locales/uk.ts`, remove the matching line (179).

In `account-form.screen.test.tsx`, REPLACE the
`'shows an "enter a name first" hint on the bank form while the name is empty'`
test (lines 854-866) with:

```tsx
it('shows the name-required reason only after a Connect is attempted with an empty name, on the bank form', async () => {
  const view = await renderForm();

  expect(view.queryByTestId('account-name-error')).toBeNull();

  await fireEvent.press(view.getByLabelText('monobank-field'));

  expect(view.queryByTestId('account-name-error')).toBeTruthy();
  expect(mockCreate).not.toHaveBeenCalled();

  await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
  expect(view.queryByTestId('account-name-error')).toBeNull();
});
```

(This still presses `monobank-field` directly — Task 4 below adds the
bank-type picker step in front of it and edits this same test again.)

REPLACE the five crypto hint tests (lines 900-960: `'shows an "enter a name
first" hint on the crypto form...'`, `'does not create a crypto account when
a source Connect is tapped with an empty name'`, `'does not create a crypto
account when the Binance field Connect is tapped with an empty name'`,
`'treats a whitespace-only name exactly like an empty name on the crypto
form'`) with:

```tsx
it('shows the name-required reason only after a Connect is attempted with an empty name, on the crypto form', async () => {
  const { getByLabelText, getByText, queryByTestId } = await renderForm();

  await fireEvent.press(getByText('Crypto'));
  expect(queryByTestId('account-name-error')).toBeNull();

  await fireEvent.press(getByLabelText('wallet-field'));
  expect(queryByTestId('account-name-error')).toBeTruthy();

  await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
  expect(queryByTestId('account-name-error')).toBeNull();
});

it('does not create a crypto account when a source Connect is tapped with an empty name', async () => {
  const { getByLabelText, getByText, queryByTestId } = await renderForm();

  await fireEvent.press(getByText('Crypto'));
  await fireEvent.press(getByLabelText('wallet-field'));

  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockCryptoSync).not.toHaveBeenCalled();
  expect(getByText('Bank').parent?.props.accessibilityState.disabled).toBe(false);
  expect(queryByTestId('account-name-error')).toBeTruthy();
});

it('does not create a crypto account when the Binance field Connect is tapped with an empty name', async () => {
  const { getByLabelText, getByText, queryByTestId } = await renderForm();

  await fireEvent.press(getByText('Crypto'));
  await fireEvent.press(getByText('Binance'));
  await fireEvent.press(getByLabelText('binance-field'));

  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockCryptoSync).not.toHaveBeenCalled();
  expect(getByText('Bank').parent?.props.accessibilityState.disabled).toBe(false);
  expect(queryByTestId('account-name-error')).toBeTruthy();
});

it('treats a whitespace-only name exactly like an empty name on the crypto form', async () => {
  const { getByLabelText, getByText, queryByTestId } = await renderForm();

  await fireEvent.changeText(getByLabelText('Name'), '   ');
  await fireEvent.press(getByText('Crypto'));

  expect(getByLabelText('wallet-field')).toBeTruthy();
  expect(queryByTestId('account-name-error')).toBeNull();

  await fireEvent.press(getByLabelText('wallet-field'));

  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockCryptoSync).not.toHaveBeenCalled();
  expect(queryByTestId('account-name-error')).toBeTruthy();
});
```

Leave `'retries the crypto create after an empty-name reject...'` (962)
unchanged — it never referenced the hint testID.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/screens/forms/account-form --no-coverage`
Expected: FAIL — `account-name-error` does not exist yet (the old
`monobank-connect-name-hint`/`crypto-sync-name-hint` testIDs are gone from
the test file but still driven by the old code path), and the "no reason
before a press" assertions fail because the current hint shows immediately
based on `!canSave` alone.

- [ ] **Step 3: Write the minimal implementation.** In
  `account-form.screen.tsx`, add the `FieldError` import (design-system
  group, alongside the other `../../../design-system/components/*` imports):

```tsx
import FieldError from '../../../design-system/components/field-error';
```

Add state:

```tsx
const [showNameError, setShowNameError] = useState(false);
```

Change `ensureAccount`'s guard:

```tsx
  const ensureAccount = (): Promise<string> => {
    if (!canSave) {
      setShowNameError(true);
      return Promise.reject(new Error('name-required'));
    }
```

(the rest of `ensureAccount` is unchanged).

Change `save`'s opening guard:

```tsx
  const save = async (): Promise<void> => {
    if (!canSave) {
      setShowNameError(true);
      return;
    }

    try {
      // ...unchanged body...
```

Change the footer Button:

```tsx
      footer={
        <Button onPress={onSave} disabled={isSubmitting}>
          {t('common.save')}
        </Button>
      }
```

Render the reason right after `HoldingIdentityField`, before `ColorPicker`:

```tsx
        <HoldingIdentityField
          icons={KIKO_ENTITIES_ICONS}
          icon={icon}
          fallbackIcon={FALLBACK_ICON}
          iconColor={effectiveColor}
          name={name}
          onChangeName={setName}
          onSelectIcon={setIcon}
          onRemoveIcon={() => setIcon(null)}
          namePlaceholder={t('forms.account.namePlaceholder')}
          required
        />

        {showNameError && !canSave && (
          <FieldError message={t('forms.fields.nameRequiredError')} testID="account-name-error" />
        )}

        <ColorPicker label={t('forms.fields.color')} value={effectiveColor} onSelect={setColor} />
```

DELETE both `{!canSave && (<Box testID="monobank-connect-name-hint">...
</Box>)}` and `{!canSave && (<Box testID="crypto-sync-name-hint">...
</Box>)}` blocks (the bank and crypto sync sections' standing hints).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/screens/forms/account-form --no-coverage`
Expected: PASS (all tests in the file — this also proves the earlier
disabled-Save tests, e.g. `'creates a bank account without touching the
cash-account path'`, still pass, since they never asserted `disabled`).

- [ ] **Step 5: Commit**

```bash
git add src/screens/forms/account-form src/i18n/locales/en.ts src/i18n/locales/uk.ts
git commit -m "refactor(forms): always-enable account Save, validate name on press"
```

- [ ] **Step 6 (kiko:reviewer): review.** Confirm no remaining reference to
  `nameRequiredForSync`/`monobank-connect-name-hint`/`crypto-sync-name-hint`
  anywhere in `src/` (grep). Run `make gate`.

## Task 4: `account-form` — Option A bank-type picker (DESIGNER-OWNED: `BankTypeField`)

**Owner:** kiko:designer (new shared-vocabulary form component) for Steps
1-4; kiko:developer for the account-form wiring in Steps 5-8.

**Files:**
- Create: `src/screens/forms/bank-type-field/bank-type-field.props.d.ts`
- Create: `src/screens/forms/bank-type-field/bank-type-field.component.tsx`
- Create: `src/screens/forms/bank-type-field/bank-type-field.styles.ts`
- Create: `src/screens/forms/bank-type-field/bank-type-field.component.test.tsx`
- Create: `src/screens/forms/bank-type-field/index.ts`
- Modify: `src/screens/forms/account-form/account-form.screen.tsx`
- Modify: `src/screens/forms/account-form/account-form.screen.test.tsx`
- Modify: `src/i18n/locales/en.ts` (`forms.account` block)
- Modify: `src/i18n/locales/uk.ts` (`forms.account` block)

**Interfaces:**
- Consumes: `bankCatalog`, `type BankId` from `../../../bank-sync/bank-catalog`
  (Task 2); `FieldTrigger` (`../field-trigger`); `BottomSheet`
  (`../../../design-system/components/bottom-sheet`).
- Produces: `BankTypeField` (default export), props `{ label: string;
  selected: BankId | null; onSelect: (bankId: BankId) => void; testID?:
  string }`.

### Step 1-4 (designer): the `BankTypeField` component

- [ ] **Step 1: Write the failing tests** — `bank-type-field.component.test.tsx`:

```tsx
import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';

import BankTypeField from '.';

describe('BankTypeField', () => {
  it('shows the placeholder before anything is picked, and opens the sheet on press', async () => {
    const onSelect = jest.fn();
    const { getByLabelText, getByTestId } = await render(
      <BankTypeField label="Bank type" selected={null} onSelect={onSelect} testID="bank-type-field" />,
    );

    expect(getByLabelText('Bank type')).toBeTruthy();
    expect(getByTestId('bank-type-field')).toHaveTextContent('Select a bank (optional)');

    await fireEvent.press(getByTestId('bank-type-field'));

    expect(getByTestId('bank-type-sheet')).toBeTruthy();
  });

  it('lists all six banks, Monobank connectable and the rest import-only', async () => {
    const onSelect = jest.fn();
    const { getByTestId, getByText } = await render(
      <BankTypeField label="Bank type" selected={null} onSelect={onSelect} testID="bank-type-field" />,
    );

    await fireEvent.press(getByTestId('bank-type-field'));

    expect(getByTestId('bank-type-option-monobank')).toBeTruthy();
    expect(getByTestId('bank-type-option-privatbank')).toBeTruthy();
    expect(getByTestId('bank-type-option-sensebank')).toBeTruthy();
    expect(getByTestId('bank-type-option-procredit')).toBeTruthy();
    expect(getByTestId('bank-type-option-ukrsib')).toBeTruthy();
    expect(getByTestId('bank-type-option-alfa')).toBeTruthy();
    expect(getByText('Connect and import statements.')).toBeTruthy();
    expect(getByText('Statement import only — no live connection.')).toBeTruthy();
  });

  it('reports the picked bank id when a row is pressed', async () => {
    const onSelect = jest.fn();
    const { getByTestId } = await render(
      <BankTypeField label="Bank type" selected={null} onSelect={onSelect} testID="bank-type-field" />,
    );

    await fireEvent.press(getByTestId('bank-type-field'));
    await fireEvent.press(getByTestId('bank-type-option-privatbank'));

    expect(onSelect).toHaveBeenCalledWith('privatbank');
  });

  it('shows the selected bank name as the trigger value', async () => {
    const onSelect = jest.fn();
    const { getByTestId } = await render(
      <BankTypeField
        label="Bank type"
        selected="monobank"
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    expect(getByTestId('bank-type-field')).toHaveTextContent('Monobank');
  });
});
```

Add the two new i18n keys these tests need. In `src/i18n/locales/en.ts`,
inside `forms.account` (alphabetically):

```ts
      bankConnectable: 'Connect and import statements.',
      bankImportOnly: 'Statement import only — no live connection.',
      bankType: 'Bank type',
```

between `bank` and `cash`, and:

```ts
      importOnlyBankHint: 'You can import a statement for this bank after saving.',
```

between `editTitle` and `initialValue`, and:

```ts
      selectBankPlaceholder: 'Select a bank (optional)',
```

as the new last key (after `namePlaceholder`). In `src/i18n/locales/uk.ts`,
the same positions:

```ts
      bankConnectable: 'Підключення та імпорт виписок.',
      bankImportOnly: 'Лише імпорт виписки — без підключення.',
      bankType: 'Тип банку',
```

```ts
      importOnlyBankHint: 'Виписку цього банку можна імпортувати після збереження.',
```

```ts
      selectBankPlaceholder: 'Оберіть банк (необов’язково)',
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/forms/bank-type-field --no-coverage`
Expected: FAIL — `Cannot find module '.' from 'bank-type-field.component.test.tsx'`.

- [ ] **Step 3: Write the minimal implementation.**

`bank-type-field.props.d.ts`:

```ts
import type { BankId } from '../../../bank-sync/bank-catalog';

export type BankTypeFieldProps = {
  label: string;
  // null = nothing picked yet — the field is OPTIONAL (a plain manual bank
  // account with no specific bank identity is valid); the caller never
  // passes `required`.
  selected: BankId | null;
  onSelect: (bankId: BankId) => void;
  testID?: string;
};
```

`bank-type-field.styles.ts` (mirrors `add-bank-sheet.styles.ts`'s `option`
style — the two sheets share the same row chrome by design):

```ts
import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  option: {
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
}));
```

`bank-type-field.component.tsx`:

```tsx
import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { type FC, useState } from 'react';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import BottomSheet from '../../../design-system/components/bottom-sheet';
import { bankCatalog, type BankId } from '../../../bank-sync/bank-catalog';

import FieldTrigger from '../field-trigger';

import { styles } from './bank-type-field.styles';
import type { BankTypeFieldProps } from './bank-type-field.props';

// The Option A "which bank is this account" picker (device-feedback-round-1
// item 3): a labeled trigger (FieldTrigger, the same family CurrencyField
// and CategoryField use) that opens a BottomSheet listing every
// `bankCatalog` entry — ALWAYS all six, never conditionally hidden
// (Guideline 5.6). Selecting a row reports the id and closes the sheet; the
// trigger stays visible and re-openable afterward (no vanish-after-select —
// see the account-detail BankSyncSection fix this plan also ships for the
// SAME class of bug there).
const BankTypeField: FC<BankTypeFieldProps> = ({ label, selected, onSelect, testID }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const selectedEntry = selected === null ? undefined : bankCatalog.find((entry) => entry.id === selected);

  const handleSelect = (bankId: BankId): void => {
    onSelect(bankId);
    setOpen(false);
  };

  return (
    <Box gap={1}>
      <FieldTrigger
        label={label}
        onPress={() => setOpen(true)}
        value={selectedEntry?.displayName ?? t('forms.account.selectBankPlaceholder')}
        valueTone={selectedEntry === undefined ? 'textSecondary' : 'textPrimary'}
        testID={testID}
      />

      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        header={<Text variant="heading">{label}</Text>}
        testID="bank-type-sheet"
      >
        {bankCatalog.map((entry) => {
          const caption = entry.connectable
            ? t('forms.account.bankConnectable')
            : t('forms.account.bankImportOnly');

          return (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              accessibilityLabel={`${entry.displayName}. ${caption}`}
              onPress={() => handleSelect(entry.id)}
              style={styles.option}
              testID={`bank-type-option-${entry.id}`}
            >
              <Box gap={1}>
                <Text variant="body" tone="textPrimary">
                  {entry.displayName}
                </Text>
                <Text variant="caption" tone="textSecondary">
                  {caption}
                </Text>
              </Box>
            </Pressable>
          );
        })}
      </BottomSheet>
    </Box>
  );
};

export default BankTypeField;
```

`index.ts`:

```ts
export { default } from './bank-type-field.component';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/forms/bank-type-field --no-coverage`
Expected: PASS (4 tests).

### Step 5-8 (developer): wire `BankTypeField` into `account-form`

- [ ] **Step 5: Write the failing tests.** In `account-form.screen.test.tsx`:

Insert `await fireEvent.press(view.getByLabelText('Bank type'));` +
`await fireEvent.press(view.getByTestId('bank-type-option-monobank'));`
right before EVERY existing `await fireEvent.press(view.getByLabelText('monobank-field'));`
line in the `'AccountFormScreen — sync credentials on create'` describe
block — that is, in these six tests: `'connect creates the bank row once,
saves the token to the Keychain, and syncs it'`, `'resolves connectMonobank
to false when the sync itself fails (no thrown error)'`, `'does not save a
token or sync when the bank row create rejects'`, `'does not sync when
saving the token to the Keychain fails'`, `'connect then Save updates the
same row — never a duplicate account'`, `'connecting a bank source locks the
kind switch'`. Also insert the same two lines into the
`'shows the name-required reason only after a Connect is attempted with an
empty name, on the bank form'` test (from Task 3) right before its
`monobank-field` press. Example (the first test):

```tsx
it('connect creates the bank row once, saves the token to the Keychain, and syncs it', async () => {
  mockMonobankSync.mockResolvedValue(true);
  const view = await renderForm();

  await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
  await fireEvent.press(view.getByLabelText('Bank type'));
  await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
  await fireEvent.press(view.getByLabelText('monobank-field'));

  await waitFor(() => expect(mockMonobankSync).toHaveBeenCalled());
  // ...rest of the test body unchanged...
});
```

`'Save with no connect creates the bank row and stores no token'` stays
UNCHANGED — it proves the picker is OPTIONAL (no bank selected, Save still
creates a plain bank account).

Add four new tests to the same describe block:

```tsx
it('does not auto-select any bank on a fresh bank create (no auto-jump to Monobank)', async () => {
  const view = await renderForm();

  await fireEvent.press(view.getByText('Bank'));

  expect(view.getByText('Select a bank (optional)')).toBeTruthy();
  expect(view.queryByLabelText('monobank-field')).toBeNull();
});

it('lists all six banks in the picker sheet', async () => {
  const view = await renderForm();

  await fireEvent.press(view.getByLabelText('Bank type'));

  expect(view.getByTestId('bank-type-option-monobank')).toBeTruthy();
  expect(view.getByTestId('bank-type-option-privatbank')).toBeTruthy();
  expect(view.getByTestId('bank-type-option-sensebank')).toBeTruthy();
  expect(view.getByTestId('bank-type-option-procredit')).toBeTruthy();
  expect(view.getByTestId('bank-type-option-ukrsib')).toBeTruthy();
  expect(view.getByTestId('bank-type-option-alfa')).toBeTruthy();
});

it('creates the bank row tagged with the selected bank id when connecting Monobank', async () => {
  const view = await renderForm();

  await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
  await fireEvent.press(view.getByLabelText('Bank type'));
  await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
  await fireEvent.press(view.getByLabelText('monobank-field'));

  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ bankId: 'monobank' }));
});

it('shows no fake connect field for an import-only bank, and creates the row tagged with its bank id on Save', async () => {
  const view = await renderForm();

  await fireEvent.changeText(view.getByLabelText('Name'), 'My PrivatBank');
  await fireEvent.press(view.getByLabelText('Bank type'));
  await fireEvent.press(view.getByTestId('bank-type-option-privatbank'));

  expect(view.queryByLabelText('monobank-field')).toBeNull();
  expect(view.getByText('PrivatBank')).toBeTruthy();

  await fireEvent.press(view.getByText('Save'));

  await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalled());
  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'My PrivatBank', kind: 'bank', bankId: 'privatbank' }),
  );
  expect(mockSaveToken).not.toHaveBeenCalled();
  expect(mockMonobankSync).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx jest src/screens/forms/account-form --no-coverage`
Expected: FAIL — `getByLabelText('Bank type')` / `bank-type-option-*` do not
exist yet; `MonobankConnectField` still renders unconditionally.

- [ ] **Step 7: Write the minimal implementation.** In
  `account-form.screen.tsx`, add imports:

```tsx
import BankTypeField from '../bank-type-field';
import type { BankId } from '../../../bank-sync/bank-catalog';
```

Add state, right after the `color` state:

```tsx
const [bankId, setBankId] = useState<BankId | null>(null);
```

Reset it in `handleSelectKind`:

```tsx
  const handleSelectKind = (nextKind: Kind): void => {
    setKind(nextKind);
    setIcon(accountKindSymbol[nextKind]);
    setBankId(null);
  };
```

Thread it through `ensureAccount`'s create call:

```tsx
    accountCreate.current ??= (async () => {
      await accountsRepo.create({
        id: pendingAccountId,
        name: trimmedName,
        kind,
        color,
        bankId,
      });
```

Thread it through `save`'s "connect already created the row" branch:

```tsx
      if (accountCreate.current !== null) {
        await accountsRepo.update(pendingAccountId, { name: trimmedName, color, bankId });
        await accountsRepo.setIcon(pendingAccountId, icon);
      } else {
        await ensureAccount();
      }
```

Replace the bank sync section's body (the `!isEdit && kind === 'bank'`
block):

```tsx
        {!isEdit && kind === 'bank' && (
          <Box gap={4}>
            <Divider testID="form-divider" />

            <Text variant="heading">{t('accountDetail.synchronization')}</Text>

            <BankTypeField
              label={t('forms.account.bankType')}
              selected={bankId}
              onSelect={setBankId}
              testID="account-bank-type-field"
            />

            {bankId === 'monobank' && <MonobankConnectField onConnect={connectMonobank} />}

            {bankId !== null && bankId !== 'monobank' && (
              <Text variant="caption" tone="textSecondary">
                {t('forms.account.importOnlyBankHint')}
              </Text>
            )}
          </Box>
        )}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx jest src/screens/forms/account-form --no-coverage`
Expected: PASS (every test in the file, including the crypto describe block,
which this task does not touch).

- [ ] **Step 9: Commit**

```bash
git add src/screens/forms/bank-type-field src/screens/forms/account-form \
  src/i18n/locales/en.ts src/i18n/locales/uk.ts
git commit -m "feat(forms): Option A bank-type picker on the account create form"
```

- [ ] **Step 10 (kiko:reviewer): review.** Confirm the sheet's `divider` count
  test (`'separates the color picker and the synchronization sub-heading
  with form dividers'`) still passes unaffected (no new `Divider` added).
  Confirm NO `SHOW_*`/`HIDE_*`/`ENABLE_*` `@env` import anywhere in the new
  files (grep `from '@env'`). Confirm every import-only bank's row genuinely
  renders no connect affordance (read the JSX, not just the test). Run
  `make gate`, `npm run check:security`, `npm run check:rules`.

## Task 5: `holding-form` — always-enabled Save, reasons shown only after a failed press

**Files:**
- Modify: `src/screens/forms/holding-form/holding-form.screen.tsx`
- Modify: `src/screens/forms/holding-form/holding-form.screen.test.tsx`

**Interfaces:**
- Consumes: `FieldError` (already imported); `forms.fields.nameRequiredError`
  (Task 3).

- [ ] **Step 1: Write the failing tests.** REPLACE the entire
  `describe('HoldingFormScreen save validation', ...)` block (lines 457-622)
  with:

```tsx
describe('HoldingFormScreen save validation', () => {
  beforeEach(() => {
    createMock.mockClear();
    setIconMock.mockClear();
    navigation.goBack.mockClear();
  });

  it('keeps Save always enabled for a term deposit missing its contribution, rate, and term', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));
    await fill(screen, 'Name', 'My deposit');

    expect(screen.getByText('Save')).not.toBeDisabled();
  });

  it('does not create and shows no reason before Save is pressed, for an incomplete term deposit', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));
    await fill(screen, 'Name', 'My deposit');

    expect(
      screen.queryByText('Add at least one contribution with an amount and a date.'),
    ).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('shows an inline reason for a term deposit missing its contribution, rate, and term, only after Save is pressed', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));
    await fill(screen, 'Name', 'My deposit');
    await fireEvent.press(screen.getByText('Save'));

    expect(
      screen.getByText('Add at least one contribution with an amount and a date.'),
    ).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('shows the rate reason once a contribution is set but the rate is missing, after a failed Save', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 Amount', '1000');
    await pickDate(screen, 'Contribution 1 Date', 2026, 1, 1);
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a rate of 0 or higher.')).toBeTruthy();
  });

  it('shows the term reason once the rate is set but the term is missing, after a failed Save', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 Amount', '1000');
    await pickDate(screen, 'Contribution 1 Date', 2026, 1, 1);
    await fill(screen, 'Annual Rate %', '12');
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a whole number of months greater than 0.')).toBeTruthy();
  });

  it('clears the term-deposit reason once every field becomes valid, without a second Save press', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));
    await fill(screen, 'Name', 'My deposit');
    await fireEvent.press(screen.getByText('Save'));
    expect(
      screen.getByText('Add at least one contribution with an amount and a date.'),
    ).toBeTruthy();

    await fill(screen, 'Contribution 1 Amount', '1000');
    await pickDate(screen, 'Contribution 1 Date', 2026, 1, 1);
    await fill(screen, 'Annual Rate %', '12');
    await fill(screen, 'Term (Months)', '12');

    expect(
      screen.queryByText('Add at least one contribution with an amount and a date.'),
    ).toBeNull();
    expect(screen.queryByText('Enter a rate of 0 or higher.')).toBeNull();
    expect(screen.queryByText('Enter a whole number of months greater than 0.')).toBeNull();
  });

  it('keeps Save always enabled for a bond missing its numeric fields and dates', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Bond'));
    await fill(screen, 'Name', 'My bond');

    expect(screen.getByText('Save')).not.toBeDisabled();
  });

  it('does not create a bond whose maturity is not after its purchase date, and shows the reason after Save', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Bond'));
    await fill(screen, 'Name', 'My bond');
    await fill(screen, 'Quantity', '10');
    await fill(screen, 'Face Value', '1000');
    await fill(screen, 'Coupon %', '9');
    await pickDate(screen, 'Purchase Date', 2026, 1, 1);
    await pickDate(screen, 'Maturity Date', 2026, 1, 1);
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Maturity date must be after the purchase date.')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('creates a bond once every field and date is valid', async () => {
    const screen = await renderScreen();

    await fillBondFields(screen);
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
  });

  it('shows the quantity reason for a bond missing its numeric fields, only after Save is pressed', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Bond'));
    await fill(screen, 'Name', 'My bond');

    expect(screen.queryByText('Enter a quantity greater than 0.')).toBeNull();

    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a quantity greater than 0.')).toBeTruthy();
  });

  it('shows the face-value reason once quantity is set but face value is missing, after a failed Save', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Bond'));
    await fill(screen, 'Name', 'My bond');
    await fill(screen, 'Quantity', '10');
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a face value greater than 0.')).toBeTruthy();
  });

  it('shows no bond reason once every field and date is valid', async () => {
    const screen = await renderScreen();

    await fillBondFields(screen);
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.queryByText('Enter a quantity greater than 0.')).toBeNull();
    expect(screen.queryByText('Enter a face value greater than 0.')).toBeNull();
    expect(screen.queryByText('Enter a coupon of 0 or higher.')).toBeNull();
    expect(screen.queryByText('Maturity date must be after the purchase date.')).toBeNull();
  });

  it('keeps Save always enabled when the holding name is blank, and pressing it neither creates nor navigates', async () => {
    const { getByText } = await renderScreen();

    expect(getByText('Save')).not.toBeDisabled();

    await fireEvent.press(getByText('Save'));

    expect(createMock).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('shows the name-required reason only after a failed Save, for a blank holding name', async () => {
    const { getByText, queryByTestId } = await renderScreen();

    expect(queryByTestId('holding-name-error')).toBeNull();

    await fireEvent.press(getByText('Save'));

    expect(queryByTestId('holding-name-error')).toBeTruthy();
  });

  it('surfaces an alert and does not navigate when the create fails', async () => {
    createMock.mockRejectedValueOnce(new Error('boom'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const screen = await renderScreen();
    await fillTermDepositFields(screen);
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.'),
    );
    expect(navigation.goBack).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/screens/forms/holding-form/holding-form.screen.test.tsx --no-coverage`
Expected: FAIL — Save is currently disabled (not "not disabled") in every
`enabled`-flavored assertion above, and every reason currently renders
without a press.

- [ ] **Step 3: Write the minimal implementation.** In
  `holding-form.screen.tsx`, add state:

```tsx
const [attemptedSave, setAttemptedSave] = useState(false);
```

Gate the two existing reasons on it, and add a name reason:

```tsx
  const termDepositReason = attemptedSave && type === 'term_deposit' ? termDepositReasonKey() : null;
  const bondReason = attemptedSave && type === 'bond' ? bondReasonKey() : null;
  const showNameReason = attemptedSave && name.trim().length === 0;
```

Change `save`, removing the now-redundant `metadata === undefined` guard
(fully covered by `isValid`'s `isTermDepositValid` branch — see the RED
review checklist below):

```tsx
  const save = async (): Promise<void> => {
    if (!isValid) {
      setAttemptedSave(true);
      return;
    }

    const metadata = buildMetadata();

    try {
      // ...unchanged body (isEdit branch, then the create branch)...
```

Change the footer Button:

```tsx
      footer={
        <Button onPress={onSave} disabled={isSubmitting}>
          {t('common.save')}
        </Button>
      }
```

Render the name reason right after `HoldingIdentityField`:

```tsx
        <HoldingIdentityField
          icons={KIKO_ENTITIES_ICONS}
          icon={icon}
          fallbackIcon={holdingTypeSymbol[type]}
          iconColor={effectiveColor}
          name={name}
          onChangeName={setName}
          onSelectIcon={setIcon}
          onRemoveIcon={() => setIcon(null)}
          namePlaceholder={t('forms.holding.namePlaceholder')}
          required
        />

        {showNameReason && (
          <FieldError message={t('forms.fields.nameRequiredError')} testID="holding-name-error" />
        )}

        <ColorPicker label={t('forms.fields.color')} value={effectiveColor} onSelect={setColor} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/screens/forms/holding-form --no-coverage`
Expected: PASS (all three holding-form test files — confirm the `'holding
form'`, `'icon'`, `'color follows type'`, `'type chips'`, and `'edit mode'`
describe blocks earlier in the file are all unaffected, since none of them
assert `disabled` or reason text).

- [ ] **Step 5: Commit**

```bash
git add src/screens/forms/holding-form
git commit -m "refactor(forms): always-enable holding Save, validate on press"
```

- [ ] **Step 6 (kiko:reviewer): review.** Confirm `termDepositReasonKey`'s
  and `bondReasonKey`'s branch order still exactly mirrors
  `isTermDepositValid`/`isBondValid` (unchanged by this task — verify no
  incidental drift). Confirm removing the `metadata === undefined` guard is
  safe (isValid's `match(type).with('term_deposit', isTermDepositValid)`
  already refuses to reach `save`'s try block when contributions are empty).
  Run `make gate`.

## Task 6: `transaction-form` — always-enabled Save, reason shown only after a failed press

**Files:**
- Modify: `src/screens/forms/transaction-form/transaction-form.screen.tsx`
- Modify: `src/screens/forms/transaction-form/transaction-form.screen.test.tsx`

**Interfaces:**
- Consumes: `FieldError` (already imported); the existing `isSaveDisabled`/
  `saveDisabledReason`/`SaveDisabledParams` (unchanged).

- [ ] **Step 1: Write the failing tests.** Apply these replacements (exact
  original text cited by its current test name, so a reviewer can diff):

REPLACE `'disables Save for a zero amount'` (line 489) and `'shows an inline
reason for a fresh add missing amount and category'` (line 497) with:

```tsx
it('does not save for a zero amount, keeping Save enabled and showing the reason after a press', async () => {
  const utils = await renderAdd();
  const { getByLabelText, getByText } = utils;
  await fireEvent.changeText(getByLabelText('Amount'), '0');
  await pickCategory(utils, 'Groceries');

  expect(getByText('Save').parent?.props.accessibilityState.disabled).toBe(false);

  await fireEvent.press(getByText('Save'));

  expect(mockRecordManual).not.toHaveBeenCalled();
  expect(getByText('Enter an amount greater than 0.')).toBeTruthy();
});

it('shows an inline reason for a fresh add missing amount and category, only after Save is pressed', async () => {
  const utils = await renderAdd();

  expect(utils.queryByText('Enter an amount greater than 0.')).toBeNull();

  await fireEvent.press(utils.getByText('Save'));
  expect(utils.getByText('Enter an amount greater than 0.')).toBeTruthy();

  await fireEvent.changeText(utils.getByLabelText('Amount'), '12.34');
  expect(utils.queryByText('Enter an amount greater than 0.')).toBeNull();
  expect(utils.getByText('Select a category.')).toBeTruthy();

  await pickCategory(utils, 'Groceries');
  expect(utils.queryByText('Select a category.')).toBeNull();
});
```

REPLACE `'re-nulls the auto-pick and re-disables Save when the name settles
to a non-match'` (line 632) with:

```tsx
it('re-nulls the auto-pick so the category reason reappears when the name settles to a non-match', async () => {
  const utils = await renderAdd();
  const { getByLabelText, getByText, queryByText } = utils;
  await fireEvent.changeText(getByLabelText('Amount'), '12.34');
  await fireEvent.changeText(getByLabelText('Description'), 'Coffee');
  await fireEvent(getByLabelText('Description'), 'blur');
  await fireEvent.press(getByText('Save'));
  // The auto-pick supplied a category, so this first press actually wrote —
  // no reason for it.
  expect(queryByText('Select a category.')).toBeNull();

  // A name matching no rule clears the auto-pick, so a SECOND attempted Save
  // is blocked again and shows the category reason.
  await fireEvent.changeText(getByLabelText('Description'), 'Unmatched name');
  await fireEvent(getByLabelText('Description'), 'blur');
  await fireEvent.press(getByText('Save'));

  expect(getByText('Select a category.')).toBeTruthy();
});
```

REPLACE `'disables Save when the amount is cleared on an edit'` (line 1112)
with:

```tsx
it('keeps Save enabled but blocks the write and shows the reason when the amount is cleared on an edit', async () => {
  const utils = await renderEdit('txn-1');
  const isSaveDisabled = (): boolean | undefined =>
    utils.getByText('Save').parent?.props.accessibilityState.disabled;

  expect(isSaveDisabled()).toBe(false);

  await fireEvent.changeText(utils.getByLabelText('Amount'), '');
  expect(isSaveDisabled()).toBe(false);

  await fireEvent.press(utils.getByText('Save'));

  expect(mockUpdate).not.toHaveBeenCalled();
  expect(utils.getByText('Enter an amount greater than 0.')).toBeTruthy();
});
```

REPLACE `'disables Save until a destination and both positive amounts are
set'` (line 1749) and `'shows an inline reason through the Exchange steps'`
(line 1772) with:

```tsx
it('keeps Save enabled through the Exchange steps but blocks the write until valid', async () => {
  const utils = await renderAddFromHolding('cash-1');
  await pickType(utils, 'exchange');

  const isSaveDisabled = (): boolean | undefined =>
    utils.getByText('Save').parent?.props.accessibilityState.disabled;

  expect(isSaveDisabled()).toBe(false);
  await fireEvent.press(utils.getByText('Save'));
  expect(mockRecordExchange).not.toHaveBeenCalled();

  await fireEvent.changeText(utils.getByLabelText('Value Out'), '100');
  await fireEvent.press(utils.getByText('Save'));
  expect(mockRecordExchange).not.toHaveBeenCalled();

  await fireEvent.press(utils.getByLabelText('To'));
  await fireEvent.press(utils.getByText('Cash USD'));
  await fireEvent.press(utils.getByText('Save'));
  expect(mockRecordExchange).not.toHaveBeenCalled();

  await fireEvent.changeText(utils.getByLabelText('Value In'), '2.5');
  await fireEvent.press(utils.getByText('Save'));
  expect(mockRecordExchange).toHaveBeenCalledTimes(1);
});

it('shows an inline reason through the Exchange steps, only after Save is pressed', async () => {
  const utils = await renderAddFromHolding('cash-1');
  await pickType(utils, 'exchange');

  expect(utils.queryByText('Select a destination account.')).toBeNull();
  await fireEvent.press(utils.getByText('Save'));
  expect(utils.getByText('Select a destination account.')).toBeTruthy();

  await fireEvent.press(utils.getByLabelText('To'));
  await fireEvent.press(utils.getByText('Cash USD'));
  expect(utils.getByText('Enter a Value Out greater than 0.')).toBeTruthy();

  await fireEvent.changeText(utils.getByLabelText('Value Out'), '100');
  expect(utils.getByText('Enter a Value In greater than 0.')).toBeTruthy();

  await fireEvent.changeText(utils.getByLabelText('Value In'), '2.5');
  expect(utils.queryByText('Enter a Value In greater than 0.')).toBeNull();
});
```

REPLACE `'disables Save until a counterpart holding and a positive amount are
set'` (line 2244) and `'shows an inline reason through the Convert steps'`
(line 2264) with:

```tsx
it('keeps Save enabled through the Convert steps but blocks the write until valid', async () => {
  const utils = await renderEdit('expense-manual');
  await fireEvent.press(utils.getByText('Convert to exchange'));

  const isSaveDisabled = (): boolean | undefined =>
    utils.getByText('Save').parent?.props.accessibilityState.disabled;

  expect(isSaveDisabled()).toBe(false);
  await fireEvent.press(utils.getByText('Save'));
  expect(mockRecordExchangeCounterpart).not.toHaveBeenCalled();

  await fireEvent.press(utils.getByLabelText('To'));
  await fireEvent.press(utils.getByText('Cash USD'));
  await fireEvent.press(utils.getByText('Save'));
  expect(mockRecordExchangeCounterpart).not.toHaveBeenCalled();

  await fireEvent.changeText(utils.getByLabelText('Value In'), '2.5');
  await fireEvent.press(utils.getByText('Save'));
  expect(mockRecordExchangeCounterpart).toHaveBeenCalledTimes(1);
});

it('shows an inline reason through the Convert steps, only after Save is pressed', async () => {
  const utils = await renderEdit('expense-manual');
  await fireEvent.press(utils.getByText('Convert to exchange'));

  expect(utils.queryByText('Select an account to convert into.')).toBeNull();
  await fireEvent.press(utils.getByText('Save'));
  expect(utils.getByText('Select an account to convert into.')).toBeTruthy();

  await fireEvent.press(utils.getByLabelText('To'));
  await fireEvent.press(utils.getByText('Cash USD'));
  expect(utils.getByText('Enter an amount greater than 0.')).toBeTruthy();

  await fireEvent.changeText(utils.getByLabelText('Value In'), '2.5');
  expect(utils.queryByText('Enter an amount greater than 0.')).toBeNull();
});
```

REPLACE `'disables Save while the returns sum to at least the payment'`
(line 2392), `'shows an inline reason for an incomplete split'` (line 2415),
and `'keeps Save disabled for an otherwise-valid split until a category is
picked'` (line 2425) with:

```tsx
it('does not write while the returns sum to at least the payment, and Save stays enabled', async () => {
  const utils = await renderAddFromHolding('payer');

  await pickType(utils, 'split');
  await fireEvent.press(utils.getByLabelText('Return to 1'));
  await fireEvent.press(utils.getByText('Alice'));
  await fireEvent.changeText(utils.getByLabelText('Return 1'), '0.20');
  await pickCategory(utils, 'Groceries');
  await fireEvent.changeText(utils.getByLabelText('Amount'), '0.20');

  await fireEvent.press(utils.getByText('Save'));
  expect(mockRecordManualWithReturns).not.toHaveBeenCalled();

  await fireEvent.changeText(utils.getByLabelText('Amount'), '1.00');
  await fireEvent.press(utils.getByText('Save'));
  expect(mockRecordManualWithReturns).toHaveBeenCalledTimes(1);
});

it('shows an inline reason for an incomplete split, only after Save is pressed', async () => {
  const utils = await renderAddFromHolding('payer');
  await pickType(utils, 'split');

  expect(utils.queryByText('Select a category.')).toBeNull();
  await fireEvent.press(utils.getByText('Save'));
  expect(utils.getByText('Select a category.')).toBeTruthy();

  await pickCategory(utils, 'Groceries');
  await fireEvent.press(utils.getByText('Save'));
  expect(utils.getByText('Enter a payment amount and at least one valid return.')).toBeTruthy();
});

it('does not write an otherwise-valid split until a category is picked', async () => {
  const utils = await renderAddFromHolding('payer');

  await pickType(utils, 'split');
  await fireEvent.press(utils.getByLabelText('Return to 1'));
  await fireEvent.press(utils.getByText('Alice'));
  await fireEvent.changeText(utils.getByLabelText('Return 1'), '0.20');
  await fireEvent.changeText(utils.getByLabelText('Amount'), '1.00');

  await fireEvent.press(utils.getByText('Save'));
  expect(mockRecordManualWithReturns).not.toHaveBeenCalled();

  await pickCategory(utils, 'Groceries');
  await fireEvent.press(utils.getByText('Save'));
  expect(mockRecordManualWithReturns).toHaveBeenCalledTimes(1);
});
```

Every OTHER `it.each`/parametrized test that already presses Save directly
and asserts only on a write mock (e.g. the "rejects %s: recordExchange is
not called" table near line 1725, `'never calls update/remove on the
existing row when converting'`) stays UNCHANGED.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/screens/forms/transaction-form --no-coverage`
Expected: FAIL — Save is currently disabled (not enabled) in every
converted test, and every reason currently renders live without a press.

- [ ] **Step 3: Write the minimal implementation.** In
  `transaction-form.screen.tsx`, add state (alongside the other `useState`
  declarations in the component body):

```tsx
const [attemptedSave, setAttemptedSave] = useState(false);
```

Change `save`'s opening:

```tsx
  const save = async (): Promise<void> => {
    if (disableSave) {
      setAttemptedSave(true);
      return;
    }

    try {
      if (await dispatchSpecialSave()) {
        return;
      }
      // ...unchanged body...
```

(Do NOT remove `dispatchSpecialSave`'s/`tryWriteManual`'s own internal
early-return guards — they stay as a defensive backstop; this is the one new
OUTER gate.)

Change `renderSaveReason`'s signature and body:

```tsx
const renderSaveReason = (
  reason: string | null,
  isSubmitting: boolean,
  attempted: boolean,
): ReactElement | null => {
  if (reason === null || isSubmitting || !attempted) {
    return null;
  }

  return <FieldError message={reason} testID="transaction-save-reason" />;
};
```

Change its call site and the footer Button:

```tsx
        footer={
          showsSaveButton(isReadOnly, categoryChanged, converting) ? (
            <Box gap={2}>
              {renderSaveReason(disableSaveReason, isSubmitting, attemptedSave)}

              <Button onPress={onSave} disabled={isSubmitting}>
                {t('common.save')}
              </Button>
            </Box>
          ) : undefined
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/screens/forms/transaction-form --no-coverage`
Expected: PASS (the full file — this is the largest, riskiest diff in the
plan; if any UNCONVERTED test fails, it references `disabled`/a reason text
this task's replacement list missed — grep the test file for
`accessibilityState.disabled` and for every `FieldError`-rendered string
literal in `transaction-form.screen.tsx` to confirm every reference was
accounted for).

- [ ] **Step 5: Commit**

```bash
git add src/screens/forms/transaction-form
git commit -m "refactor(forms): always-enable transaction Save, validate on press"
```

- [ ] **Step 6 (kiko:reviewer): review.** Confirm `isSaveDisabled`/
  `saveDisabledReason`/`convertingReason`/`exchangeReason`/`splitReason`/
  `plainReason` are UNCHANGED (only their call sites' gating changed). Run
  `make gate`.

## Task 7: `account-detail` `BankSyncSection` — keep the bank selector visible and changeable (item 4)

**Files:**
- Modify: `src/screens/account-detail/bank-sync-section/bank-sync-section.component.tsx`
- Modify: `src/screens/account-detail/bank-sync-section/bank-sync-section.component.test.tsx`
- Modify: `src/i18n/locales/en.ts` (`accountDetail` block)
- Modify: `src/i18n/locales/uk.ts` (`accountDetail` block)

**Interfaces:**
- Ground truth: `selectedProviderId` (local `useState`, line ~104) currently
  has no way back to `undefined` short of a Disconnect — once a provider is
  picked from `AddBankProviderSheet`, only `connectFieldByProviderId[selectedProviderId]`
  renders (lines 260-276); this is the "selector disappears and cannot be
  changed without re-navigating" bug the spec's item 4 describes, reproduced
  today in the account-detail "Add a bank" flow (there is no such selector
  in `account-form`'s edit mode — it never renders a sync section at all).

- [ ] **Step 1: Write the failing test.** Add to
  `describe('BankSyncSection — disconnected', ...)`, after the existing
  `'renders the Monobank field after picking Monobank...'` test:

```tsx
it('offers a Change action once a provider is picked, which re-shows the "Add a bank" trigger', async () => {
  const view = await render(<BankSyncSection account={bankAccount()} />);

  await fireEvent.press(view.getByText('Add a bank'));
  await fireEvent.press(view.getByTestId('add-bank-option-monobank'));

  expect(view.getByText('monobank field')).toBeTruthy();
  expect(view.getByText('Change bank')).toBeTruthy();

  await fireEvent.press(view.getByText('Change bank'));

  expect(view.getByText('Add a bank')).toBeTruthy();
  expect(view.queryByText('monobank field')).toBeNull();

  // The picker is fully reopenable — the mechanism this test proves, even
  // though only one provider is wired today.
  await fireEvent.press(view.getByText('Add a bank'));
  expect(view.getByTestId('add-bank-sheet')).toBeTruthy();
});
```

Add the new i18n key. In `src/i18n/locales/en.ts`, inside `accountDetail`
(alphabetically, between `btcAddressPlaceholder` and `checking`):

```ts
    changeBankAction: 'Change bank',
```

In `src/i18n/locales/uk.ts`, same position:

```ts
    changeBankAction: 'Змінити банк',
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/account-detail/bank-sync-section --no-coverage`
Expected: FAIL — `getByText('Change bank')` does not exist yet.

- [ ] **Step 3: Write the minimal implementation.** In
  `bank-sync-section.component.tsx`, replace the disconnected-state return
  block's trigger/field branch:

```tsx
  return (
    <Box gap={3}>
      <Text variant="heading">{t('accountDetail.synchronization')}</Text>

      {selectedProviderId === undefined ? (
        <Button
          variant="secondaryTonal"
          size="small"
          fullWidth={false}
          icon="plus"
          onPress={() => setProviderPickerOpen(true)}
        >
          {t('accountDetail.addBankAction')}
        </Button>
      ) : (
        <Box gap={2}>
          {connectFieldByProviderId[selectedProviderId]}

          <Button
            variant="ghost"
            size="small"
            fullWidth={false}
            onPress={() => setSelectedProviderId(undefined)}
          >
            {t('accountDetail.changeBankAction')}
          </Button>
        </Box>
      )}

      {error !== undefined && (
        <Text variant="body" tone="negative">
          {error}
        </Text>
      )}

      <AddBankProviderSheet
        visible={providerPickerOpen}
        onDismiss={() => setProviderPickerOpen(false)}
        onSelect={setSelectedProviderId}
      />
    </Box>
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/account-detail/bank-sync-section --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/account-detail/bank-sync-section src/i18n/locales/en.ts src/i18n/locales/uk.ts
git commit -m "fix(account-detail): keep the bank selector visible and changeable"
```

- [ ] **Step 6 (kiko:reviewer): review.** Confirm pressing "Change bank"
  does NOT call `runDisconnect`/touch the Keychain — it only resets local UI
  state, since no connection exists yet in the pre-connect branch. Run
  `make gate`.

## Task 8: `account-detail` footer — stack "Import statement" and "Add holding" (DESIGNER-OWNED, item 6)

**Owner:** kiko:designer.

**Files:**
- Modify: `src/screens/account-detail/account-detail.screen.tsx`
- Modify: `src/screens/account-detail/account-detail.screen.test.tsx`

**Ground truth:** `account-detail.screen.tsx:163-181` wraps both footer
buttons in `<Box direction="row" gap={2}>`, with Import statement
`fullWidth={false}` (a fixed-width secondaryTonal pill) beside Add holding
`fullWidth` (a primary button that fills the remaining row width) — the pill
plus the primary button's own minimum content width can exceed the
available row width on a narrow device, overflowing the screen edge.

- [ ] **Step 1: Write the failing test.** In `account-detail.screen.test.tsx`,
  widen the Button mock's captured prop shape and push call (lines 49, 65):

```tsx
const mockButtonProps: {
  variant?: string;
  children: ReactNode;
  icon?: string;
  fullWidth?: boolean;
}[] = [];
```

```tsx
    default: (props: {
      variant?: string;
      children?: ReactNode;
      onPress: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      testID?: string;
      icon?: string;
      fullWidth?: boolean;
    }) => {
      mockButtonProps.push({
        variant: props.variant,
        children: props.children,
        icon: props.icon,
        fullWidth: props.fullWidth,
      });
```

Add a new test inside
`describe('AccountDetailScreen — statement import (footer button + pickAndOpenStatement)', ...)`,
next to `'renders Import statement with the secondaryTonal variant...'`:

```tsx
it('renders Import statement full-width, stacked above Add holding (not sharing a row)', async () => {
  await renderScreen();

  const importButton = mockButtonProps.find((props) => props.children === 'Import statement');

  expect(importButton?.fullWidth).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/account-detail/account-detail.screen --no-coverage -t "stacked above Add holding"`
Expected: FAIL — `importButton?.fullWidth` is currently `false`.

- [ ] **Step 3: Write the minimal implementation.** In
  `account-detail.screen.tsx`:

```tsx
      footer={
        <Box gap={2}>
          <Button
            variant="secondaryTonal"
            fullWidth
            onPress={pickAndOpenStatement}
            icon="doc.badge.plus"
          >
            {t('accountDetail.importStatement')}
          </Button>
          <Button
            variant="primary"
            fullWidth
            onPress={() => navigation.navigate('HoldingForm', { accountId })}
          >
            {t('accountDetail.addHolding')}
          </Button>
        </Box>
      }
```

(drops `direction="row"` from the wrapping `Box` — `Box`'s default
`flexDirection` is `'column'`, `box.component.tsx` — and changes Import
statement's `fullWidth={false}` to `fullWidth`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/account-detail/account-detail.screen --no-coverage`
Expected: PASS (the whole file — confirm the two pre-existing footer tests,
`'renders an Import statement action beside Add holding in the footer'` and
`'renders Import statement with the secondaryTonal variant and its doc icon
(Add holding stays primary)'`, still pass unchanged: neither asserts on
`direction` or the old `fullWidth={false}`).

- [ ] **Step 5: Commit**

```bash
git add src/screens/account-detail/account-detail.screen.tsx \
  src/screens/account-detail/account-detail.screen.test.tsx
git commit -m "fix(account-detail): stack the footer actions so neither overflows"
```

- [ ] **Step 6 (kiko:reviewer): review.** Confirm no other footer in the app
  relies on this file's `direction="row"` footer shape being copied
  elsewhere (grep `direction="row"` under `src/screens/**/footer` usage is
  unnecessary — this is a self-contained JSX change). Run `make gate`.

## Task 9: Scope statement import to the account's selected bank (item 5)

**Files:**
- Modify: `src/navigation/types.d.ts` (`StatementImport` route params)
- Modify: `src/screens/account-detail/account-detail.screen.tsx` (`pickAndOpenStatement`)
- Modify: `src/screens/account-detail/account-detail.screen.test.tsx`
- Modify: `src/screens/statement-import/statement-import.screen.tsx`
- Modify: `src/screens/statement-import/statement-import.screen.test.tsx`
- Modify: `src/i18n/locales/en.ts` (`statementImport` block — append)
- Modify: `src/i18n/locales/uk.ts` (`statementImport` block — append)

**Interfaces:**
- Consumes: `statementFormatIdForBank` (Task 2); `statementFormats`
  (`src/statement-import/registry/`, already exported alongside
  `detectFormat`).

- [ ] **Step 1: Write the failing tests.**

In `src/navigation/types.d.ts`, add the import and widen the route:

```ts
import type { StatementFormatId } from '../statement-import/parser';
```

```ts
  // ...doc comment unchanged, extended one line:
  // `expectedFormatId` (device-feedback-round-1 item 5) scopes recognition
  // to the account's own selected bank when one is known — see
  // `statementFormatIdForBank` (`src/bank-sync/bank-catalog/`). Undefined
  // falls back to the existing multi-format auto-detect (an account with no
  // `bankId`, or the accountId-less Share Extension entry point).
  StatementImport: { filePath: string; accountId?: string; expectedFormatId?: StatementFormatId };
```

In `account-detail.screen.test.tsx`, widen the local `Account` type (line
180) and add a test:

```ts
type Account = {
  id: string;
  name: string;
  kind: string;
  institution?: string | null;
  bankId?: string | null;
  icon?: string | null;
  color?: string | null;
};
```

```tsx
it('passes expectedFormatId resolved from the account bankId when navigating to StatementImport', async () => {
  setLiveData({ accounts: [account({ bankId: 'privatbank' })], holdings: [] });
  mockPick.mockResolvedValue([
    { uri: 'file:///mock/statement.xlsx', name: 'statement.xlsx', type: 'application/xlsx' },
  ]);
  const { getByText, navigation } = await renderScreen();

  await act(async () => {
    await fireEvent.press(getByText('Import statement'));
  });

  expect(navigation.navigate).toHaveBeenCalledWith('StatementImport', {
    filePath: 'file:///mock/statement.xlsx',
    accountId: 'a',
    expectedFormatId: 'privatbank-xlsx',
  });
});
```

(the existing `'navigates to StatementImport with the resolved filePath and
accountId on success...'` test, which asserts the EXACT `{ filePath,
accountId }` object with no `expectedFormatId`, stays passing unchanged:
Jest's `toHaveBeenCalledWith`/`toEqual` ignore an explicitly-`undefined`
property, and the default `account()` factory sets no `bankId`.)

In `statement-import.screen.test.tsx`, widen `renderScreen`'s param type and
add two tests. Widen:

```ts
const renderScreen = async (params: {
  filePath: string;
  accountId?: string;
  expectedFormatId?: string;
}) => {
```

Add, inside `describe('StatementImportScreen', ...)`, after the existing
`'reads the picked file, recognizes the Monobank CSV format...'` test:

```tsx
it('still recognizes the real file when expectedFormatId matches its actual format', async () => {
  mockReadFile.mockResolvedValue(fixtureBase64);

  const { getByText } = await renderScreen({
    filePath: '/mock/statement.csv',
    accountId: 'a',
    expectedFormatId: 'monobank-csv',
  });

  await waitFor(() => expect(getByText('Monobank (CSV)')).toBeTruthy());
});

it('shows a bank-mismatch reason, not the generic unrecognized-format text, when the file matches a DIFFERENT bank than expected', async () => {
  mockReadFile.mockResolvedValue(fixtureBase64);

  const { getByText, queryByTestId, queryByText } = await renderScreen({
    filePath: '/mock/statement.csv',
    accountId: 'a',
    expectedFormatId: 'sensebank-csv',
  });

  await waitFor(() =>
    expect(getByText(i18n.t('statementImport.bankMismatch', { bank: 'Sensebank (CSV)' }))).toBeTruthy(),
  );
  expect(queryByText(i18n.t('statementImport.unrecognizedFormat'))).toBeNull();
  expect(queryByTestId('statement-import-transaction-count')).toBeNull();
});
```

Add the new i18n key. In `src/i18n/locales/en.ts`, APPEND (per this block's
own append-ordered convention) inside `statementImport`, right after
`skippedWrongCurrency_other`:

```ts
    // The picked file recognized as a DIFFERENT bank's format than the one
    // scoped by `expectedFormatId` (device-feedback-round-1 item 5) — a more
    // specific state than the generic `unrecognizedFormat`, so the user
    // knows WHY (wrong bank's export), not just that the file failed.
    bankMismatch: "This doesn't look like a {{bank}} statement. Pick the matching file, or change the account's bank.",
```

In `src/i18n/locales/uk.ts`, same position:

```ts
    bankMismatch: 'Це не схоже на виписку {{bank}}. Оберіть відповідний файл або змініть банк рахунку.',
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/screens/statement-import src/screens/account-detail/account-detail.screen --no-coverage`
Expected: FAIL — the account-detail test fails (no `expectedFormatId` in the
navigate call yet); the statement-import mismatch test fails (the screen
currently auto-detects across all 6 formats regardless of `expectedFormatId`,
so it recognizes the Monobank fixture as Monobank and shows its preview,
never `bankMismatch`).

- [ ] **Step 3: Write the minimal implementation.**

In `account-detail.screen.tsx`, add the import:

```tsx
import { statementFormatIdForBank } from '../../bank-sync/bank-catalog';
```

Change `pickAndOpenStatement`'s navigate call:

```tsx
    navigation.navigate('StatementImport', {
      filePath: picked.uri,
      accountId,
      expectedFormatId: statementFormatIdForBank(account?.bankId),
    });
```

In `statement-import.screen.tsx`, add the import:

```tsx
import { statementFormats } from '../../statement-import/registry';
```

Read the new route param and compute the scoped format, right after
`const { filePath, accountId } = route.params;`:

```tsx
  const { filePath, accountId, expectedFormatId } = route.params;
```

Add a pure helper right above `previewStats` (same module-scope,
cognitive-complexity-budget reasoning as that function):

```tsx
// The one format `expectedFormatId` names, or `undefined` when the route
// carries none (an account with no `bankId`, or the accountId-less Share
// Extension entry point) — the caller then falls back to the existing
// multi-format `detectFormat` auto-detect below.
const expectedFormatOf = (id: StatementFormatId | undefined): StatementFormat | undefined =>
  id === undefined ? undefined : statementFormats.find((format) => format.id === id);
```

Replace the `format`/`stats`/`showUnreadable` derivation block:

```tsx
  const fileName = fileNameOf(filePath);
  const input =
    loadState.kind === 'ready'
      ? { text: loadState.text, fileName, sheetRows: loadState.sheetRows }
      : undefined;
  const expectedFormat = expectedFormatOf(expectedFormatId);
  // Scoped recognition (device-feedback-round-1 item 5): once the account's
  // bank is known, ONLY that bank's own format may match — a file that
  // parses as a DIFFERENT bank's format is a mismatch, not a silent
  // auto-detect success. `expectedFormat === undefined` (no known bank)
  // falls back to the original cross-format `detectFormat`.
  const format =
    input === undefined
      ? undefined
      : expectedFormat !== undefined
        ? (expectedFormat.detect(input) ? expectedFormat : undefined)
        : detectFormat(input);
  const stats = format && input ? previewStats(format, input) : undefined;
  const bankMismatch = input !== undefined && expectedFormat !== undefined && format === undefined;
  // Covers every "this file cannot be imported as-is" outcome EXCEPT the
  // bank-mismatch case (which renders its own, more specific message below):
  // the read itself failed, OR the read succeeded but no format recognized
  // it (and none was expected), OR a format matched and then failed to
  // parse a data row.
  const showUnreadable =
    !bankMismatch &&
    (loadState.kind === 'unreadable' || (input !== undefined && stats === undefined));
```

Add the `StatementFormat`/`StatementFormatId` type imports if not already
present (`StatementFormat` is already imported; add `StatementFormatId`
alongside it):

```tsx
import type {
  SpreadsheetCellValue,
  StatementFormat,
  StatementFormatId,
  StatementFormatInput,
} from '../../statement-import/parser';
```

Render the mismatch state, ahead of the existing `showUnreadable` block:

```tsx
        {bankMismatch && expectedFormat && (
          <Text variant="body">
            {t('statementImport.bankMismatch', { bank: expectedFormat.displayName })}
          </Text>
        )}

        {showUnreadable && <Text variant="body">{t('statementImport.unrecognizedFormat')}</Text>}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/screens/statement-import src/screens/account-detail/account-detail.screen --no-coverage`
Expected: PASS (both files in full — confirm every EXISTING
`statement-import.screen.test.tsx` test, none of which passes
`expectedFormatId`, still resolves `expectedFormat` to `undefined` and falls
through to the original `detectFormat` path unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/navigation/types.d.ts src/screens/account-detail/account-detail.screen.tsx \
  src/screens/account-detail/account-detail.screen.test.tsx \
  src/screens/statement-import/statement-import.screen.tsx \
  src/screens/statement-import/statement-import.screen.test.tsx \
  src/i18n/locales/en.ts src/i18n/locales/uk.ts
git commit -m "feat(statement-import): scope recognition to the account's selected bank"
```

- [ ] **Step 6 (kiko:reviewer): review.** Confirm the Share Extension entry
  point (no `accountId`, hence route always omits `expectedFormatId` there)
  is untouched — `expectedFormatOf(undefined)` returns `undefined`, so that
  path takes the exact pre-existing `detectFormat` branch. Confirm
  `bankMismatch` never fires for `expectedFormat === undefined`. Run
  `make gate`.

## Task 10: Final verification

**Files:** none (verification only).

- [ ] **Step 1:** Run `make verify` (lint, full Jest, gate) from the repo
  root. Expected: PASS, zero failures across every form/bank-catalog/
  account-detail/statement-import test file plus the rest of the suite.
- [ ] **Step 2:** Diff `src/i18n/locales/en.ts` against `uk.ts` key-by-key to
  confirm every new key from Tasks 1, 3, 4, 7, 9 exists in BOTH files with no
  typo'd key name, and that `nameRequiredForSync` is gone from both.
- [ ] **Step 3:** `git diff main...HEAD --stat` (or the equivalent against
  this branch's base, `next @ fbe49fc`) to confirm `src/data-transfer/` and
  every Settings export/import screen show zero changes (Global Constraint).
- [ ] **Step 4: 5.6 verification.** Run `npm run check:security` and
  `npm run check:rules` explicitly (both are already part of `make gate`,
  re-run standalone here as the plan's own checkpoint). Then run
  `grep -rn "SHOW_\|HIDE_\|ENABLE_" src/bank-sync/bank-catalog src/screens/forms/bank-type-field src/screens/forms/account-form src/screens/account-detail`
  — expect NO match. Read `src/bank-sync/bank-catalog/bank-catalog.ts` and
  `bank-type-field.component.tsx` once more end to end: confirm every one of
  the 6 catalog entries renders unconditionally, and that the only
  connectable/import-only DIFFERENCE is which affordance (Connect field vs.
  caption text) shows — never whether the ROW itself shows.
- [ ] **Step 5:** Run `make deep` (mutation testing + osv-scanner) from the
  repo root. Expected: mutation score at or above the current break
  threshold on the files this plan touched; osv-scanner shows only the
  already-accepted, documented CVEs (`image-size`, `decode-uri-component`
  per `docs/harness/dependency-hygiene.md`) — no new ones.
- [ ] **Step 6 (kiko:reviewer): final pass.** Re-read all ten task diffs
  together against the Global Constraints section at the top of this plan,
  specifically: no form's footer Save is ever conditionally `disabled` on
  validity, every reason line's visibility is `attempted && stillInvalid`
  with no per-form reset variant, `MonobankConnectField`/`WalletAddressField`/
  `BinanceCredentialsField`/`CryptoSyncForm`/`monobank/sync.ts` are untouched,
  and `src/data-transfer/` shows zero changes.
