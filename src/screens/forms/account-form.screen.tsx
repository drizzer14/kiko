import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { useCryptoSync } from '@kiko/sync/use-crypto-sync';
import { useSync } from '@kiko/sync/use-sync';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type Currency, currencyOptions, currencySymbol } from '../../currency/currency';
import { currencySignSymbol } from '../../currency/currency-symbols';
import { Money } from '../../currency/money';
import { parseAmount } from '../../currency/parse';
import { id } from '../../db/id';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import Button from '../../design-system/components/button';
import Divider from '../../design-system/components/divider';
import Screen from '../../design-system/components/screen';
import Text from '../../design-system/components/text';
import TextField from '../../design-system/components/text-field';
import { resolveEntityColor } from '../../design-system/entity-tint';
import { defaultAccountColor } from '../../holdings/entity-colors';
import { accountKindSymbol } from '../../holdings/entity-symbols';
import { fetchClientInfo } from '../../monobank/client';
import { saveToken } from '../../monobank/token';
import type { AccountsStackParamList } from '../../navigation/types';
import CryptoSyncForm from '../account-detail/crypto-sync-form';
import MonobankTokenInput from '../account-detail/monobank-token-input';

import { groupAmount } from './amount-format';
import ChipRow from './chip-row';
import ColorPicker from './color-picker';
import HoldingIdentityField from './holding-identity-field';
import { useSubmitOnce } from './use-submit-once';

type AccountFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'AccountForm'>;

// The account kinds offered in this form (a subset of the `kind` enum in
// db/schema.ts). A crypto account is created like a bank account — no initial
// holding/currency at creation; holdings are added later — so only cash needs
// the currency + initial-value fields below.
const kinds = ['bank', 'cash', 'crypto'] as const;
type Kind = (typeof kinds)[number];

// The kind a fresh create form starts on. Its default icon (accountKindSymbol)
// seeds the icon field so the form opens on a sensible glyph rather than the
// neutral fallback below.
const INITIAL_KIND: Kind = 'bank';

// Neutral placeholder glyph shown in the create form's icon chip until the user
// picks one. The persisted default (a kind-derived icon) is applied by the
// account list rows when the stored icon is null; here the account has no kind
// context worth deriving from yet, so a neutral swatch reads as "unset".
const FALLBACK_ICON = 'square.grid.2x2';

