# Explicit "Connect Monobank" Button (Bank Create Form) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit, per-source "Connect Monobank" button to the bank CREATE form so the user validates and connects their token in place (with visible status), instead of an implicit, error-swallowing connect that only runs on the footer Save.

**Architecture:** Port the crypto create flow's explicit-Connect pattern to the Monobank field. Introduce one new leaf component, `MonobankConnectField` (token input + Connect button + live status), modeled on `WalletAddressField` and the account-detail `MonobankTokenField`. Generalize the screen's existing crypto id-reconciliation machinery (`pendingCryptoAccountId` + `ensureCryptoAccount` + `cryptoRowStarted`) into a kind-agnostic form so the bank kind reuses the SAME create-first / one-shot-insert latch — no second copy. The old on-Save `connectEnteredCredentials` path is removed; bank and crypto Save branches collapse into one shared branch.

**Tech Stack:** React Native, TypeScript, react-i18next, `react-native-keychain` (via `src/monobank/token`), `useSync`, Jest + React Native Testing Library.

**Spec:** This plan (derived from the coordinator's feature brief, 2026-09-14). No separate design doc.

## Global Constraints

These are binding for EVERY task below (each task's requirements implicitly include this section):

1. **Reuse and GENERALIZE the existing id-reconciliation machinery (`pendingCryptoAccountId` + `ensureCryptoAccount`) for the bank kind. Do not hand-roll a second copy.** (See memory rule "Create-time id reconciliation for shared forms".)
2. **Preserve write-only secret handling: validate the token live, then store, then sync, with a visible status. The token is a secret. It goes to the iOS Keychain, never to `.env`, the database, or a log.**
3. **Keep minimum iOS 16.**
4. **Follow TDD: the plan must sequence tests before implementation.**

Also honor the repo harness standing rule: fix the underlying issue, never weaken a check. Run `npm run check:all` at each task's checkpoint and `npm run check:deep` once before declaring the feature done.

---

## File map

- **Create:** `src/screens/account-detail/monobank-connect-field/monobank-connect-field.component.tsx` — the new field (input + Connect button + status).
- **Create:** `src/screens/account-detail/monobank-connect-field/index.ts` — barrel re-export.
- **Create:** `src/screens/account-detail/monobank-connect-field/monobank-connect-field.component.test.tsx` — colocated test.
- **Modify:** `src/i18n/locales/en.ts` and `src/i18n/locales/uk.ts` — add one new key `couldNotConnectMonobank`.
- **Modify:** `src/screens/forms/account-form.screen.tsx` — generalize the machinery, wire the new field, remove the implicit-on-Save connect.
- **Modify:** `src/screens/forms/account-form.screen.test.tsx` — cover the new create-first / no-duplicate / secret-stays-in-field wiring for bank.

Reference-only (read, do not edit):
- `src/screens/account-detail/wallet-address-field/wallet-address-field.component.tsx` — the per-source Connect-button + status shape to mirror.
- `src/screens/account-detail/monobank-token-field/monobank-token-field.component.tsx` — the `fetchClientInfo` → `connectedAs {name}` / `invalidToken` validation shape.
- `src/screens/account-detail/monobank-token-input/monobank-token-input.component.tsx` — the shared presentational token entry surface the new field wraps.
- `src/screens/account-detail/sync-status-line/sync-status-line.component.tsx` — the `SyncStatus` union and its rendering.
- `src/monobank/token/token.ts` — `saveToken(accountId, token)`.
- `src/sync/use-sync/use-sync.ts` — `useSync().sync(targetAccountId?) => Promise<boolean>`.

**Existing i18n keys to REUSE (already present in en + uk, do not re-add):** `accountDetail.connectMonobank` ("Connect Monobank"), `accountDetail.connectedAs` ("Connected as {{name}}"), `accountDetail.invalidToken` ("Invalid token"), `accountDetail.synchronization`, `forms.account.nameRequiredForSync`.

---

### Task 1: New i18n key `couldNotConnectMonobank`

The Connect button's failure status (a validated token that could not be stored/synced) needs a message, matching the existing `couldNotConnectWallet` / `couldNotConnectBinance` pair. Success reuses the existing `connectedAs` key; invalid reuses `invalidToken`. Only this one key is new.

**Files:**
- Modify: `src/i18n/locales/en.ts` (near `couldNotConnectBinance` / `couldNotConnectWallet`, currently ~lines 273-274)
- Modify: `src/i18n/locales/uk.ts` (same `accountDetail` block)
- Test: `src/screens/account-detail/monobank-connect-field/monobank-connect-field.component.test.tsx` (added in Task 2 — the key's real consumer is asserted there); this task's own verification is the `en`/`uk` structural parity tests that already run under Jest (`src/i18n/locales/*.test.ts`).

**Interfaces:**
- Produces: `t('accountDetail.couldNotConnectMonobank')` resolving to `'Could not connect Monobank'` (en) / a Ukrainian equivalent (uk).

- [ ] **Step 1: Confirm the failing/red state**

Run the existing i18n parity suite to confirm current green, then reason about the gap:

Run: `npx jest src/i18n/locales --silent`
Expected: PASS now. After Task 2's test references `couldNotConnectMonobank`, a missing key would surface there; the en/uk parity test also fails if one locale has the key and the other does not — that asymmetry is the guard this step relies on.

- [ ] **Step 2: Add the key to `en.ts`**

In the `accountDetail` object, immediately after `couldNotConnectBinance` / `couldNotConnectWallet`:

```ts
    couldNotConnectMonobank: 'Could not connect Monobank',
```

- [ ] **Step 3: Add the parallel key to `uk.ts`**

In the same `accountDetail` block:

```ts
    couldNotConnectMonobank: 'Не вдалося підключити Monobank',
```

- [ ] **Step 4: Run the locale suite**

Run: `npx jest src/i18n/locales --silent`
Expected: PASS (en/uk structural parity holds with the new key present in both).

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/en.ts src/i18n/locales/uk.ts
git commit -m "i18n(account-detail): add couldNotConnectMonobank status key"
```

---

### Task 2: `MonobankConnectField` component

A self-contained "connect Monobank" field: it wraps the shared `MonobankTokenInput` (link + secure token field + paste icon), adds a `secondaryTonal` `small` Connect button and a `SyncStatusLine`, validates the token live with `fetchClientInfo`, and reports outcome. It owns NO account id and NO Keychain write — it hands the validated token up through `onConnect`, mirroring `WalletAddressField` (which hands the address up and holds no secret). This keeps the secret's storage in the screen's closure keyed by the pre-generated id (Global Constraint 2).

**Files:**
- Create: `src/screens/account-detail/monobank-connect-field/monobank-connect-field.component.tsx`
- Create: `src/screens/account-detail/monobank-connect-field/index.ts`
- Test: `src/screens/account-detail/monobank-connect-field/monobank-connect-field.component.test.tsx`

**Interfaces:**
- Consumes: `MonobankTokenInput` (default export, props `{ value: string; onChangeText: (v: string) => void }`); `fetchClientInfo(token) => Promise<{ name: string }>` from `../../../monobank/client`; `SyncStatusLine` default + `SyncStatus` type from `../sync-status-line`; `styles.statusLine` from `../account-detail.styles`; `Button` (`variant="secondaryTonal"`, `size="small"`, `fullWidth={false}`, `icon`).
- Produces: default export `MonobankConnectField`, props:
  ```ts
  type MonobankConnectFieldProps = {
    // Runs the connect: store the validated token to the Keychain (keyed by the
    // account id the screen owns) and start the first Monobank sync. Resolves
    // whether it succeeded. The field passes the RAW token here and holds it only
    // for the duration of this call — never to the DB or a log (Global Constraint 2).
    onConnect: (token: string) => Promise<boolean>;
  };
  ```

- [ ] **Step 1: Write the failing test**

`src/screens/account-detail/monobank-connect-field/monobank-connect-field.component.test.tsx`:

```tsx
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import { i18n } from '../../../i18n';

import MonobankConnectField from './monobank-connect-field.component';

const mockFetchClientInfo = jest.fn();
jest.mock('../../../monobank/client', () => ({
  fetchClientInfo: (...args: unknown[]) => mockFetchClientInfo(...args),
}));

const connectLabel = i18n.t('accountDetail.connectMonobank');

beforeEach(() => {
  jest.clearAllMocks();
});

const type = (view: ReturnType<typeof render>, value: string): void => {
  fireEvent.changeText(view.getByDisplayValue(''), value);
};

it('disables Connect until a non-blank token is entered', () => {
  const view = render(<MonobankConnectField onConnect={jest.fn()} />);
  expect(view.getByText(connectLabel).parent?.props.accessibilityState.disabled).toBe(true);
});

it('validates the token, then calls onConnect and shows "Connected as {name}" on success', async () => {
  mockFetchClientInfo.mockResolvedValue({ name: 'Ada Lovelace' });
  const onConnect = jest.fn().mockResolvedValue(true);
  const view = render(<MonobankConnectField onConnect={onConnect} />);

  type(view, '  tok-123  ');
  fireEvent.press(view.getByText(connectLabel));

  await waitFor(() => {
    expect(mockFetchClientInfo).toHaveBeenCalledWith('tok-123'); // trimmed
    expect(onConnect).toHaveBeenCalledWith('tok-123');
  });
  await waitFor(() =>
    expect(view.getByText(i18n.t('accountDetail.connectedAs', { name: 'Ada Lovelace' }))).toBeTruthy(),
  );
});

it('shows invalidToken and never calls onConnect when validation throws', async () => {
  mockFetchClientInfo.mockRejectedValue(new Error('401'));
  const onConnect = jest.fn();
  const view = render(<MonobankConnectField onConnect={onConnect} />);

  type(view, 'bad');
  fireEvent.press(view.getByText(connectLabel));

  await waitFor(() => expect(view.getByText(i18n.t('accountDetail.invalidToken'))).toBeTruthy());
  expect(onConnect).not.toHaveBeenCalled();
});

it('shows couldNotConnectMonobank when a valid token fails to store/sync', async () => {
  mockFetchClientInfo.mockResolvedValue({ name: 'Ada' });
  const onConnect = jest.fn().mockResolvedValue(false);
  const view = render(<MonobankConnectField onConnect={onConnect} />);

  type(view, 'tok');
  fireEvent.press(view.getByText(connectLabel));

  await waitFor(() =>
    expect(view.getByText(i18n.t('accountDetail.couldNotConnectMonobank'))).toBeTruthy(),
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/screens/account-detail/monobank-connect-field --silent`
Expected: FAIL — cannot resolve `./monobank-connect-field.component`.

- [ ] **Step 3: Write the component**

`src/screens/account-detail/monobank-connect-field/monobank-connect-field.component.tsx`:

```tsx
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';
import { fetchClientInfo } from '../../../monobank/client';
import { styles } from '../account-detail.styles';
import MonobankTokenInput from '../monobank-token-input';
import type { SyncStatus } from '../sync-status-line';
import SyncStatusLine from '../sync-status-line';

type MonobankConnectFieldProps = {
  // Runs the connect: store the validated token to the Keychain (keyed by the
  // account id the screen owns) and start the first Monobank sync. Resolves
  // whether it succeeded. The field passes the RAW token here and holds it only
  // for the duration of this call — never to the DB or a log.
  onConnect: (token: string) => Promise<boolean>;
};

// The bank-create counterpart of WalletAddressField: the shared MonobankTokenInput
// (link + secure token field + paste icon) plus an explicit Connect button and a
// live status line. It validates the token in place with fetchClientInfo (so it
// can show "Connected as {name}") and then hands the RAW token to `onConnect`,
// which stores it and starts the sync. The field owns no account id and writes no
// Keychain item itself — the secret's storage stays in the screen closure keyed by
// the pre-generated account id, so a validated-but-unstorable token surfaces as a
// `false` result here rather than an unhandled rejection.
const MonobankConnectField: FC<MonobankConnectFieldProps> = ({ onConnect }) => {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });

  const handleChangeToken = (value: string): void => {
    setToken(value);
    setStatus({ kind: 'idle' });
  };

  const handleConnect = (): void => {
    const trimmed = token.trim();
    setStatus({ kind: 'checking' });
    (async () => {
      let clientName: string;
      try {
        const clientInfo = await fetchClientInfo(trimmed);
        clientName = clientInfo.name;
      } catch {
        setStatus({ kind: 'invalid', message: t('accountDetail.invalidToken') });

        return;
      }

      const connected = await onConnect(trimmed);
      setStatus(
        connected
          ? { kind: 'success', message: t('accountDetail.connectedAs', { name: clientName }) }
          : { kind: 'saveError', message: t('accountDetail.couldNotConnectMonobank') },
      );
    })();
  };

  return (
    <Box gap={3}>
      <MonobankTokenInput value={token} onChangeText={handleChangeToken} />

      <Box direction="row" gap={2} style={styles.statusLine}>
        <Button
          variant="secondaryTonal"
          size="small"
          fullWidth={false}
          onPress={handleConnect}
          disabled={status.kind === 'checking' || token.trim() === ''}
          icon="link"
        >
          {t('accountDetail.connectMonobank')}
        </Button>

        <SyncStatusLine status={status} />
      </Box>
    </Box>
  );
};

export default MonobankConnectField;
```

`src/screens/account-detail/monobank-connect-field/index.ts`:

```ts
export { default } from './monobank-connect-field.component';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/screens/account-detail/monobank-connect-field --silent`
Expected: PASS (all four cases).

- [ ] **Step 5: Checkpoint + commit**

Run: `npm run check:all`
Expected: PASS (lint/knip/typecheck etc. clean; the new barrel is consumed in Task 3 — if `check:knip` flags the barrel as unused here, land Task 2 and Task 3 in a single commit so the consumer exists, rather than weakening the check).

```bash
git add src/screens/account-detail/monobank-connect-field
git commit -m "feat(account-detail): MonobankConnectField with live validation + status"
```

---

### Task 3: Wire the field into the bank create form; generalize the id machinery; drop the implicit-on-Save connect

Rename the crypto-specific reconciliation machinery to a kind-agnostic form and reuse it for the bank kind (Global Constraint 1). Replace the bare `MonobankTokenInput` in the bank create block with `MonobankConnectField` plus the same "enter a name first" hint the crypto block shows. Remove `connectEnteredCredentials` and the implicit connect on Save — the bank connect is now explicit, exactly like crypto.

**Files:**
- Modify: `src/screens/forms/account-form.screen.tsx`
- Test: `src/screens/forms/account-form.screen.test.tsx`

**Interfaces:**
- Consumes: `MonobankConnectField` (default export, `{ onConnect: (token: string) => Promise<boolean> }`) from Task 2; `saveToken` from `../../monobank/token`; `useSync().sync`.
- Produces (internal to the screen): `pendingAccountId` (renamed from `pendingCryptoAccountId`), `ensureAccount()` (renamed from `ensureCryptoAccount`, inserting a row with the CURRENT `kind` state — `'bank'` or `'crypto'` — instead of the hardcoded `'crypto'`), `accountCreate` ref + `accountRowStarted` state (renamed from `cryptoAccountCreate` / `cryptoRowStarted`), and `connectMonobank(token) => Promise<boolean>`.

Rename map (apply with care; the crypto behavior must stay identical):
- `pendingCryptoAccountId` → `pendingAccountId`
- `cryptoAccountCreate` → `accountCreate`
- `cryptoRowStarted` / `setCryptoRowStarted` → `accountRowStarted` / `setAccountRowStarted`
- `ensureCryptoAccount` → `ensureAccount`, and inside it change `kind: 'crypto'` to `kind` (the state variable; only reachable for `'bank'`/`'crypto'` since cash uses `createCashAccount`).

- [ ] **Step 1: Write the failing tests**

Add to `src/screens/forms/account-form.screen.test.tsx`. Mock `MonobankConnectField` the same way `wallet-address-field` / `binance-credentials-field` are mocked — collapse it to one pressable that fires `onConnect` with a token, so the test exercises the SCREEN's wiring (create-first, no duplicate, secret via the closure), not the field's own validation (covered in Task 2):

```tsx
jest.mock('../account-detail/monobank-connect-field', () => {
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ onConnect }: { onConnect: (token: string) => Promise<boolean> }) => (
      <Pressable accessibilityLabel="monobank-field" onPress={() => onConnect('tok-123')}>
        <Text>monobank field</Text>
      </Pressable>
    ),
  };
});
```

Then the wiring cases (bank kind is the create form's INITIAL_KIND, so no kind switch is needed to reach the field):

```tsx
it('connect creates the bank row once, saves the token to the Keychain, and syncs it', async () => {
  mockMonobankSync.mockResolvedValue(true);
  const view = await renderForm();

  fireEvent.changeText(view.getByPlaceholderText(/name/i), 'My Bank');
  fireEvent.press(view.getByLabelText('monobank-field'));

  await waitFor(() => {
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'bank', name: 'My Bank' }));
  });
  const createdId = mockCreate.mock.calls[0][0].id as string;
  expect(mockSaveToken).toHaveBeenCalledWith(createdId, 'tok-123');
  expect(mockMonobankSync).toHaveBeenCalledWith(createdId);
});

