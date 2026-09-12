import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { useCryptoSync } from '@kiko/sync/use-crypto-sync';
import { useSync } from '@kiko/sync/use-sync';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchAccount } from '../../crypto-sync/binance/binance.client';
import { saveCredentials } from '../../crypto-sync/binance/binance.credentials';
import { type Currency, currencyOptions, currencySymbol } from '../../currency/currency';
import { currencySignSymbol } from '../../currency/currency-symbols';
import { Money } from '../../currency/money';
import { parseAmount } from '../../currency/parse';
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
  // Optional sync credentials entered at CREATE time (never seeded in edit
  // mode). A secret is write-only: it goes straight to the Keychain on save and
  // is never read back into state — see the save flow below.
  const [monobankToken, setMonobankToken] = useState('');
  const [binanceApiKey, setBinanceApiKey] = useState('');
  const [binanceSecret, setBinanceSecret] = useState('');
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

  // The same Connect actions the account-detail screen uses. On a create with a
  // credential entered, the account is created FIRST, then the credential is
  // saved and the connect runs — a bad credential leaves a created-but-
  // unconnected account the user repairs from its detail screen (Option A).
  const { sync: syncMonobank } = useSync();
  const { sync: syncBinance } = useCryptoSync();

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

  // If the user entered sync credentials on this create, VALIDATE them, then
  // save to the Keychain and kick off the connect. Validation-before-write is
  // load-bearing: both the Monobank token and the Binance credential are now
  // PER-ACCOUNT Keychain items (`saveToken(accountId, …)` /
  // `saveCredentials(accountId, …)`), so neither can clobber another account's
  // secret — but an unvalidated write would still store a bad pair against this
  // new account and silently mis-report the connection. The detail-screen fields
  // validate first for the same reason. On a rejected validation the write is
  // SKIPPED and the Keychain is left untouched; the account is still created
  // (Option A). This function
  // MAY throw (validation or the Keychain write); the caller swallows it so the
  // create never fails after the row exists. The connect is fire-and-forget
  // (useSync / useCryptoSync fold their own errors). The secret goes ONLY to the
  // Keychain, never to the database, holding metadata, or a log.
  const connectEnteredCredentials = async (newAccountId: string): Promise<void> => {
    if (kind === 'bank' && monobankToken.trim() !== '') {
      const token = monobankToken.trim();
      await fetchClientInfo(token);
      // The token binds to the freshly-created account's id (the per-account
      // Keychain item), so a second Monobank connection stores its own token.
      await saveToken(newAccountId, token);
      syncMonobank(newAccountId);

      return;
    }

    if (kind === 'crypto' && binanceApiKey.trim() !== '' && binanceSecret.trim() !== '') {
      const apiKey = binanceApiKey.trim();
      const secret = binanceSecret.trim();
      await fetchAccount(apiKey, secret);
      // The pair binds to the freshly-created account's id (the per-account
      // Keychain item), so a second Binance connection stores its own credentials.
      await saveCredentials(newAccountId, { apiKey, secret });
      syncBinance({ providerId: 'binance', targetAccountId: newAccountId });
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

    // Persist the color only when the user picked one (dirty); left null, the row
    // follows its kind's default at display time, mirroring the icon fallback.
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
            so it is read-only in edit mode — shown, but not switchable. */}
        <ChipRow
          label={t('forms.account.kind')}
          options={kinds}
          selected={kind}
          onSelect={handleSelectKind}
          labels={kindLabels}
          icons={accountKindSymbol}
          disabled={isEdit}
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

        {!isEdit && kind === 'crypto' && (
          <Box gap={4}>
            <Divider testID="form-divider" />

            <Text variant="heading">{t('accountDetail.synchronization')}</Text>

            <TextField
              label={t('accountDetail.apiKeyLabel')}
              value={binanceApiKey}
              onChangeText={setBinanceApiKey}
              placeholder={t('accountDetail.binanceApiKeyPlaceholder')}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />

            <TextField
              label={t('accountDetail.apiSecretLabel')}
              value={binanceSecret}
              onChangeText={setBinanceSecret}
              placeholder={t('accountDetail.binanceApiSecretPlaceholder')}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Box>
        )}
      </Box>
    </Screen>
  );
};

export default AccountFormScreen;