const AccountFormScreen: FC<AccountFormScreenProps> = ({ route, navigation }) => {
  // An `accountId` in the route params switches the form to EDIT mode: the same
  // fields, seeded from the existing account, saving through the update path
  // rather than create. Absent (the accounts list passes `{}`), it is a plain
  // create form.
  const editId = route.params?.accountId;
  const isEdit = editId !== undefined;

  const { t } = useTranslation();
  // Human display text for the account kinds; the chip still reports the
  // underlying value on select. Built from the catalog inside the component
  // (rather than a module-level constant) so it always reflects the active
  // language.
  const kindLabels: Record<Kind, string> = {
    bank: t('forms.account.bank'),
    cash: t('forms.account.cash'),
    crypto: t('forms.account.crypto'),
  };

  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>(INITIAL_KIND);
  const [currency, setCurrency] = useState<Currency>('UAH');
  const [initialValue, setInitialValue] = useState('');
  // A create form seeds the icon with the initially-selected kind's default
  // glyph so it opens on a sensible symbol; the user can still override it in
  // the picker below. Edit mode starts null and is hydrated from the stored
  // row (below), so the seed never clobbers a saved icon.
  const [icon, setIcon] = useState<string | null>(isEdit ? null : accountKindSymbol[INITIAL_KIND]);
  // Optional Monobank sync token entered at CREATE time (never seeded in edit
  // mode). It is write-only: it goes straight to the Keychain on save and is
  // never read back into state — see the save flow below. The crypto branch no
  // longer holds credential state here: the shared `CryptoSyncForm` owns its own
  // inputs and writes the Binance secret to the Keychain itself.
  const [monobankToken, setMonobankToken] = useState('');
  // Mirrors the icon's dirty pattern: null until the user taps a swatch. While
  // null, the effective color follows the selected kind's default
  // (defaultAccountColor[kind]) — the ColorPicker highlights that swatch and
  // switching kind moves it; once picked, the choice sticks.
  const [color, setColor] = useState<string | null>(null);
  // `resolveEntityColor` — not a bare nullish-coalesce onto the kind default —
  // because `color`/`kind` here are seeded straight from a stored row
  // (setColor(editingAccount.color) / setKind(editingAccount.kind) below): a
  // stored empty-string color and a since-removed kind (the schema enum is
  // TS-only, no CHECK constraint) both reach here as unusable values the bare
  // pattern would let through as ''/undefined.
  const effectiveColor = resolveEntityColor(color, defaultAccountColor[kind]);

  // The same Connect actions the account-detail screen uses. On a create the
  // account row is created FIRST, then the credential is saved and the connect
  // runs against its id — a bad credential leaves a created-but-unconnected
  // account the user repairs from its detail screen (Option A). The bank path
  // runs this on Save (connectEnteredCredentials); the crypto path runs it on the
  // shared field's own Connect (connectWallet / connectBinance below).
  const { sync: syncMonobank } = useSync();
  const { sync: syncCrypto } = useCryptoSync();

  // The crypto account's id is pre-generated once for this create session so the
  // shared `CryptoSyncForm` fields — which bind to an EXISTING account id (a
  // per-account Keychain item and a `sync({ targetAccountId })`) — have a stable
  // id to key against before the row exists. The row is inserted with this exact
  // id by `ensureCryptoAccount` on the first Connect (or on Save), so the field's
  // Keychain write and first sync land on the row that Save then persists.
  const pendingCryptoAccountId = useMemo(() => id(), []);
  // A one-shot create promise: whichever fires first (a field's own Connect or
  // the footer Save) inserts the row exactly once; every later caller reuses the
  // same promise, so a field Connect followed by Save can never produce a
  // DUPLICATE account (Option A). On a REJECTED create the ref is reset to null
  // (see below) so a retry re-attempts and Save never silently no-ops.
  const cryptoAccountCreate = useRef<Promise<string> | null>(null);
  // A render-visible mirror of "the crypto row has been (or is being) inserted",
  // used only to DISABLE the kind switch once a source is connected — switching
  // to bank/cash afterwards would route Save down a branch that creates a SECOND
  // account and orphans the crypto row. It is state (not just the ref) because
  // the disable must re-render; it follows the ref, reset to false on a failed
  // create so the switch re-enables when no row actually exists.
  const [cryptoRowStarted, setCryptoRowStarted] = useState(false);

  const ensureCryptoAccount = (): Promise<string> => {
    // Parity with the bank Save gate (`canSave = trimmedName !== ''`): the crypto
    // form is always visible and a credential/address may be entered, but NO
    // account row is ever created without a name. A field's own Connect tapped
    // with an empty (whitespace-only) name rejects HERE before any insert — the
    // field surfaces its existing "could not connect" state and the crypto block
    // shows the "enter a name first" hint so the user understands why. The latch
    // and the `cryptoRowStarted` kind-lock are left untouched (no row was
    // started), so a retry after typing a name re-attempts cleanly. Save is
    // separately blocked on `!canSave`, so this also guards the programmatic path.
    if (!canSave) {
      return Promise.reject(new Error('name-required'));
    }
    cryptoAccountCreate.current ??= (async () => {
      await accountsRepo.create({
        id: pendingCryptoAccountId,
        name: trimmedName,
        kind: 'crypto',
        color,
      });
      if (icon !== null) {
        await accountsRepo.setIcon(pendingCryptoAccountId, icon);
      }
      return pendingCryptoAccountId;
    })().catch((error: unknown) => {
      // A failed insert (DB locked, disk full) must not poison the session: clear
      // the latch so a retry — or the Save fallback — re-attempts, rather than
      // leaving the ref non-null and sending Save down the UPDATE branch, which
      // would match no row and silently no-op while the user believes they saved
      // (C-1). Re-throw so the caller still sees the failure.
      cryptoAccountCreate.current = null;
      setCryptoRowStarted(false);
      throw error;
    });
    setCryptoRowStarted(true);
    return cryptoAccountCreate.current;
  };

  // Both crypto fields create the row FIRST (Option A), then run the shared sync
  // against it. `CryptoSyncForm`/`BinanceCredentialsField` validate the
  // credential and write the Binance secret to the Keychain themselves, keyed by
  // the pre-generated id, before calling these — the secret never reaches this
  // screen, the DB, or a log. A create failure is caught here and surfaced to
  // the field as a `false` (not-connected) result, so the field shows its
  // "could not connect" status instead of an unhandled rejection that would
  // leave it stuck on "checking" (C-2); the ref reset above lets the next
  // Connect retry.
  const connectWallet = async (address: string): Promise<boolean> => {
    try {
      await ensureCryptoAccount();
    } catch {
      return false;
    }
    return syncCrypto({
      providerId: 'btc_wallet',
      targetAccountId: pendingCryptoAccountId,
      address,
    });
  };

  const connectBinance = async (): Promise<boolean> => {
    try {
      await ensureCryptoAccount();
    } catch {
      return false;
    }
    return syncCrypto({ providerId: 'binance', targetAccountId: pendingCryptoAccountId });
  };

  // In edit mode, load the account being edited so its fields can seed the form.
  // The query always runs (hooks can't be conditional); an empty id in create
  // mode simply matches no row.
  const { data: accounts } = useLiveQuery(accountsRepo.byIdQuery(editId ?? ''), ['accounts']);
  const editingAccount = isEdit ? accounts.at(0) : undefined;

  // Seed the form once from the loaded account. `useLiveQuery` resolves
  // asynchronously, so the initial render precedes the data; a one-shot ref
  // guards against re-seeding (and clobbering the user's in-progress edits) on
  // every subsequent live-query emission.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!isEdit || hydrated.current || editingAccount === undefined) {
      return;
    }
    hydrated.current = true;
    setName(editingAccount.name);
    setKind(editingAccount.kind);
    setIcon(editingAccount.icon);
    setColor(editingAccount.color);
  }, [isEdit, editingAccount]);

  // The stack sets the static "Add Account" title; in edit mode override it with
  // "Edit Account" so the header reads correctly for the update flow.
  useLayoutEffect(() => {
    if (isEdit) {
      navigation.setOptions({ title: t('forms.account.editTitle') });
    }
  }, [isEdit, navigation, t]);

  const trimmedName = name.trim();
  const canSave = trimmedName !== '';

  // If the user entered a Monobank token on this bank create, VALIDATE it, then
  // save to the Keychain and kick off the connect. Validation-before-write is
  // load-bearing: the token is a PER-ACCOUNT Keychain item
  // (`saveToken(accountId, …)`), so it can never clobber another account's
  // secret — but an unvalidated write would still store a bad token against this
  // new account and silently mis-report the connection. On a rejected validation
  // the write is SKIPPED and the Keychain is left untouched; the account is still
  // created (Option A). This function MAY throw (validation or the Keychain
  // write); the caller swallows it so the create never fails after the row
  // exists. The connect is fire-and-forget (useSync folds its own errors). The
  // token goes ONLY to the Keychain, never to the database or a log.
  //
  // The crypto branch is gone: the shared `CryptoSyncForm` fields validate,
  // write the Binance secret to the Keychain, and run the first sync themselves,
  // keyed by the pre-generated id, on their OWN Connect — see connectWallet /
  // connectBinance above.
  const connectEnteredCredentials = async (newAccountId: string): Promise<void> => {
    if (kind === 'bank' && monobankToken.trim() !== '') {
      const token = monobankToken.trim();
      await fetchClientInfo(token);
      // The token binds to the freshly-created account's id (the per-account
      // Keychain item), so a second Monobank connection stores its own token.
      await saveToken(newAccountId, token);
      syncMonobank(newAccountId);
    }
  };

  const save = async (): Promise<void> => {
    // Block submit on an empty (or whitespace-only) name; the button is also
    // disabled below so this guards the programmatic path too.
    if (!canSave) {
      return;
    }

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

    if (kind === 'crypto') {
      // A field's own Connect may already have inserted the row via
      // ensureCryptoAccount (Option A). If so, persist any name/color/icon the
      // user edited AFTER connecting, rather than inserting a DUPLICATE account;
      // the shared `CryptoSyncForm` already handled the credential + first sync.
      // Otherwise this Save is the first write, so create the row now (an
      // unconnected crypto account is valid — the user connects a source later
      // from its detail screen).
      if (cryptoAccountCreate.current !== null) {
        await accountsRepo.update(pendingCryptoAccountId, { name: trimmedName, color });
        await accountsRepo.setIcon(pendingCryptoAccountId, icon);
      } else {
        await ensureCryptoAccount();
      }
      navigation.goBack();

      return;
    }

    // The bank branch. Persist the color only when the user picked one (dirty);
    // left null, the row follows its kind's default at display time, mirroring
    // the icon fallback.
    const newAccountId = await accountsRepo.create({ name: trimmedName, kind, color });

    // Persist the chosen icon on the freshly-created row, using the id the
    // create resolved to. Awaited so it commits before navigating away.
    if (icon !== null) {
      await accountsRepo.setIcon(newAccountId, icon);
    }

    // The connect/write step must NEVER fail the create once the row exists: a
    // rejected validation, Keychain write, or connect would otherwise skip
    // goBack, leaving useSubmitOnce armed so a second Save press creates a
    // DUPLICATE account. Swallow it — the account is created; the user repairs
    // the connection from its detail screen (Option A).
    try {
      await connectEnteredCredentials(newAccountId);
    } catch {
      // Intentionally ignored — see the comment above.
    }

    navigation.goBack();
  };

  const { onPress: onSave, isSubmitting } = useSubmitOnce(save);

  // Selecting an account type re-seeds the icon field with that type's default
  // glyph; the user can still override it in the picker afterward, and picking
  // a different type resets the icon to the new type's default. Only reachable
  // in create mode — the kind chip is disabled in edit mode below.
  const handleSelectKind = (nextKind: Kind): void => {
    setKind(nextKind);
    setIcon(accountKindSymbol[nextKind]);
  };

  return (
    <Screen
      scroll
      footer={
        <Button onPress={onSave} disabled={!canSave || isSubmitting}>
          {t('common.save')}
        </Button>
      }
    >
      <Box gap={4} testID="account-form">
        {/* One shared icon+name block for every kind, cash included: the icon
            picker stays visible whatever the kind is. The cash create path
            (createCashAccount) now persists the picked icon in its own atomic
            insert, and the bank/crypto path sets it via setIcon on the returned
            id below. */}
        <HoldingIdentityField
          icon={icon}
          fallbackIcon={FALLBACK_ICON}
          iconColor={effectiveColor}
          name={name}
          onChangeName={setName}
          onSelectIcon={setIcon}
          onRemoveIcon={() => setIcon(null)}
          namePlaceholder={t('forms.fields.name')}
          required
        />

        <ColorPicker label={t('forms.fields.color')} value={effectiveColor} onSelect={setColor} />

        <Divider testID="form-divider" />

        {/* Kind fixes an account's structure (a cash account owns an initial
            cash holding; a bank/crypto does not), and no repo path re-shapes it,
            so it is read-only in edit mode — shown, but not switchable. It also
            locks once a crypto source has been connected (which already inserted
            the crypto row): switching to bank/cash afterwards would make Save
            create a SECOND account and orphan the crypto row. */}
        <ChipRow
          label={t('forms.account.kind')}
          options={kinds}
          selected={kind}
          onSelect={handleSelectKind}
          labels={kindLabels}
          icons={accountKindSymbol}
          disabled={isEdit || cryptoRowStarted}
        />

        {/* The currency + initial value seed the cash account's initial holding
            at creation only; they have no meaning once the holding exists (its
            balance is edited on the holding itself), so the edit form omits
            them. */}
        {!isEdit && kind === 'cash' && (
          <>
            <ChipRow
              label={t('forms.fields.currency')}
              options={currencyOptions}
              selected={currency}
              onSelect={setCurrency}
              icons={currencySignSymbol}
            />

            <TextField
              label={t('forms.account.initialValue')}
              value={initialValue}
              onChangeText={(text) => setInitialValue(groupAmount(text))}
              keyboardType="decimal-pad"
              placeholder="0.00"
              suffix={currencySymbol[currency]}
            />
          </>
        )}

        {/* Optional sync credentials, offered only on a bank/crypto CREATE. The
            fields are NOT required (no asterisk): an account still creates with
            no credentials. A secret is masked and write-only — on save it goes
            straight to the Keychain, never into a stored row or a log. */}
        {!isEdit && kind === 'bank' && (
          <Box gap={4}>
            <Divider testID="form-divider" />

            <Text variant="heading">{t('accountDetail.synchronization')}</Text>

            <MonobankTokenInput value={monobankToken} onChangeText={setMonobankToken} />
          </Box>
        )}

        {/* The SAME Wallet|Binance sync form the account-detail screen uses,
            reused here rather than hand-rolled. It renders the moment Crypto is
            selected — full parity with the bank form above, with NO name gate.
            The create invariant is enforced instead of hidden: each field's own
            Connect inserts the account row (via ensureCryptoAccount) keyed by the
            pre-generated id, and ensureCryptoAccount refuses to create a row while
            `!canSave` (empty name), mirroring the bank Save gate. Until a name is
            entered the hint below tells the user why a Connect will not persist
            anything; a Connect tapped early just surfaces the field's "could not
            connect" state and writes no row. */}
        {!isEdit && kind === 'crypto' && (
          <Box gap={4}>
            <Divider testID="form-divider" />

            <Text variant="heading">{t('accountDetail.synchronization')}</Text>

            {!canSave && (
              <Box testID="crypto-sync-name-hint">
                <Text variant="caption" tone="textSecondary">
                  {t('forms.account.nameRequiredForSync')}
                </Text>
              </Box>
            )}

            <CryptoSyncForm
              accountId={pendingCryptoAccountId}
              onConnectWallet={connectWallet}
              onConnectBinance={connectBinance}
            />
          </Box>
        )}
      </Box>
    </Screen>
  );
};

export default AccountFormScreen;
