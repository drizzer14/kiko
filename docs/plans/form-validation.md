# Form Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every form in Kiko explains itself: a disabled Save always shows an
inline reason next to it, and a Save that fails because a repository write
throws shows an `Alert` and keeps the screen open — never a silent no-op.

**Architecture:** One new shared design-system component, `FieldError`
(`src/design-system/components/field-error/`), renders the one inline
validation-failure line every form composes. Each of the four form screens
(`account-form`, `contribution-form`, `holding-form`, `transaction-form`)
gets (a) its `save()` write(s) wrapped in `try`/`catch` + `Alert.alert`
exactly the way `contribution-form.screen.tsx` already does today, and (b) a
pure "why is Save disabled" helper — module-level where the screen already
has one (`transaction-form`'s `isSaveDisabled`), a local closure where it
doesn't (`holding-form`'s `isTermDepositValid`/`isBondValid`) — rendered
through `FieldError` next to the blocked control. No touched/blur state is
introduced: every reason line is unconditionally visible whenever its
condition fails, mirroring the existing precedent in
`account-form.screen.tsx` (`nameRequiredForSync`, shown the instant the name
is blank, not after a blur).

**Tech Stack:** React Native, TypeScript, `react-i18next`, Jest +
`@testing-library/react-native`, Biome, the Kiko harness (`make gate`,
`make verify`, `make deep`).

**Spec:** This plan's spec is the coordinator's brief (embedded in the task
history) plus the ground-truth investigation recorded in each task below —
there is no separate spec doc for this feature. `.claude/skills/
kiko-architecture`, `kiko-code-style`, `kiko-design-system`, and
`kiko-domain` (all in this repo) are the standing project-knowledge specs
every task implicitly argues from.

## IMPORTANT — ground truth correction, read before starting