it('connect then Save updates the same row — never a duplicate account', async () => {
  mockMonobankSync.mockResolvedValue(true);
  const view = await renderForm();

  fireEvent.changeText(view.getByPlaceholderText(/name/i), 'My Bank');
  fireEvent.press(view.getByLabelText('monobank-field'));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));

  fireEvent.press(view.getByText(i18n.t('common.save')));

  await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalled());
  expect(mockCreate).toHaveBeenCalledTimes(1); // still one — Save took the update branch
  expect(mockUpdate).toHaveBeenCalledWith(
    mockCreate.mock.calls[0][0].id,
    expect.objectContaining({ name: 'My Bank' }),
  );
});

it('Save with no connect creates the bank row and stores no token', async () => {
  const view = await renderForm();

  fireEvent.changeText(view.getByPlaceholderText(/name/i), 'Plain Bank');
  fireEvent.press(view.getByText(i18n.t('common.save')));

  await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalled());
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'bank', name: 'Plain Bank' }));
  expect(mockSaveToken).not.toHaveBeenCalled();
  expect(mockMonobankSync).not.toHaveBeenCalled();
});

it('connecting a bank source locks the kind switch', async () => {
  mockMonobankSync.mockResolvedValue(true);
  const view = await renderForm();

  fireEvent.changeText(view.getByPlaceholderText(/name/i), 'My Bank');
  fireEvent.press(view.getByLabelText('monobank-field'));

  await waitFor(() =>
    expect(view.getByLabelText(/crypto/i).props.accessibilityState.disabled).toBe(true),
  );
});
```

Also update any EXISTING test that relied on the old implicit-on-Save Monobank connect (a bank Save that expected `mockSaveToken` / `mockMonobankSync` to fire from Save via `connectEnteredCredentials`) — that path is removed. Re-point such assertions to the explicit connect press above, or delete them if fully superseded. Grep the test file for `mockSaveToken` and `mockMonobankSync` first and reconcile each usage. Confirm the mocked field's placeholder/label matchers (`getByPlaceholderText(/name/i)`, `getByLabelText(/crypto/i)`) resolve against this project's actual i18n strings before relying on them; adjust to the concrete `t(...)` values if the regex is ambiguous.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/screens/forms/account-form.screen.test.tsx --silent`
Expected: FAIL — `monobank-field` label not found (screen still renders `MonobankTokenInput`), `mockSaveToken`/`mockMonobankSync` not called on connect, kind not locked.

