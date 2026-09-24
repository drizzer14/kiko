import { useSync } from '@kiko/sync/use-sync';
import { useTranslation } from 'react-i18next';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { useCryptoSync } from '@kiko/sync/use-crypto-sync';
import { accountsRepo } from '@kiko/accounts/accounts.repo';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert, View, type ScrollViewInstance, type TextInputInstance } from 'react-native';
import { type FC, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { id } from '../../../db/id';
import { Money } from '../../../currency/money';
import { saveToken } from '../../../monobank/token';
import { parseAmount } from '../../../currency/parse';
import Box from '../../../design-system/components/box';
import { useLiveQuery } from '../../../db/use-live-query';
import Text from '../../../design-system/components/text';
import Button from '../../../design-system/components/button';
import Screen from '../../../design-system/components/screen';
import Divider from '../../../design-system/components/divider';
import CryptoSyncForm from '../../account-detail/crypto-sync-form';
import TextField from '../../../design-system/components/text-field';
import { accountKindSymbol, genericEntitySymbol } from '../../../holdings/entity-symbols';
import { defaultAccountColor } from '../../../holdings/entity-colors';
import { resolveEntityColor } from '../../../design-system/entity-tint';
import type { AccountsStackParamList } from '../../../navigation/types';
import CurrencyField from '../../../design-system/components/currency-field';
import MonobankConnectField from '../../account-detail/monobank-connect-field';
import { type Currency, currencySymbol, fiatCurrencyOptions } from '../../../currency/currency';
import { KIKO_ENTITIES_ICONS } from '../../../design-system/components/icon-picker-modal/icon-pools';
import type { AccountRow } from '../../../db/schema';
import { type BankId, isBankId } from '../../../bank-sync/bank-catalog';

import ColorPicker from '../color-picker';
import BankTypeField from '../bank-type-field';
import AccountKindField from '../account-kind-field';
import { groupAmount } from '../amount-format/amount-format';
import HoldingIdentityField from '../holding-identity-field';
import { useSubmitOnce } from '../use-submit-once/use-submit-once';
import {
  useHeaderInset,
  scrollToField,
  type FieldInstance,
} from '../scroll-to-field/scroll-to-field';

type AccountFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'AccountForm'>;

// The account kinds this form offers, derived from `accountKindSymbol` — a
// `Record<AccountKind, string>` typed over the FULL `accounts.kind` schema
// union (see entity-symbols.ts's own exhaustiveness doc comment) — rather
// than a hand-copied array, so a later schema widening (debt, broker) is a
// compile error here until this form (and the symbol/color/subtitle maps it
// already forces) accounts for the new kind. A crypto account is created
// like a bank account — no initial holding/currency at creation; holdings are
// added later — so only cash needs the currency + initial-value fields below;
// property and metals have no extra creation fields yet (the property
// holding section is T16; the metal one is T20).
const kinds = Object.keys(accountKindSymbol) as AccountRow['kind'][];
type Kind = (typeof kinds)[number];

// A stored `kind` can still hold a value that is no longer part of the CURRENT
// schema enum — the schema's `enum` is TS-only (no DB CHECK constraint), so a
// once-valid, since-removed kind (e.g. the retired `broker`) can persist.
// Guards the edit-mode hydration below against that case so an unrecognized
// stored kind never assigns outside `Kind`'s own type (and the symbol/color
// lookups below never silently miss).
const isSupportedKind = (value: string): value is Kind =>
  (kinds as readonly string[]).includes(value);

// The kind a fresh create form starts on. Its default icon (accountKindSymbol)
// seeds the icon field so the form opens on a sensible glyph rather than the
// neutral fallback below.
const INITIAL_KIND: Kind = 'bank';

// Neutral placeholder glyph shown in the create form's icon chip until the user
// picks one (and the glyph a cleared icon falls back to). The persisted default
// (a kind-derived icon) is applied by the account list rows when the stored icon
// is null; here the account has no kind context worth deriving from yet, so the
// generic account reference (`tray`) reads as "unset" — never the retired
// `square.grid.2x2`, per the icon rework's generic-account decision (§2.1).
const FALLBACK_ICON = genericEntitySymbol.account;

const AccountFormScreen: FC<AccountFormScreenProps> = ({ route, navigation }) => {
  // An `accountId` in the route params switches the form to EDIT mode: the same
  // fields, seeded from the existing account, saving through the update path
  // rather than create. Absent (the accounts list passes `{}`), it is a plain
  // create form.
  const editId = route.params?.accountId;
  const isEdit = editId !== undefined;

  const { t } = useTranslation();
  // Human display text for the account kinds; the field still reports the
  // underlying value on select. Built from the catalog inside the component
  // (rather than a module-level constant) so it always reflects the active
  // language.
  const kindLabels: Record<Kind, string> = {
    bank: t('forms.account.bank'),
    cash: t('forms.account.cash'),
    crypto: t('forms.account.crypto'),
    property: t('forms.account.property'),
    metals: t('forms.account.metals'),
    debt: t('forms.account.debt'),
  };
  // The one-line "which kind is this?" hint shown under each row in the
  // AccountKindField sheet (device-feedback: a bare label does not say what
  // belongs there) — see `forms.account.kindSubtitle` in en.ts/uk.ts.
  const kindSubtitles: Record<Kind, string> = {
    bank: t('forms.account.kindSubtitle.bank'),
    cash: t('forms.account.kindSubtitle.cash'),
    crypto: t('forms.account.kindSubtitle.crypto'),
    property: t('forms.account.kindSubtitle.property'),
    debt: t('forms.account.kindSubtitle.debt'),
    metals: t('forms.account.kindSubtitle.metals'),
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
  // Mirrors the icon's dirty pattern: null until the user taps a swatch. While
  // null, the effective color follows the selected kind's default
  // (defaultAccountColor[kind]) — the ColorPicker highlights that swatch and
  // switching kind moves it; once picked, the choice sticks.
  const [color, setColor] = useState<string | null>(null);
  // The bank the user picked in the sync section's BankTypeField, tagging the
  // created row for later provider-specific handling (import, connect status).
  // null = no bank picked — a valid, plain bank account. Never auto-seeded on a
  // fresh bank create (no auto-jump to Monobank, device-feedback-round-1 item 3).
  const [bankId, setBankId] = useState<BankId | null>(null);
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
  // account the user repairs from its detail screen (Option A). Every kind runs
  // its connect on a field's OWN Connect (connectMonobank for bank;
  // connectWallet / connectBinance for crypto) — there is no implicit connect on
  // Save any more.
  const { sync: syncMonobank } = useSync();
  const { sync: syncCrypto } = useCryptoSync();

  // The account's id is pre-generated once for this create session so the
  // per-source fields — which bind to an EXISTING account id (a per-account
  // Keychain item and a `sync({ targetAccountId })`) — have a stable id to key
  // against before the row exists. The row is inserted with this exact id by
  // `ensureAccount` on the first Connect (or on Save), so a field's Keychain
  // write and first sync land on the row that Save then persists. Shared by both
  // the bank and crypto kinds — one create-first / one-shot-insert latch, not a
  // second copy.
  const pendingAccountId = useMemo(() => id(), []);
  // A one-shot create promise: whichever fires first (a field's own Connect or
  // the footer Save) inserts the row exactly once; every later caller reuses the
  // same promise, so a field Connect followed by Save can never produce a
  // DUPLICATE account (Option A). On a REJECTED create the ref is reset to null
  // (see below) so a retry re-attempts and Save never silently no-ops.
  const accountCreate = useRef<Promise<string> | null>(null);
  // A render-visible mirror of "the row has been (or is being) inserted", used
  // only to DISABLE the kind switch once a source is connected — switching kind
  // afterwards would route Save down a branch that creates a SECOND account and
  // orphans the started row. It is state (not just the ref) because the disable
  // must re-render; it follows the ref, reset to false on a failed create so the
  // switch re-enables when no row actually exists.
  const [accountRowStarted, setAccountRowStarted] = useState(false);
  // Mirrors contribution-form's attempted-flag pattern: the name-required
  // reason stays hidden until the user actually tries to Connect or Save with
  // an empty name, rather than showing as a standing hint the whole time.
  const [showNameError, setShowNameError] = useState(false);
  // DEVICE BUG fix (root cause): while the currency sheet's search field can
  // be focused, this screen's background ScrollView must NOT react to the
  // keyboard's frame change — it does not contain that responder, but
  // `automaticallyAdjustKeyboardInsets` reacts to any focus regardless
  // (see `screen.component.tsx`, `CurrencyField`'s `onOpenChange`).
  const [isCurrencySheetOpen, setIsCurrencySheetOpen] = useState(false);

  // The scrollable content root and the name field's own wrapper — passed to
  // `scrollToField` so a blocked Connect/Save (empty name) scrolls the field
  // into view alongside its inline error, rather than leaving the reason
  // rendered off-screen above the fold. See scroll-to-field.ts. An
  // `useAnimatedRef` (rather than a plain `useRef`) so `useScrollOffset`
  // below can read the ScrollView's own live content offset — the same
  // pattern accounts.screen.tsx / statistics.screen.tsx already use for
  // their own scroll-to-top hook.
  const scrollableRef = useAnimatedRef<ScrollViewInstance>();
  const scrollOffset = useScrollOffset(scrollableRef);
  const nameFieldRef = useRef<FieldInstance>(null);
  // The name field's own inner TextInput, so a blocked Connect/Save can
  // focus it imperatively once it has scrolled into view (see `onSettled`
  // below) — HoldingIdentityField's own `nameInputRef` prop already exposes
  // this same ref shape.
  const nameInputRef = useRef<TextInputInstance>(null);
  const headerInset = useHeaderInset();
  // The ScrollView's own total content height, captured off `Screen`'s
  // `onContentSizeChange` (forwarded from its ScrollView) so `scrollToField`
  // can bound an over-large target against the real content extent — see
  // scroll-to-field.ts's own overshoot-clamp doc. A plain ref, not state:
  // read only imperatively at Save-press time, never needs to re-render.
  const contentHeightRef = useRef(0);

  const ensureAccount = (): Promise<string> => {
    // Parity with the bank Save gate (`canSave = trimmedName !== ''`): a sync
    // form is always visible and a credential/address may be entered, but NO
    // account row is ever created without a name. A field's own Connect tapped
    // with an empty (whitespace-only) name rejects HERE before any insert — the
    // field surfaces its existing "could not connect" state and the name-required
    // reason renders below the name field so the user understands why. The latch
    // and the `accountRowStarted` kind-lock are left untouched (no row was
    // started), so a retry after typing a name re-attempts cleanly. Save is
    // separately blocked on `!canSave`, so this also guards the programmatic path.
    if (!canSave) {
      setShowNameError(true);
      scrollToField(
        scrollableRef,
        nameFieldRef,
        { currentOffset: scrollOffset.value, headerInset, contentHeight: contentHeightRef.current },
        () => nameInputRef.current?.focus(),
      );

      return Promise.reject(new Error('name-required'));
    }
    accountCreate.current ??= (async () => {
      await accountsRepo.create({
        id: pendingAccountId,
        name: trimmedName,
        // The current kind — 'bank', 'crypto', 'property', or 'metals' is
        // reachable here, since the cash path creates through
        // createCashAccount and returns before this.
        kind,
        color,
        bankId,
      });
      if (icon !== null) {
        await accountsRepo.setIcon(pendingAccountId, icon);
      }
      return pendingAccountId;
    })().catch((error: unknown) => {
      // A failed insert (DB locked, disk full) must not poison the session: clear
      // the latch so a retry — or the Save fallback — re-attempts, rather than
      // leaving the ref non-null and sending Save down the UPDATE branch, which
      // would match no row and silently no-op while the user believes they saved
      // (C-1). Re-throw so the caller still sees the failure.
      accountCreate.current = null;
      setAccountRowStarted(false);
      throw error;
    });
    setAccountRowStarted(true);
    return accountCreate.current;
  };

  // The bank field creates the row FIRST (Option A), then stores the validated
  // token to the Keychain keyed by the pre-generated id, then runs the first
  // Monobank sync against it (the write-only-secret order — Global Constraint 2).
  // Any failure BEFORE the sync returns false so the field shows its "could not
  // connect" status rather than an unhandled rejection; the ensureAccount reset
  // above lets the next Connect retry. The token goes ONLY to the Keychain —
  // never to the database or a log.
  const connectMonobank = async (token: string): Promise<boolean> => {
    try {
      await ensureAccount();
      // The token binds to the pre-generated account id (a per-account Keychain
      // item), so it can never clobber another account's secret.
      await saveToken(pendingAccountId, token);
    } catch {
      return false;
    }
    return syncMonobank(pendingAccountId);
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
      await ensureAccount();
    } catch {
      return false;
    }
    return syncCrypto({
      providerId: 'btc_wallet',
      targetAccountId: pendingAccountId,
      address,
    });
  };

  const connectBinance = async (): Promise<boolean> => {
    try {
      await ensureAccount();
    } catch {
      return false;
    }
    return syncCrypto({ providerId: 'binance', targetAccountId: pendingAccountId });
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
    setKind(isSupportedKind(editingAccount.kind) ? editingAccount.kind : INITIAL_KIND);
    setIcon(editingAccount.icon);
    setColor(editingAccount.color);
    // F2 fix: the edit form used to never seed `bankId` at all (the picker
    // below simply didn't render), leaving no way to view or change an
    // account's bank identity after create. `isBankId` guards against a
    // stored value from a since-removed catalog entry, mirroring
    // `isSupportedKind` above.
    setBankId(isBankId(editingAccount.bankId) ? editingAccount.bankId : null);
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

  const save = async (): Promise<void> => {
    // Block submit on an empty (or whitespace-only) name; Save is always
    // enabled now, so this surfaces the name-required reason on press rather
    // than a standing disabled state.
    if (!canSave) {
      setShowNameError(true);
      scrollToField(
        scrollableRef,
        nameFieldRef,
        { currentOffset: scrollOffset.value, headerInset, contentHeight: contentHeightRef.current },
        () => nameInputRef.current?.focus(),
      );

      return;
    }

    try {
      if (isEdit) {
        // Update the editable identity fields in one transaction; the icon routes
        // through setIcon (so a cleared icon persists an explicit null), the same
        // split the create path uses. Kind is read-only, and the cash currency +
        // initial value belong to the create-time initial holding, so neither is
        // touched here. `bankId` (F2 fix) is now editable too — this patch never
        // carries `institution`, so a live-connected account's sync stays
        // untouched no matter what bank identity is picked here.
        await accountsRepo.update(editId, { name: trimmedName, color, bankId });
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

      // Bank, crypto, property, and metals share one create path now — `kind`
      // here is 'bank', 'crypto', 'property', or 'metals' (cash returned
      // above). A field's own Connect may already have inserted the row via
      // ensureAccount (Option A); if so, persist any name/color/icon edited
      // AFTER connecting rather than inserting a DUPLICATE account (the field
      // already handled the credential + first sync). Otherwise this Save is
      // the first write, so create the row now — an unconnected bank/crypto
      // account is valid (the user connects a source later from its detail
      // screen), and a property or metals account has no source to connect at
      // all — it always takes this branch.
      if (accountCreate.current !== null) {
        await accountsRepo.update(pendingAccountId, { name: trimmedName, color, bankId });
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

  const { onPress: onSave, isSubmitting } = useSubmitOnce(save);

  // Selecting an account type re-seeds the icon field with that type's default
  // glyph; the user can still override it in the picker afterward, and picking
  // a different type resets the icon to the new type's default. Only reachable
  // in create mode — the kind chip is disabled in edit mode below.
  const handleSelectKind = (nextKind: Kind): void => {
    setKind(nextKind);
    setIcon(accountKindSymbol[nextKind]);
    setBankId(null);
  };

  return (
    <Screen
      scroll
      scrollableRef={scrollableRef}
      automaticallyAdjustKeyboardInsets={!isCurrencySheetOpen}
      onContentSizeChange={(_width, height) => {
        contentHeightRef.current = height;
      }}
      footer={
        <Button onPress={onSave} disabled={isSubmitting}>
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
        <View ref={nameFieldRef}>
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
            error={showNameError && !canSave ? t('forms.fields.nameRequiredError') : undefined}
            nameInputRef={nameInputRef}
            testID="holding-identity-name-field"
          />
        </View>

        <ColorPicker label={t('forms.fields.color')} value={effectiveColor} onSelect={setColor} />

        <Divider testID="form-divider" />

        {/* Kind fixes an account's structure (a cash account owns an initial
            cash holding; a bank/crypto does not), and no repo path re-shapes it,
            so it is read-only in edit mode — shown, but not switchable. It also
            locks once a bank/crypto source has been connected (which already
            inserted the row): switching kind afterwards would make Save create a
            SECOND account and orphan the started row. */}
        <AccountKindField
          label={t('forms.account.kind')}
          sheetTitle={t('forms.account.kindSheetTitle')}
          options={kinds}
          selected={kind}
          onSelect={handleSelectKind}
          labels={kindLabels}
          subtitles={kindSubtitles}
          icons={accountKindSymbol}
          disabled={isEdit || accountRowStarted}
          testID="account-kind-field"
        />

        {/* The currency + initial value seed the cash account's initial holding
            at creation only; they have no meaning once the holding exists (its
            balance is edited on the holding itself), so the edit form omits
            them. */}
        {!isEdit && kind === 'cash' && (
          <>
            <CurrencyField
              label={t('forms.fields.currency')}
              selected={currency}
              onSelect={setCurrency}
              options={fiatCurrencyOptions}
              onOpenChange={setIsCurrencySheetOpen}
              testID="account-currency-field"
            />

            <TextField
              label={t('forms.account.initialValue')}
              value={initialValue}
              onChangeText={(text) => setInitialValue(groupAmount(text))}
              keyboardType="decimal-pad"
              placeholder={t('forms.account.initialValuePlaceholder')}
              suffix={currencySymbol[currency]}
            />
          </>
        )}

        {/* The "which bank does this account represent" identity picker
            (Option A) — shown in BOTH create and edit mode (F2 fix: the edit
            form used to have no way at all to view or change `bankId`). The
            live-sync Connect field stays CREATE-ONLY — editing an already-
            connected account's real connection is BankSyncSection's job on
            the account-detail screen (Monobank-only, Guideline 5.6),
            untouched here. Changing `bankId` in this field never writes
            `institution`/the Keychain/sync state (kiko-domain: `bankId` is
            deliberately never read by `isSyncedAccount`), so it stays safe
            to edit even on an already-connected Monobank account. The
            credential field itself is NOT required (no asterisk): an
            account still creates with no credentials — a secret is masked
            and write-only, going straight to the Keychain on save, never
            into a stored row or a log. */}
        {kind === 'bank' && (
          <Box gap={4}>
            <Divider testID="form-divider" />

            {/* F4 audit item 22: this used to be create-only, so an edit
                render's bank block sat under a bare divider with no heading
                naming the section at all — the SAME heading create mode
                already shows above `BankTypeField`. */}
            <Text variant="heading">{t('accountDetail.synchronization')}</Text>

            <BankTypeField
              label={t('forms.account.bankType')}
              selected={bankId}
              onSelect={setBankId}
              testID="account-bank-type-field"
            />

            {!isEdit && bankId === 'monobank' && (
              <MonobankConnectField onConnect={connectMonobank} />
            )}

            {bankId !== null && bankId !== 'monobank' && (
              <Text variant="caption" tone="textSecondary">
                {t('forms.account.importOnlyBankHint')}
              </Text>
            )}
          </Box>
        )}

        {/* The SAME Wallet|Binance sync form the account-detail screen uses,
            reused here rather than hand-rolled. It renders the moment Crypto is
            selected — full parity with the bank form above, with NO name gate.
            The create invariant is enforced instead of hidden: each field's own
            Connect inserts the account row (via ensureAccount) keyed by the
            pre-generated id, and ensureAccount refuses to create a row while
            `!canSave` (empty name), mirroring the bank Save gate. A Connect tapped
            early surfaces both the field's "could not connect" state and the
            name-required reason above, and writes no row. */}
        {!isEdit && kind === 'crypto' && (
          <Box gap={4}>
            <Divider testID="form-divider" />

            <Text variant="heading">{t('accountDetail.synchronization')}</Text>

            <CryptoSyncForm
              accountId={pendingAccountId}
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