The brief that produced this plan assumed the bank create form still
connects Monobank implicitly on the footer Save and swallows the error.
**That is already fixed on `next` @ `50f3104`** (this branch's base):
commit `6fa77da` ("feat(forms): explicit Connect Monobank button on bank
create; generalize id reconciliation") shipped the exact pattern the brief
asked for — `MonobankConnectField` (`src/screens/account-detail/
monobank-connect-field/`), the pre-generated `pendingAccountId`
(`src/screens/forms/account-form/account-form.screen.tsx`'s `id()` call),
and the one-shot `ensureAccount`/`accountCreate` latch are all already in
`account-form.screen.tsx`. **Do not re-implement decision #1. Do not touch
`MonobankConnectField`, `WalletAddressField`, `BinanceCredentialsField`, or
`CryptoSyncForm`** — their explicit-Connect behavior (live validation,
Binance verify-before-Keychain-write) is correct as-is and this plan's job
is to leave it untouched (Global Constraint 3 below).

What genuinely remains, found by reading every `*.screen.tsx` with a footer
Save (`account-form`, `contribution-form`, `holding-form`,
`transaction-form`) end to end:

| Form | Write-failure swallowed? | Disabled Save has no inline reason? |
|---|---|---|
| `contribution-form.screen.tsx` | No — already `try`/`catch` + `Alert` (the established pattern) | Yes — a non-positive amount disables Save with no text |
| `account-form.screen.tsx` | Yes — `save()` has no `try`/`catch` around `createCashAccount`/`update`/`ensureAccount` | No new gap (the sync-section hints already cover the only conditional case) |
| `holding-form.screen.tsx` | Yes — `save()` has no `try`/`catch` around `create`/`updateWithBalanceDelta` | Yes — a term-deposit/bond's numeric/date checks (`isTermDepositValid`, `isBondValid`) disable Save with no text |
| `transaction-form.screen.tsx` | Yes — `save()`, `applyOverride()`, `applyOverrideOne()` have no `try`/`catch` around any of `recordManual`/`recordManualWithReturns`/`recordExchange`/`recordExchangeCounterpart`/`update`/`setCategory`/`upsertCategoryOverride` | Yes — `isSaveDisabled`'s convert/exchange/split/create branches disable Save with no text |

## Global Constraints

- TDD every task: RED test (kiko:qa) fails for the right reason, then GREEN
  implementation (kiko:developer) makes it pass, then kiko:reviewer reviews
  the diff — including hand-checking import order per `kiko-code-style`
  (Biome does not check it).
- `make gate` must be green at the end of every task. `make verify` (lint +
  full Jest + gate) must be green, then `make deep`, before the plan is
  done.
- Do not touch `src/data-transfer/` or any Settings export/import screen —
  a parallel track owns that code.
- New i18n strings go in a clearly separated block in
  `src/i18n/locales/en.ts` and `uk.ts` (both files, kept in lockstep) — do
  not interleave with the parallel export/import track's own additions;
  add each new key alphabetically within its existing object, per the
  file's own convention.
- Do not touch `MonobankConnectField`, `WalletAddressField`,
  `BinanceCredentialsField`, `CryptoSyncForm`, or the `ensureAccount`/
  `accountCreate` latch in `account-form.screen.tsx` — decision #1 is
  already shipped (see above).
- No `touched`/blur gating on a new reason line — always visible when its
  condition fails, matching the existing `nameRequiredForSync` precedent.
- Error/reason text uses `Text`'s existing `tone="negative"` token (the
  same token `FieldLabel`'s required asterisk already uses) — never a new
  color literal.
- Follow `kiko-code-style`: blank line before every `return`/`if`, arrow
  functions always parenthesized, imports hand-sorted by length ascending
  within their group (Biome does not check this — the reviewer does).

## Task 1: Shared `FieldError` component

**Files:**
- Create: `src/design-system/components/field-error/field-error.props.d.ts`
- Create: `src/design-system/components/field-error/field-error.component.tsx`
- Create: `src/design-system/components/field-error/field-error.component.test.tsx`
- Create: `src/design-system/components/field-error/index.ts`

**Interfaces:**
- Produces: `FieldError` (default export), props `{ message: string;
  testID?: string }` — every later task imports this from
  `../../../design-system/components/field-error` (screens under
  `src/screens/forms/*`) or the equivalent relative path.

- [ ] **Step 1: Write the failing test** — `field-error.component.test.tsx`:

```tsx
import { render } from '@testing-library/react-native';
import '../../unistyles';
import FieldError from '.';

describe('FieldError', () => {
  it('renders the message in the negative caption tone', async () => {
    const { getByText } = await render(
      <FieldError message="Enter an amount greater than 0." />,
    );

    expect(getByText('Enter an amount greater than 0.')).toBeTruthy();
  });

  it('applies an optional testID to its outer container', async () => {
    const { getByTestId } = await render(
      <FieldError message="Select a category." testID="my-reason" />,
    );

    expect(getByTestId('my-reason')).toBeTruthy();
  });

  it('renders no testID when none is passed', async () => {
    const { queryByTestId } = await render(<FieldError message="Select a category." />);

    expect(queryByTestId('my-reason')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/design-system/components/field-error --no-coverage`
Expected: FAIL — `Cannot find module '.' from 'field-error.component.test.tsx'`
(the component doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

`field-error.props.d.ts`:

```ts
export type FieldErrorProps = {
  // The validation-failure message shown inline, in the `negative` (red)
  // caption tone — the reason a blocked Save button (or a single field) is
  // invalid right now. The caller decides WHETHER to render this at all —
  // there is no `visible` prop — the same way account-form's own
  // `!canSave && <Box>...` hint is gated at the call site.
  message: string;
  // Optional testID applied to the outer Box, so a test can target one
  // form's reason line deterministically among several.
  testID?: string;
};
```

`field-error.component.tsx`:

```tsx
import type { FC } from 'react';

import Box from '../box';
import Text from '../text';

import type { FieldErrorProps } from './field-error.props';

// The one inline validation-failure line a form renders next to a blocked
// field or footer Save button, in the `negative` caption tone — the same
// tone `FieldLabel`'s required asterisk already uses. Every form composes
// this instead of hand-rolling its own `Box`+`Text` error caption (see
// kiko-code-style's disabled-Save audit).
const FieldError: FC<FieldErrorProps> = ({ message, testID }) => {
  return (
    <Box testID={testID}>
      <Text variant="caption" tone="negative">
        {message}
      </Text>
    </Box>
  );
};

export default FieldError;
```

`index.ts`:

```ts
export { default } from './field-error.component';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/design-system/components/field-error --no-coverage`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/design-system/components/field-error
git commit -m "feat(design-system): add shared FieldError inline validation line"
```

- [ ] **Step 6 (kiko:reviewer): review** the new component against
  `kiko-design-system` (token usage, file-suffix/barrel convention matching
  `field-label/`) and `kiko-code-style` (export shape, blank-line rule).
  Run `make gate`.

## Task 2: `contribution-form` — inline amount reason

**Files:**
- Modify: `src/screens/forms/contribution-form/contribution-form.screen.tsx`
- Modify: `src/screens/forms/contribution-form/contribution-form.screen.test.tsx`
- Modify: `src/i18n/locales/en.ts` (`forms.contribution` block)
- Modify: `src/i18n/locales/uk.ts` (`forms.contribution` block)

**Interfaces:**
- Consumes: `FieldError` from Task 1 (`../../../design-system/components/field-error`).

- [ ] **Step 1: Write the failing test** — add to
  `contribution-form.screen.test.tsx`, in the same `describe` block as the
  existing `'disables Save until a positive amount is entered'` test:

```tsx
  it('shows an inline reason once a non-positive amount is entered', async () => {
    const utils = await renderScreen();

    // Blank: no reason yet, nothing typed.
    expect(utils.queryByText('Enter an amount greater than 0.')).toBeNull();

    // A zero amount: the reason appears.
    await fireEvent.changeText(utils.getByLabelText('Amount'), '0');
    expect(utils.getByText('Enter an amount greater than 0.')).toBeTruthy();

    // A positive amount: the reason clears.
    await fireEvent.changeText(utils.getByLabelText('Amount'), '10');
    expect(utils.queryByText('Enter an amount greater than 0.')).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/forms/contribution-form --no-coverage`
Expected: FAIL — `Enter an amount greater than 0.` is never rendered.

- [ ] **Step 3: Write minimal implementation.** In
  `src/i18n/locales/en.ts`, inside the `forms.contribution` object, add
  (alphabetically, between `addTitle` and `amountPlaceholder`):

```ts
      amountError: 'Enter an amount greater than 0.',
```

In `src/i18n/locales/uk.ts`, same position:

```ts
      amountError: 'Введіть суму більше 0.',
```

In `contribution-form.screen.tsx`, add the import (external-package group,
by length — `import FieldError from '../../../design-system/components/
field-error';` sorts alongside the other `design-system/components/*`
imports already in that group) and render it between the amount `TextField`
and the `DateField`:

```tsx
import FieldError from '../../../design-system/components/field-error';
```

```tsx
        <TextField
          label={t('forms.fields.amount')}
          value={amount}
          onChangeText={(text) => setAmount(groupAmount(text))}
          keyboardType="decimal-pad"
          placeholder={t('forms.contribution.amountPlaceholder')}
          suffix={currencySymbol[currency]}
          required
        />

        {amount.trim() !== '' && !(parseAmount(amount) > 0) && (
          <FieldError message={t('forms.contribution.amountError')} />
        )}

        <DateField label={t('forms.fields.date')} value={date} onChange={setDate} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/forms/contribution-form --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/forms/contribution-form src/i18n/locales/en.ts src/i18n/locales/uk.ts
git commit -m "feat(forms): inline reason for a non-positive contribution amount"
```

- [ ] **Step 6 (kiko:reviewer): review.** Confirm the gate before the
  `TextField`/`DateField` doesn't trip the blank-line-before-`return`/`if`
  rule (n/a here — no new `if`/`return`), confirm import order by hand, run
  `make gate`.

## Task 3: `account-form` — stop swallowing a write failure

**Files:**
- Modify: `src/screens/forms/account-form/account-form.screen.tsx`
- Modify: `src/screens/forms/account-form/account-form.screen.test.tsx`
- Modify: `src/i18n/locales/en.ts` (`forms.fields` block)
- Modify: `src/i18n/locales/uk.ts` (`forms.fields` block)

**Interfaces:**
- Produces: `forms.fields.saveErrorTitle` / `forms.fields.saveErrorMessage`
  — the SHARED generic "could not save" `Alert` copy Task 4 and Task 7
  reuse verbatim (do not add a per-form duplicate of these two keys).

- [ ] **Step 1: Write the failing test.** Add to
  `account-form.screen.test.tsx`, inside the existing `describe
  ('AccountFormScreen', ...)` block (near the other `mockCreateCashAccount`
  tests):

```tsx
  it('surfaces an alert and does not navigate when the cash create fails', async () => {
    mockCreateCashAccount.mockRejectedValueOnce(new Error('boom'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await fireEvent.press(getByText('Cash'));
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.'));
    expect(navigation.goBack).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
```

Add the import at the top of the test file (alongside the existing
`@testing-library/react-native` import group):

```tsx
import { Alert } from 'react-native';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/forms/account-form --no-coverage`
Expected: FAIL — `alertSpy` is never called; the test hangs on `waitFor` and
times out (the current `save()` re-throws unhandled, so `navigation.goBack`
is also never called, but nothing ever calls `Alert.alert` either).

- [ ] **Step 3: Write minimal implementation.** In `src/i18n/locales/en.ts`,
  inside the `forms.fields` object, add (alphabetically, between `name` and
  `searchCurrencyPlaceholder`):

```ts
      saveErrorMessage: 'Please try again.',
      saveErrorTitle: 'Could not save',
```

In `src/i18n/locales/uk.ts`, same position:

```ts
      saveErrorMessage: 'Спробуйте ще раз.',
      saveErrorTitle: 'Не вдалося зберегти',
```

In `account-form.screen.tsx`, add the import — at 37 characters,
`import { Alert } from 'react-native';` is now the SHORTEST external-package
import, so it sorts first, before `import { useSync } from
'@kiko/sync/use-sync';` (46 chars):

```tsx
import { Alert } from 'react-native';
import { useSync } from '@kiko/sync/use-sync';
```

Wrap `save()`'s body (everything after the `!canSave` guard) in `try`/
`catch`:

```tsx
  const save = async (): Promise<void> => {
    // Block submit on an empty (or whitespace-only) name; the button is also
    // disabled below so this guards the programmatic path too.
    if (!canSave) {
      return;
    }

    try {
      if (isEdit) {
        // Update the editable identity fields in one transaction; the icon routes
        // through setIcon (so a cleared icon persists an explicit null), the same
        // split the create path uses. Kind is read-only, and the cash currency +
        // initial value belong to the create-time initial holding, so neither is
        // touched here.
        await accountsRepo.update(editId, { name: trimmedName, color });
        await accountsRepo.setIcon(editId, icon);
        navigation.goBack();

        return;
      }

      if (kind === 'cash') {
        // Clamp a negative initial value to zero — a cash balance can never be
        // negative, and parseAmount('') is NaN so `|| 0` also covers a blank field.
        const initialMajor = Math.max(0, parseAmount(initialValue) || 0);
        await accountsRepo.createCashAccount({
          name: trimmedName,
          currency,
          initialBalanceMinorUnits: Money.fromMajor(currency, initialMajor).minorUnits,
          icon,
          color,
        });
        navigation.goBack();

        return;
      }

      // Bank and crypto share one create path now — `kind` here is 'bank' or
      // 'crypto' (cash returned above). A field's own Connect may already have
      // inserted the row via ensureAccount (Option A); if so, persist any
      // name/color/icon edited AFTER connecting rather than inserting a DUPLICATE
      // account (the field already handled the credential + first sync). Otherwise
      // this Save is the first write, so create the row now — an unconnected
      // bank/crypto account is valid; the user connects a source later from its
      // detail screen.
      if (accountCreate.current !== null) {
        await accountsRepo.update(pendingAccountId, { name: trimmedName, color });
        await accountsRepo.setIcon(pendingAccountId, icon);
      } else {
        await ensureAccount();
      }
      navigation.goBack();
    } catch {
      // A DB write failure (disk full, locked) must not vanish silently — the
      // screen was about to navigate away with nothing saved. Keep it open and
      // say so, mirroring contribution-form's established Alert pattern.
      Alert.alert(t('forms.fields.saveErrorTitle'), t('forms.fields.saveErrorMessage'));
    }
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/forms/account-form --no-coverage`
Expected: PASS. Run the full file to confirm no regression:
`npx jest src/screens/forms/account-form --no-coverage` (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/screens/forms/account-form src/i18n/locales/en.ts src/i18n/locales/uk.ts
git commit -m "fix(forms): surface an alert instead of swallowing an account save failure"
```

- [ ] **Step 6 (kiko:reviewer): review.** Confirm the `try` wraps exactly
  the write paths (not the `!canSave` guard above it), confirm the
  `ensureAccount`/Connect fields are untouched (Global Constraint), confirm
  import order and the new `forms.fields` keys sit alphabetically. Run
  `make gate`.

## Task 4: `holding-form` — stop swallowing a write failure

**Files:**
- Modify: `src/screens/forms/holding-form/holding-form.screen.tsx`
- Modify: `src/screens/forms/holding-form/holding-form.screen.test.tsx`

**Interfaces:**
- Consumes: `forms.fields.saveErrorTitle` / `forms.fields.saveErrorMessage`
  from Task 3 (already added to both locale files — no new i18n keys here).

- [ ] **Step 1: Write the failing test.** Add inside the existing
  `describe('HoldingFormScreen save validation', ...)` block:

```tsx
  it('surfaces an alert and does not navigate when the create fails', async () => {
    createMock.mockRejectedValueOnce(new Error('boom'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const screen = await renderScreen();
    await fillTermDepositFields(screen);
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.'));
    expect(navigation.goBack).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
```

Add `Alert` to the test file's top-level import from `react-native`:

```tsx
import { Alert } from 'react-native';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/forms/holding-form/holding-form.screen.test.tsx --no-coverage`
Expected: FAIL — `alertSpy` is never called.

- [ ] **Step 3: Write minimal implementation.** In
  `holding-form.screen.tsx`, add the import (external-package group, by
  length — verify placement against the file's other imports by hand,
  since import order is not Biome-checked):

```tsx
import { Alert } from 'react-native';
```

Wrap `save()`'s body in `try`/`catch`, keeping the existing early-return
guard (`if (type === 'term_deposit' && metadata === undefined) { return; }`)
OUTSIDE the `try` (it is a validation short-circuit, not a write):

```tsx
  const save = async (): Promise<void> => {
    const metadata = buildMetadata();

    // A term deposit with no valid contribution is invalid input: do not persist it.
    if (type === 'term_deposit' && metadata === undefined) {
      return;
    }

    try {
      if (isEdit && holdingId !== undefined) {
        await holdingsRepo.updateWithBalanceDelta(
          holdingId,
          buildHoldingPatch({
            name,
            color,
            type,
            currency,
            openingBalance,
            metadata,
            isSynced: isSyncedEdit,
          }),
          Date.now(),
        );

        await holdingsRepo.setIcon(holdingId, icon);

        navigation.goBack();

        return;
      }

      const newHoldingId = await holdingsRepo.create({
        accountId,
        name,
        type,
        currency,
        balanceMinorUnits: Money.fromMajor(currency, parseAmount(openingBalance) || 0).minorUnits,
        metadata,
        color,
      });

      if (icon !== null) {
        await holdingsRepo.setIcon(newHoldingId, icon);
      }

      navigation.goBack();
    } catch {
      // Mirrors contribution-form's and account-form's Alert pattern: a write
      // failure keeps the screen open with the entered values intact, rather
      // than navigating away as if nothing was wrong.
      Alert.alert(t('forms.fields.saveErrorTitle'), t('forms.fields.saveErrorMessage'));
    }
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/forms/holding-form/holding-form.screen.test.tsx --no-coverage`
Expected: PASS. Also run
`npx jest src/screens/forms/holding-form --no-coverage` (all three
holding-form test files) to confirm no regression.

- [ ] **Step 5: Commit**

```bash
git add src/screens/forms/holding-form
git commit -m "fix(forms): surface an alert instead of swallowing a holding save failure"
```

- [ ] **Step 6 (kiko:reviewer): review.** Confirm the `try` starts AFTER
  the `metadata === undefined` guard (that guard is validation, not a
  write — moving it inside the `try` would change behavior on a term
  deposit with no contributions, which must still silently no-op per the
  existing comment). Run `make gate`.

## Task 5: `holding-form` — inline reason for an invalid term deposit

**Files:**
- Modify: `src/screens/forms/holding-form/holding-form.screen.tsx`
- Modify: `src/screens/forms/holding-form/holding-form.screen.test.tsx`
- Modify: `src/i18n/locales/en.ts` (`forms.holding` block)
- Modify: `src/i18n/locales/uk.ts` (`forms.holding` block)

**Interfaces:**
- Consumes: `FieldError` from Task 1.
- Produces: `termDepositReasonKey` — a local closure inside
  `HoldingFormScreen`, next to the existing `isTermDepositValid` (same
  file), returning `string | null` (an i18n key or `null`). Not exported —
  Task 6 defines its own sibling `bondReasonKey`, not a shared helper (the
  two forms' fields don't overlap).

- [ ] **Step 1: Write the failing test.** Add inside
  `describe('HoldingFormScreen save validation', ...)`, next to the
  existing term-deposit tests:

```tsx
  it('shows an inline reason for a term deposit missing its contribution, rate, and term', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));
    await fill(screen, 'Name', 'My deposit');

    expect(screen.getByText('Add at least one contribution with an amount and a date.')).toBeTruthy();
  });

  it('shows the rate reason once a contribution is set but the rate is missing', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 Amount', '1000');
    await pickDate(screen, 'Contribution 1 Date', 2026, 1, 1);

    expect(screen.getByText('Enter a rate of 0 or higher.')).toBeTruthy();
  });

  it('shows the term reason once the rate is set but the term is missing', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 Amount', '1000');
    await pickDate(screen, 'Contribution 1 Date', 2026, 1, 1);
    await fill(screen, 'Annual Rate %', '12');

    expect(screen.getByText('Enter a whole number of months greater than 0.')).toBeTruthy();
  });

  it('shows no term-deposit reason once every field is valid', async () => {
    const screen = await renderScreen();

    await fillTermDepositFields(screen);

    expect(screen.queryByText('Add at least one contribution with an amount and a date.')).toBeNull();
    expect(screen.queryByText('Enter a rate of 0 or higher.')).toBeNull();
    expect(screen.queryByText('Enter a whole number of months greater than 0.')).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/forms/holding-form/holding-form.screen.test.tsx --no-coverage`
Expected: FAIL — none of the three reason strings render yet.

- [ ] **Step 3: Write minimal implementation.** In
  `src/i18n/locales/en.ts`, inside `forms.holding`, add (alphabetically):

```ts
      annualRateError: 'Enter a rate of 0 or higher.',
```

between `annualRatePlaceholder` and `balance`, and:

```ts
      contributionsRequiredError: 'Add at least one contribution with an amount and a date.',
```

between `contributions` and `corporate`, and:

```ts
      termMonthsError: 'Enter a whole number of months greater than 0.',
```

between `termMonthsPlaceholder` and `terms`.

In `src/i18n/locales/uk.ts`, same positions:

```ts
      annualRateError: 'Введіть ставку 0 або вище.',
      contributionsRequiredError: 'Додайте щонайменше один внесок із сумою та датою.',
      termMonthsError: 'Введіть цілу кількість місяців більше 0.',
```

In `holding-form.screen.tsx`, add the `FieldError` import (design-system
group, alongside the file's other `../../../design-system/components/*`
imports), and add `termDepositReasonKey` right after the existing
`isTermDepositValid`:

```tsx
  // The reason `isTermDepositValid` above is false, for the SAME checks in
  // the SAME priority order — so the two can never disagree. `null` once
  // every check passes. Not gated on whether the name is filled: the name's
  // own required asterisk covers that separately.
  const termDepositReasonKey = (): string | null => {
    if (parsedContributions().length === 0) {
      return 'forms.holding.contributionsRequiredError';
    }

    const rate = parseAmount(annualRate);

    if (annualRate.trim() === '' || !(rate >= 0)) {
      return 'forms.holding.annualRateError';
    }

    const months = parseAmount(termMonths);

    if (!(Number.isInteger(months) && months > 0)) {
      return 'forms.holding.termMonthsError';
    }

    return null;
  };
```

Compute it once above the `return`, alongside `isValid` (note the variable
`termDepositReason` and the function `termDepositReasonKey` are distinct
names — the variable holds the function's result):

```tsx
  const termDepositReason = type === 'term_deposit' ? termDepositReasonKey() : null;
```

Render it as the last child of the term-deposit `Box`, after the
`Compounding` `ChipRow` and before that `Box`'s closing tag:

```tsx
            <ChipRow
              label={t('forms.holding.compounding')}
              options={compoundingOptions}
              selected={compounding}
              onSelect={setCompounding}
              labels={compoundingLabels}
            />

            {termDepositReason !== null && <FieldError message={t(termDepositReason)} />}
          </Box>
        )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/forms/holding-form/holding-form.screen.test.tsx --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/forms/holding-form src/i18n/locales/en.ts src/i18n/locales/uk.ts
git commit -m "feat(forms): inline reason for an invalid term deposit"
```

- [ ] **Step 6 (kiko:reviewer): review.** Confirm `termDepositReasonKey`'s
  branch order matches `isTermDepositValid` exactly (a drift between the two
  would disable Save for one reason while displaying another). Run
  `make gate`.

## Task 6: `holding-form` — inline reason for an invalid bond

**Files:**
- Modify: `src/screens/forms/holding-form/holding-form.screen.tsx`
- Modify: `src/screens/forms/holding-form/holding-form.screen.test.tsx`
- Modify: `src/i18n/locales/en.ts` (`forms.holding` block)
- Modify: `src/i18n/locales/uk.ts` (`forms.holding` block)

**Interfaces:**
- Consumes: `FieldError` from Task 1 (already imported in this file by Task 5).

- [ ] **Step 1: Write the failing test.** Add inside
  `describe('HoldingFormScreen save validation', ...)`:

```tsx
  it('shows the quantity reason for a bond missing its numeric fields', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Bond'));
    await fill(screen, 'Name', 'My bond');

    expect(screen.getByText('Enter a quantity greater than 0.')).toBeTruthy();
  });

  it('shows the face-value reason once quantity is set but face value is missing', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Bond'));
    await fill(screen, 'Name', 'My bond');
    await fill(screen, 'Quantity', '10');

    expect(screen.getByText('Enter a face value greater than 0.')).toBeTruthy();
  });

  it('shows the maturity-date reason when maturity is not after purchase', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Bond'));
    await fill(screen, 'Name', 'My bond');
    await fill(screen, 'Quantity', '10');
    await fill(screen, 'Face Value', '1000');
    await fill(screen, 'Coupon %', '9');
    await pickDate(screen, 'Purchase Date', 2026, 1, 1);
    await pickDate(screen, 'Maturity Date', 2026, 1, 1);

    expect(screen.getByText('Maturity date must be after the purchase date.')).toBeTruthy();
  });

  it('shows no bond reason once every field and date is valid', async () => {
    const screen = await renderScreen();

    await fillBondFields(screen);

    expect(screen.queryByText('Enter a quantity greater than 0.')).toBeNull();
    expect(screen.queryByText('Enter a face value greater than 0.')).toBeNull();
    expect(screen.queryByText('Enter a coupon of 0 or higher.')).toBeNull();
    expect(screen.queryByText('Maturity date must be after the purchase date.')).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/forms/holding-form/holding-form.screen.test.tsx --no-coverage`
Expected: FAIL — none of the four reason strings render yet.

- [ ] **Step 3: Write minimal implementation.** In
  `src/i18n/locales/en.ts`, inside `forms.holding`, add (alphabetically):

```ts
      couponPctError: 'Enter a coupon of 0 or higher.',
```

between `couponPct` and `couponPlaceholder`, and:

```ts
      faceValueError: 'Enter a face value greater than 0.',
```

between `faceValue` and `faceValuePlaceholder`, and:

```ts
      maturityDateError: 'Maturity date must be after the purchase date.',
```

between `maturityDate` and `monthly`, and:

```ts
      quantityError: 'Enter a quantity greater than 0.',
```

between `quantity` and `quantityPlaceholder`.

In `src/i18n/locales/uk.ts`, same positions:

```ts
      couponPctError: 'Введіть купон 0 або вище.',
      faceValueError: 'Введіть номінальну вартість більше 0.',
      maturityDateError: 'Дата погашення має бути пізніше дати придбання.',
      quantityError: 'Введіть кількість більше 0.',
```

In `holding-form.screen.tsx`, add `bondReasonKey` right after the existing
`isBondValid`:

```tsx
  // The reason `isBondValid` above is false, for the SAME checks in the
  // SAME priority order. A missing (not-yet-picked) date is already covered
  // by that field's own required asterisk, so this returns null rather than
  // a redundant "pick a date" line until BOTH dates are set — only then does
  // an invalid ORDER between them get its own reason.
  const bondReasonKey = (): string | null => {
    if (!(parseAmount(quantity) > 0)) {
      return 'forms.holding.quantityError';
    }

    if (!(parseAmount(faceValue) > 0)) {
      return 'forms.holding.faceValueError';
    }

    if (couponPct.trim() === '' || !(parseAmount(couponPct) >= 0)) {
      return 'forms.holding.couponPctError';
    }

    if (purchaseDate !== null && maturityDate !== null && maturityDate <= purchaseDate) {
      return 'forms.holding.maturityDateError';
    }

    return null;
  };
```

Compute it once above the `return`, next to `termDepositReason`:

```tsx
  const bondReason = type === 'bond' ? bondReasonKey() : null;
```

Render it as the last child of the bond `Box`, after the `Coupon frequency`
`ChipRow` and before that `Box`'s closing tag:

```tsx
            <ChipRow
              label={t('forms.holding.couponFrequency')}
              options={couponFrequencies}
              selected={couponFrequency}
              onSelect={setCouponFrequency}
              labels={couponFrequencyLabels}
            />

            {bondReason !== null && <FieldError message={t(bondReason)} />}
          </Box>
        )}
      </Box>
    </Screen>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/forms/holding-form/holding-form.screen.test.tsx --no-coverage`
Expected: PASS. Then run the full holding-form suite:
`npx jest src/screens/forms/holding-form --no-coverage`.

- [ ] **Step 5: Commit**

```bash
git add src/screens/forms/holding-form src/i18n/locales/en.ts src/i18n/locales/uk.ts
git commit -m "feat(forms): inline reason for an invalid bond"
```

- [ ] **Step 6 (kiko:reviewer): review.** Confirm `bondReasonKey`'s branch
  order matches `isBondValid` exactly. Run `make gate`.

## Task 7: `transaction-form` — stop swallowing a write failure

**Files:**
- Modify: `src/screens/forms/transaction-form/transaction-form.screen.tsx`
- Modify: `src/screens/forms/transaction-form/transaction-form.screen.test.tsx`

**Interfaces:**
- Consumes: `forms.fields.saveErrorTitle` / `forms.fields.saveErrorMessage`
  from Task 3 (already in both locale files — no new i18n keys here).

- [ ] **Step 1: Write the failing test.** Add inside
  `describe('TransactionFormScreen — add mode', ...)`:

```tsx
  it('surfaces an alert and does not navigate when the write fails', async () => {
    mockRecordManual.mockRejectedValueOnce(new Error('boom'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const utils = await renderAdd();
    const { getByLabelText, getByText, navigation } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '12.34');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.'));
    expect(navigation.goBack).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
```

Add `Alert` to this test file's `react-native` import at the top:

```tsx
import { Alert, StyleSheet } from 'react-native';
```

(replacing the existing `import { StyleSheet } from 'react-native';` —
`Alert` sorts before `StyleSheet` inside the braces, value imports first,
alphabetically among values here).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/forms/transaction-form --no-coverage -t "surfaces an alert"`
Expected: FAIL — `alertSpy` is never called.

- [ ] **Step 3: Write minimal implementation.** In
  `transaction-form.screen.tsx`, add the import (external-package group;
  the file already imports `type { ScrollViewInstance } from 'react-native'`
  — merge into one mixed import: value first, then the `type` member):

```tsx
import { Alert, type ScrollViewInstance } from 'react-native';
```

Wrap `save()`'s body in `try`/`catch`:

```tsx
  const save = async (): Promise<void> => {
    try {
      if (await dispatchSpecialSave()) {
        return;
      }

      // A synced row is bank-owned: only its category may change, so skip the
      // amount write entirely and fall through to the category confirm below.
      if (!isReadOnly && !(await tryWriteManual())) {
        return;
      }

      // The rule keys on the synced row's own description (read-only) or the
      // just-saved manual description.
      const name = isReadOnly ? (existing?.description ?? '') : description;
      const overrideRequest = resolveCategoryOverrideRequest(categoryChanged, selectedCategory, name);

      if (overrideRequest) {
        setPendingOverride(overrideRequest);

        return;
      }

      // No propagation sheet will open — the normalized name is blank (a synced
      // Binance/wallet row imports with an empty description), or the row is
      // synced so `writeManual`'s `update` refused to persist its category. Write
      // the picked category straight onto THIS row by id via the ungated
      // `setCategory`, so a category change on an existing row is never dropped.
      // This is the single-row writer only; the blank-name guard on the name RULE
      // path (`resolveCategoryOverrideRequest` -> `upsertCategoryOverride`) stays
      // intact, so a catch-all rule is still refused. A create (no `editingId`)
      // already carries its category from `recordManual`, so it is excluded.
      if (editingId !== null && categoryChanged && selectedCategory !== null) {
        await transactionsRepo.setCategory({
          transactionId: editingId,
          category: selectedCategory,
        });
      }

      navigation.goBack();
    } catch {
      // Every write above — recordManual/recordManualWithReturns/recordExchange/
      // recordExchangeCounterpart/update/setCategory — used to escape unhandled:
      // the screen just silently failed to navigate, with Save re-enabled and
      // no explanation. Mirror the established Alert pattern instead.
      Alert.alert(t('forms.fields.saveErrorTitle'), t('forms.fields.saveErrorMessage'));
    }
  };
```

Then wrap `applyOverride` and `applyOverrideOne` the same way (both are
independent write actions reachable from the category-propagation sheet,
each with its own `useSubmitOnce`):

```tsx
  const applyOverride = async (): Promise<void> => {
    if (pendingOverride === null) {
      return;
    }

    try {
      await categoryOverridesRepo.upsertCategoryOverride(
        pendingOverride.name,
        pendingOverride.category,
      );
      navigation.goBack();
    } catch {
      Alert.alert(t('forms.fields.saveErrorTitle'), t('forms.fields.saveErrorMessage'));
    }
  };
```

```tsx
  const applyOverrideOne = async (): Promise<void> => {
    if (pendingOverride === null || editingId === null) {
      return;
    }

    try {
      await transactionsRepo.setCategory({
        transactionId: editingId,
        category: pendingOverride.category,
      });
      navigation.goBack();
    } catch {
      Alert.alert(t('forms.fields.saveErrorTitle'), t('forms.fields.saveErrorMessage'));
    }
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/forms/transaction-form --no-coverage -t "surfaces an alert"`
Expected: PASS. Then run the full file:
`npx jest src/screens/forms/transaction-form --no-coverage` (2650+ lines of
existing tests — confirm zero regressions, since this touches the shared
`save`/`applyOverride`/`applyOverrideOne` entry points every mode routes
through).

- [ ] **Step 5: Commit**

```bash
git add src/screens/forms/transaction-form
git commit -m "fix(forms): surface an alert instead of swallowing a transaction save failure"
```

- [ ] **Step 6 (kiko:reviewer): review.** Confirm all three `try` blocks
  wrap ONLY their write(s) + `navigation.goBack()`, never the validation
  guards above them (`dispatchSpecialSave`'s own internal guards stay
  as-is — they already return early with no write on invalid input). Run
  `make gate`.

## Task 8: `transaction-form` — inline "why is Save disabled" reason

**Files:**
- Modify: `src/screens/forms/transaction-form/transaction-form.screen.tsx`
- Modify: `src/screens/forms/transaction-form/transaction-form.screen.test.tsx`
- Modify: `src/i18n/locales/en.ts` (`forms.transaction` block)
- Modify: `src/i18n/locales/uk.ts` (`forms.transaction` block)

**Interfaces:**
- Consumes: `FieldError` from Task 1; the existing `SaveDisabledParams` type
  and `isPositiveAmountText`/`canSaveSplit` helpers (module-level, same
  file).
- Produces: `saveDisabledReason(params: SaveDisabledParams, t: TFunction):
  string | null` — module-level, mirroring the existing module-level
  `resolveDescriptionPlaceholder(holding, mode, t)`'s `t: TFunction` pattern
  in this same file.

- [ ] **Step 1: Write the failing test.** Add four tests, one per mode,
  each next to that mode's existing "disables Save" test:

In `describe('TransactionFormScreen — add mode', ...)`, next to
`'disables Save for a zero amount'`:

```tsx
  it('shows an inline reason for a fresh add missing amount and category', async () => {
    const utils = await renderAdd();

    expect(utils.getByText('Enter an amount greater than 0.')).toBeTruthy();

    await fireEvent.changeText(utils.getByLabelText('Amount'), '12.34');
    expect(utils.queryByText('Enter an amount greater than 0.')).toBeNull();
    expect(utils.getByText('Select a category.')).toBeTruthy();

    await pickCategory(utils, 'Groceries');
    expect(utils.queryByText('Select a category.')).toBeNull();
  });
```

In `describe('TransactionFormScreen — Exchange mode', ...)`, next to
`'disables Save until a destination and both positive amounts are set'`:

```tsx
  it('shows an inline reason through the Exchange steps', async () => {
    const utils = await renderAddFromHolding('cash-1');
    await pickType(utils, 'exchange');

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

In `describe('TransactionFormScreen — Convert to Exchange', ...)`, next to
`'disables Save until a counterpart holding and a positive amount are set'`:

```tsx
  it('shows an inline reason through the Convert steps', async () => {
    const utils = await renderEdit('expense-manual');
    await fireEvent.press(utils.getByText('Convert to exchange'));

    expect(utils.getByText('Select an account to convert into.')).toBeTruthy();

    await fireEvent.press(utils.getByLabelText('To'));
    await fireEvent.press(utils.getByText('Cash USD'));
    expect(utils.getByText('Enter an amount greater than 0.')).toBeTruthy();

    await fireEvent.changeText(utils.getByLabelText('Value In'), '2.5');
    expect(utils.queryByText('Enter an amount greater than 0.')).toBeNull();
  });
```

In `describe('TransactionFormScreen — Split-change mode', ...)`, next to
`'disables Save while the returns sum to at least the payment'`:

```tsx
  it('shows an inline reason for an incomplete split', async () => {
    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');

    expect(utils.getByText('Select a category.')).toBeTruthy();

    await pickCategory(utils, 'Groceries');
    expect(utils.getByText('Enter a payment amount and at least one valid return.')).toBeTruthy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/forms/transaction-form --no-coverage -t "shows an inline reason"`
Expected: FAIL — none of these strings render yet.

- [ ] **Step 3: Write minimal implementation.** In
  `src/i18n/locales/en.ts`, inside `forms.transaction`, add
  (alphabetically):

```ts
      amountError: 'Enter an amount greater than 0.',
```

right after `addTitle`, before `amountPlaceholder`, and:

```ts
      counterpartAmountError: 'Enter an amount greater than 0.',
```

between `convertToExchange`... actually alphabetically `counterpartAmountError`
sorts before `convertAmountPlaceholder` (`counterp` < `convertA`), so insert it
between `category` and `convertAmountPlaceholder`, and:

```ts
      selectCategoryError: 'Select a category.',
      selectCounterpartError: 'Select an account to convert into.',
      selectDestinationError: 'Select a destination account.',
```

between `selectHolding` and `split` (alphabetically: `selectCategoryError`,
`selectCounterpartError`, `selectDestinationError`, `selectHolding`, `split`
— re-sort so all four `select*` keys are contiguous and alphabetical), and:

```ts
      splitInvalidError: 'Enter a payment amount and at least one valid return.',
```

between `split` and `syncedNotice`, and:

```ts
      valueInError: 'Enter a Value In greater than 0.',
      valueOutError: 'Enter a Value Out greater than 0.',
```

right before `valueIn`/`valueOut` respectively (alphabetically `valueInError`
< `valueInPlaceholder`, `valueOutError` < `valueOutPlaceholder`).

In `src/i18n/locales/uk.ts`, the same keys at the same positions:

```ts
      amountError: 'Введіть суму більше 0.',
      counterpartAmountError: 'Введіть суму більше 0.',
      selectCategoryError: 'Оберіть категорію.',
      selectCounterpartError: 'Оберіть рахунок для конвертації.',
      selectDestinationError: 'Оберіть рахунок призначення.',
      splitInvalidError: 'Введіть суму платежу та щонайменше одне коректне повернення.',
      valueInError: 'Введіть суму «Отримано» більше 0.',
      valueOutError: 'Введіть суму «Віддано» більше 0.',
```

In `transaction-form.screen.tsx`, add the `FieldError` import next to the
other `design-system/components/*` imports, and add `saveDisabledReason`
right after the existing `isSaveDisabled` function:

```tsx
// The reason `isSaveDisabled` above returns true, for the SAME branches in
// the SAME priority order, so the two can never disagree — a drift here
// would disable Save for one reason while explaining another. `t` is
// threaded in explicitly, the same way `resolveDescriptionPlaceholder`
// above takes it, so this stays a pure module-level helper.
const saveDisabledReason = (params: SaveDisabledParams, t: TFunction): string | null => {
  if (params.converting) {
    if (params.counterpartHoldingId === null) {
      return t('forms.transaction.selectCounterpartError');
    }

    return isPositiveAmountText(params.counterpartAmount)
      ? null
      : t('forms.transaction.counterpartAmountError');
  }

  if (params.isExchange) {
    if (params.destinationHoldingId === null) {
      return t('forms.transaction.selectDestinationError');
    }

    if (!isPositiveAmountText(params.amount)) {
      return t('forms.transaction.valueOutError');
    }

    return isPositiveAmountText(params.valueIn) ? null : t('forms.transaction.valueInError');
  }

  if (params.isSplit) {
    if (params.selectedCategory === null) {
      return t('forms.transaction.selectCategoryError');
    }

    return canSaveSplit(params.amount, params.changeReturns, params.currency)
      ? null
      : t('forms.transaction.splitInvalidError');
  }

  if (params.isReadOnly) {
    return null;
  }

  if (params.isEditing) {
    return isPositiveAmountText(params.amount) ? null : t('forms.transaction.amountError');
  }

  if (!isPositiveAmountText(params.amount)) {
    return t('forms.transaction.amountError');
  }

  return params.selectedCategory === null ? t('forms.transaction.selectCategoryError') : null;
};
```

Replace the `disableSave` construction so both helpers share one params
object:

```tsx
  const saveDisabledParams: SaveDisabledParams = {
    converting,
    isExchange,
    isSplit,
    isReadOnly,
    isEditing,
    amount,
    valueIn,
    counterpartAmount,
    destinationHoldingId,
    counterpartHoldingId,
    selectedCategory,
    changeReturns,
    currency,
  };
  const disableSave = isSaveDisabled(saveDisabledParams);
  const disableSaveReason = disableSave ? saveDisabledReason(saveDisabledParams, t) : null;
```

Render it in the footer, wrapping the existing `Button` in a `Box` (the
same `footer={<Box>...}` shape `account-detail.screen.tsx` and
`accounts.screen.tsx` already use):

```tsx
        footer={
          showsSaveButton(isReadOnly, categoryChanged, converting) ? (
            <Box gap={2}>
              {disableSaveReason !== null && !isSubmitting && (
                <FieldError message={disableSaveReason} testID="transaction-save-reason" />
              )}

              <Button onPress={onSave} disabled={disableSave || isSubmitting}>
                {t('common.save')}
              </Button>
            </Box>
          ) : undefined
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/forms/transaction-form --no-coverage -t "shows an inline reason"`
Expected: PASS. Then run the full file:
`npx jest src/screens/forms/transaction-form --no-coverage` — every
existing `disableSave`/`isSaveDisabled`-adjacent test must still pass
unchanged (this task adds text, it doesn't change `disableSave`'s value).

- [ ] **Step 5: Commit**

```bash
git add src/screens/forms/transaction-form src/i18n/locales/en.ts src/i18n/locales/uk.ts
git commit -m "feat(forms): inline reason for a disabled transaction Save"
```

- [ ] **Step 6 (kiko:reviewer): review.** Confirm `saveDisabledReason`'s
  branch order and conditions are IDENTICAL to `isSaveDisabled`'s (side by
  side, not from memory). Confirm the new `forms.transaction` keys are
  alphabetically placed in both locale files (a merge conflict with the
  parallel export/import track's own `en.ts`/`uk.ts` edits is the risk this
  guards against). Run `make gate`.

## Task 9: Final verification

**Files:** none (verification only).

- [ ] **Step 1:** Run `make verify` (lint, full Jest, gate) from the repo
  root. Expected: PASS, zero failures across all 8 form-related test files
  plus the rest of the suite.
- [ ] **Step 2:** Diff `src/i18n/locales/en.ts` against `uk.ts` key-by-key
  (`node -e "..."` or by eye) to confirm every new key from Tasks 2, 3, 5,
  6, and 8 exists in BOTH files with no typo'd key name.
- [ ] **Step 3:** `git diff main...HEAD --stat` (or the equivalent against
  this branch's base) to confirm `src/data-transfer/` and every Settings
  export/import screen show zero changes (Global Constraint).
- [ ] **Step 4:** Run `make deep` (mutation testing + osv-scanner) from the
  repo root. Expected: mutation score at or above the current break
  threshold on the files this plan touched; osv-scanner shows only the
  already-accepted, documented CVEs (`image-size`, `decode-uri-component`
  per `docs/harness/dependency-hygiene.md`) — no new ones.
- [ ] **Step 5 (kiko:reviewer): final pass.** Re-read all 8 diffs
  together (Tasks 1–8) against the Global Constraints section at the top of
  this plan, specifically: no touch to `MonobankConnectField`/
  `WalletAddressField`/`BinanceCredentialsField`/`CryptoSyncForm`/
  `ensureAccount`, no touch to `src/data-transfer/`, and every reason-line
  helper's branch order matches its boolean twin.