- [ ] **Step 3: Generalize the machinery in `account-form.screen.tsx`**

Apply the rename map above. Concretely:

Replace the pending-id + latch + row-started declarations (currently ~lines 117-130) with the kind-agnostic names:

```tsx
  const pendingAccountId = useMemo(() => id(), []);
  const accountCreate = useRef<Promise<string> | null>(null);
  const [accountRowStarted, setAccountRowStarted] = useState(false);
```

Replace `ensureCryptoAccount` (currently ~lines 132-168) with `ensureAccount`, inserting with the current `kind` (keep every comment about the name gate, the latch, and the failed-insert reset):

```tsx
  const ensureAccount = (): Promise<string> => {
    if (!canSave) {
      return Promise.reject(new Error('name-required'));
    }
    accountCreate.current ??= (async () => {
      await accountsRepo.create({
        id: pendingAccountId,
        name: trimmedName,
        kind,
        color,
      });
      if (icon !== null) {
        await accountsRepo.setIcon(pendingAccountId, icon);
      }
      return pendingAccountId;
    })().catch((error: unknown) => {
      accountCreate.current = null;
      setAccountRowStarted(false);
      throw error;
    });
    setAccountRowStarted(true);
    return accountCreate.current;
  };
```

Update `connectWallet` / `connectBinance` to call `ensureAccount()` and use `pendingAccountId` (same bodies, renamed identifiers).

- [ ] **Step 4: Add `connectMonobank`, remove `connectEnteredCredentials`, collapse the Save branches**

Add the bank connect closure (create row first, then store the secret, then sync — Global Constraint 2 order):

```tsx
  const connectMonobank = async (token: string): Promise<boolean> => {
    try {
      await ensureAccount();
      // The token binds to the pre-generated account id (a per-account Keychain
      // item), so it can never clobber another account's secret. It goes ONLY to
      // the Keychain — never to the database or a log.
      await saveToken(pendingAccountId, token);
    } catch {
      return false;
    }
    return syncMonobank(pendingAccountId);
  };
```

Delete `connectEnteredCredentials` (currently ~lines 250-259) entirely, and remove the `fetchClientInfo` import (now used only inside `MonobankConnectField`).

In `save`, replace BOTH the old crypto branch (~297-314) and the old bank branch (~316-338) with a single shared branch — `kind` is `'bank'` or `'crypto'` here (cash returned above), and both now reconcile against the shared latch:

```tsx
    // Bank and crypto share one create path now. A field's own Connect may
    // already have inserted the row via ensureAccount (Option A); if so, persist
    // any name/color/icon edited AFTER connecting rather than inserting a DUPLICATE
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
```

Update the `save` cash branch and edit branch comments only if they reference the removed bank branch; leave their logic untouched.

- [ ] **Step 5: Update the render — swap the field, add the name hint, update the kind lock**

Replace the bank block (currently ~428-436) so it mirrors the crypto block's structure (heading + name-required hint + the field). Use `MonobankConnectField`:

```tsx
        {!isEdit && kind === 'bank' && (
          <Box gap={4}>
            <Divider testID="form-divider" />

            <Text variant="heading">{t('accountDetail.synchronization')}</Text>

            {!canSave && (
              <Box testID="monobank-connect-name-hint">
                <Text variant="caption" tone="textSecondary">
                  {t('forms.account.nameRequiredForSync')}
                </Text>
              </Box>
            )}

            <MonobankConnectField onConnect={connectMonobank} />
          </Box>
        )}
```

Update the `ChipRow` `disabled` prop (currently `disabled={isEdit || cryptoRowStarted}`) to the renamed flag: `disabled={isEdit || accountRowStarted}`.

Remove the now-unused imports: `MonobankTokenInput` and the `monobankToken` state + its `setMonobankToken` (the bare input and its state are gone; the field owns its own token state). Add the `MonobankConnectField` import. Keep `saveToken`. Update the crypto block's `CryptoSyncForm accountId={pendingCryptoAccountId}` to `accountId={pendingAccountId}`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest src/screens/forms/account-form.screen.test.tsx --silent`
Expected: PASS (new bank wiring cases + all pre-existing crypto/cash/edit cases still green after the rename).

- [ ] **Step 7: Full suite + checkpoint**

Run: `npx jest --silent` (full suite — a shared rename can break a consumer a scoped run misses; see memory "Scoped tests miss cross-file regressions")
Then: `npm run check:all`
Expected: both PASS. If `check:knip` reports `MonobankTokenInput` as now-unused, confirm it is still imported by `monobank-token-field.component.tsx` (it is) — do NOT delete it; only the account-form's import is removed.

- [ ] **Step 8: Commit**

```bash
git add src/screens/forms/account-form.screen.tsx src/screens/forms/account-form.screen.test.tsx
git commit -m "feat(forms): explicit Connect Monobank button on bank create; generalize id reconciliation"
```

---

## Final verification (before declaring done)

- [ ] Run `npm run check:all` — clean.
- [ ] Run `npm run check:deep` once (mutation + osv). Treat effectively-green as mutation score ≥ threshold AND osv only the known-accepted CVE set (see memory "check:deep exits 2 on known osv CVEs"); run it detached and await the exit code only.
- [ ] Grep confirms the token never lands anywhere but the Keychain: `git grep -n "monobankToken\|connectEnteredCredentials"` returns nothing in `src/screens/forms/account-form.screen.tsx` (both removed), and `saveToken` is the sole sink for the token in `connectMonobank`.
- [ ] Manual device check (ops): open Add Account → Bank, enter a name, paste a real Monobank token, press Connect → status shows "Connected as {name}"; a bad token shows "Invalid token"; Connect before a name shows the "enter a name first" hint and connects nothing.

## Self-review notes

- **Spec coverage:** explicit per-source Connect button (Task 2) + wired to bank create with the crypto-parity hint (Task 3); implicit swallowed Save connect removed (Task 3, Step 4); live validation + visible status (Task 2); write-only secret via Keychain keyed by the pre-generated id (Task 3 `connectMonobank`); machinery generalized, not copied (Task 3 rename map).
- **Type consistency:** `onConnect: (token: string) => Promise<boolean>` is used identically in Task 2's component, its test mock, and Task 3's `connectMonobank`. `ensureAccount` / `pendingAccountId` / `accountCreate` / `accountRowStarted` names are used consistently across Task 3's steps.
- **iOS 16 floor (Global Constraint 3):** no new native API, symbol, or component is introduced — `Button`, `MonobankTokenInput`, `SyncStatusLine`, and `saveToken` are all already shipping; nothing raises the deployment target.
