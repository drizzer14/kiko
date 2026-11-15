import { match } from 'ts-pattern';
import {
  accountDisplayName,
  implicitAccountStoredName,
  isImplicitAccountKind,
} from '@kiko/holdings/implicit-account';
import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { useSync } from '@kiko/sync/use-sync';
import { accountsRepo } from '@kiko/accounts';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import {
  type CurrencyPickerContext,
  useCurrencyPickerGroups,
} from '@kiko/holdings/currency-picker-groups';
import { logOnFailure } from '@kiko/diagnostics';
import { saveToken } from '@kiko/monobank/token';
import { parseAmount } from '@kiko/currency/parse';
import { holdingsRepo } from '@kiko/holdings/repo';
import {
  type FormHeaderItemsOptions,
  useFormHeaderItems,
} from '@kiko/screens/forms/use-form-header-items';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import either, { bifoldr, isRight } from 'fnts/either';
import { type BrokerId, isBrokerId } from '@kiko/brokers';
import { useCryptoSync } from '@kiko/sync/use-crypto-sync';
import Screen from '@kiko/design-system/components/screen';
import { View, type TextInputInstance } from 'react-native';
import { id, type AccountRow, useLiveQuery } from '@kiko/db';
import Divider from '@kiko/design-system/components/divider';
import BankTypeField from '@kiko/screens/forms/bank-type-field';
import { groupAmount } from '@kiko/screens/forms/amount-format';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import TextField from '@kiko/design-system/components/text-field';
import { accountIconPool } from '@kiko/holdings/entity-icon-pool';
import { refreshMarketData } from '@kiko/sync/refresh-market-data';
import { defaultAccountColor } from '@kiko/holdings/entity-colors';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import BrokerTypeField from '@kiko/screens/forms/broker-type-field';
import ColorPicker from '@kiko/design-system/components/color-picker';
import AccountKindField from '@kiko/screens/forms/account-kind-field';
import { useDraftAutosave } from '@kiko/navigation/use-draft-autosave';
import { type Currency, currencySymbol } from '@kiko/currency/currency';
import ExchangeTypeField from '@kiko/screens/forms/exchange-type-field';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import type { WriteToken } from '@kiko/crypto-sync/exchange/credentials';
import CurrencyField from '@kiko/design-system/components/currency-field';
import { useScrollToField } from '@kiko/design-system/use-scroll-to-field';
import { clearBybitCredentialsIfWrittenBy } from '@kiko/crypto-sync/bybit';
import type { ExchangeCatalogId } from '@kiko/crypto-sync/exchange-catalog';
import CryptoSyncForm from '@kiko/design-system/components/crypto-sync-form';
import { isSavedDraft, useDraftParam } from '@kiko/navigation/use-draft-param';
import { useActiveColorScheme } from '@kiko/design-system/active-color-scheme';
import { keepsBybitHoldings } from '@kiko/crypto-sync/conflicting-exchange-holdings';
import { handBackCreatedOption } from '@kiko/screens/forms/use-select-created-option';
import { accountKindSymbol, genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import { type BankId, isBankId, isSpecificBankId } from '@kiko/bank-sync/bank-catalog';
import HoldingIdentityField from '@kiko/design-system/components/holding-identity-field';
import MonobankConnectField from '@kiko/design-system/components/monobank-connect-field';
import { entityDisplayColor, resolveEntityColor } from '@kiko/design-system/entity-tint';
import { type BinanceWriteToken, clearCredentialsIfWrittenBy } from '@kiko/crypto-sync/binance';
import type { AccountFormDraft, AccountsStackParamList, FormDraft } from '@kiko/navigation/types';
import { type ComponentProps, type FC, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { usePendingRowLock } from './use-pending-row-lock';
import { useConnectReminder } from './use-connect-reminder';

// This screen is registered in the Accounts, Home, and Settings stacks (Home and Settings
// reach it from the transaction form's empty pickers), so it cannot bind its props to one
// stack's param list. It declares exactly the navigation methods it calls, structurally
// satisfied by any of the stacks.
type AccountFormScreenProps = {
  route: { params: AccountsStackParamList['AccountForm'] };
  navigation: {
    goBack: () => void;
    setOptions: (options: { title: string } | FormHeaderItemsOptions) => void;
    setParams: (params: { draft: FormDraft | AccountFormDraft }) => void;
    replace: (name: 'HoldingForm', params: AccountsStackParamList['HoldingForm']) => void;
  };
};

// A crypto account is created like a bank account — no initial holding/currency
// at creation; holdings are added later — so only cash needs the currency +
// initial-value fields below; metals has no extra creation fields. Property and
// debt are never created here: picking one swaps in the holding form.
type Kind = AccountRow['kind'];

type CreateSeed = {
  kind: Kind;
  name: string;
  icon: string | null;
  iconIsDirty: boolean;
  color: string | null;
  currency: Currency;
  accountCurrency: Currency | null;
  initialValue: string;
  bankId: BankId | null;
  brokerId: BrokerId | null;
  exchangeId: ExchangeCatalogId | null;
};

// What a create form opens with: a plain create opens on the default kind with
// that kind's glyph, and a swap back from the holding form carries the
// identity the user already typed. A carried icon is a pick, so it stays one;
// an absent one follows the opening kind's default like any untouched icon.
// A draft of the form's own saved fields comes back as it was, whatever kind
// the swap named.
const createSeed = (
  initialKind: Kind | undefined,
  draft: FormDraft | AccountFormDraft | undefined,
): CreateSeed => {
  if (isSavedDraft(draft)) {
    // A draft saved before a field existed has no such key, and reads as untouched.
    return {
      ...draft,
      accountCurrency: draft.accountCurrency ?? null,
      exchangeId: draft.exchangeId ?? null,
    };
  }

  const kind = initialKind ?? INITIAL_KIND;

  return {
    kind,
    name: draft?.name ?? '',
    icon: draft?.icon ?? accountKindSymbol[kind],
    iconIsDirty: typeof draft?.icon === 'string',
    color: draft?.color ?? null,
    currency: 'UAH',
    accountCurrency: null,
    initialValue: '',
    bankId: null,
    brokerId: null,
    exchangeId: null,
  };
};

type Opening = CreateSeed & {
  // The id the form made for the account it may create, kept across a remount from a saved draft.
  pendingAccountId: string;
  // Whether it opens on the form's own saved draft, which an edit must not overwrite from the
  // stored account.
  isSaved: boolean;
};

// Everything the form's state opens with, worked out once. An edit starts with no icon, to be
// hydrated from the stored account; a saved draft has the icon as the user left it.
const openingOf = (
  isEdit: boolean,
  initialKind: Kind | undefined,
  draft: FormDraft | AccountFormDraft | undefined,
): Opening => {
  const seed = createSeed(initialKind, draft);
  const isSaved = isSavedDraft(draft);

  return {
    ...seed,
    icon: isEdit && !isSaved ? null : seed.icon,
    pendingAccountId: isSavedDraft(draft) ? draft.pendingAccountId : id(),
    isSaved,
  };
};

// A stored `kind` can hold a value outside the CURRENT schema enum — the
// schema's `enum` is TS-only (no DB CHECK constraint), so a row under a kind
// outside the current list can persist. Guards the edit-mode
// hydration below against that case so an unrecognized stored kind never
// assigns outside `Kind`'s own type (and the symbol/color lookups below never
// silently miss).
const isSupportedKind = (value: string): value is Kind => Object.hasOwn(accountKindSymbol, value);

// `accounts.bankId` holds the catalog identity of whichever kind has a picker,
// so each kind writes only its own picker's pick: a broker id never lands on a
// bank account, a bank id never on a broker, and an exchange id only on a crypto account.
const catalogIdFor = (
  kind: Kind,
  picks: { bankId: BankId | null; brokerId: BrokerId | null; exchangeId: ExchangeCatalogId | null },
): BankId | BrokerId | ExchangeCatalogId | null =>
  match(kind)
    .with('broker', () => picks.brokerId)
    .with('crypto', () => picks.exchangeId)
    .otherwise(() => picks.bankId);

// A NEW bank or broker account must say which one it is; the picker's kind
// names the issue so its error key follows. Edit never requires it, so an
// account saved before the pick was required is not forced to pick on its next
// edit. Pure, at module scope, to keep this branching out of
// AccountFormScreen's own cognitive complexity score.
const missingCatalogPick = (
  isEdit: boolean,
  kind: Kind,
  catalogId: string | null,
): 'bank' | 'broker' | null => {
  if (isEdit || catalogId !== null) {
    return null;
  }

  return kind === 'bank' || kind === 'broker' ? kind : null;
};

const CATALOG_PICK_ERROR_KEY = {
  bank: 'forms.account.bankRequiredError',
  broker: 'forms.account.brokerRequiredError',
} as const;

// The shared attempted-submit gate: no error before the first blocked press.
// Module scope, with `t` passed in, because AccountFormScreen's cognitive
// complexity score already sits at Biome's cap of 15 and this gate would add 2.
const catalogPickErrorText = (
  t: TFunction,
  attemptedSave: boolean,
  issue: keyof typeof CATALOG_PICK_ERROR_KEY | null,
): string | undefined =>
  attemptedSave && issue !== null ? t(CATALOG_PICK_ERROR_KEY[issue]) : undefined;

// The kind a fresh create form starts on. Its default icon (accountKindSymbol)
// seeds the icon field so the form opens on a sensible glyph rather than the
// neutral fallback below.
const INITIAL_KIND: Kind = 'bank';

const CASH_CURRENCY_CONTEXT = { kind: 'fiat' } as const;

// A crypto account lists the coins first, as a crypto holding does; every other kind keeps the one
// list of held, fiat and crypto, which is not widened or narrowed per kind.
const ACCOUNT_CURRENCY_CONTEXT: Record<Kind, CurrencyPickerContext> = {
  bank: { kind: 'any' },
  cash: { kind: 'any' },
  crypto: { kind: 'holding', type: 'crypto_asset' },
  property: { kind: 'any' },
  metals: { kind: 'any' },
  debt: { kind: 'any' },
  broker: { kind: 'any' },
};

// A new cash account has one currency field, the cash one, which also sets the account currency.
// Every other kind has the account-currency field, on create and on edit. A property or debt
// account is only ever edited here (a create swaps to the holding form), where its section total
// on the Accounts screen follows the pick.
const hasAccountCurrencyField = (isEdit: boolean, kind: Kind): boolean => isEdit || kind !== 'cash';

// The edit patch carries the currency only when the user changed it: the write then touches
// `accounts.currency` alone, for a cash account too, and never its holding or an amount.
const currencyPatch = (
  picked: Currency | null,
  stored: Currency | undefined,
): { currency?: Currency } => (picked !== null && picked !== stored ? { currency: picked } : {});

// A currency the user just picked needs its rate visible without an app restart: the rate gate
// counts a non-archived account's currency, but only a refresh fetches the rate. The SAME gated
// refresh the holding form runs after a create, unthrottled (a deliberate user action, not a
// background poll). It skips the network only when every held and account currency is the base
// currency, so the cost is one fetch per save, as for the holding form. No metals: an account
// currency is a fiat or a coin, and a metal price is only read for a held metal.
// `refreshMarketData` never rejects and logs its own failure, so a committed write never turns
// into a shown error; fire-and-forget, as Save must not sit on the network before navigating
// back.
const refreshAfterCurrencyWrite = (): void => {
  // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) never rejects
  refreshMarketData({ throttled: false, metals: false });
};

// Neutral placeholder glyph shown in the create form's icon chip until the user
// picks one (and the glyph a cleared icon falls back to). The persisted default
// (a kind-derived icon) is applied by the account list rows when the stored icon
// is null; here the account has no kind context worth deriving from yet, so the
// generic account reference (`tray`) reads as "unset" — never the retired
// `square.grid.2x2`.
const FALLBACK_ICON = genericEntitySymbol.account;

// The cash-only initial value field's own two error reasons — a blank or
// unparseable typed value is "missing", distinct from a valid but negative one
// (a cash balance can never be negative, but 0 is a valid typed value). Pure —
// no closure — kept at module scope per kiko-code-style's helper placement
// rule, and to keep this branching out of AccountFormScreen's own cognitive
// complexity score.
type InitialValueIssue = 'missing' | 'negative' | null;

const initialValueIssue = (rawValue: string): InitialValueIssue => {
  const trimmed = rawValue.trim();
  const parsed = parseAmount(trimmed);

  if (trimmed === '' || Number.isNaN(parsed)) {
    return 'missing';
  }

  return parsed < 0 ? 'negative' : null;
};

const INITIAL_VALUE_ERROR_KEY = {
  missing: 'forms.account.initialValueRequiredError',
  negative: 'forms.account.initialValueNegativeError',
} as const;

// The glyph an unset icon shows: an implicit account's own kind glyph (its
// stored icon is NULL until the user picks one, and the lists show the kind's
// glyph for it), else the neutral placeholder.
const fallbackIconFor = (kind: Kind): string =>
  isImplicitAccountKind(kind) ? accountKindSymbol[kind] : FALLBACK_ICON;

// The name an edit writes: an implicit account whose name is still its default
// stays the sentinel (see `implicitAccountStoredName`), any other is as typed.
const storedName = (kind: Kind, trimmedName: string, t: TFunction): string =>
  isImplicitAccountKind(kind) ? implicitAccountStoredName(kind, trimmedName, t) : trimmedName;

// What the kind field shows: the Property or Loan just picked, else the form's
// own kind. At module scope to keep this branch out of AccountFormScreen's own
// cognitive complexity score, which already sits at Biome's cap.
const shownKind = (kind: Kind, pickedImplicitKind: Kind | undefined): Kind =>
  pickedImplicitKind ?? kind;

// What the field shows for an untouched account currency: the base, or the settings column's own
// default while the row is not read yet. Display only: no write reads it.
const shownAccountCurrency = (picked: Currency | null, base: Currency | undefined): Currency =>
  picked ?? base ?? 'UAH';

type AccountCurrencyFieldProps = {
  isEdit: boolean;
  kind: Kind;
  selected: Currency;
  onSelect: (currency: Currency) => void;
};

// The account-currency field and its hint, for the kinds that have one. A component of its own,
// with the visibility check inside, to keep that branch out of AccountFormScreen's own cognitive
// complexity score, which already sits at Biome's cap.
const AccountCurrencyField: FC<AccountCurrencyFieldProps> = ({
  isEdit,
  kind,
  selected,
  onSelect,
}) => {
  const { t } = useTranslation();
  const groups = useCurrencyPickerGroups(ACCOUNT_CURRENCY_CONTEXT[kind]);

  if (!hasAccountCurrencyField(isEdit, kind)) {
    return null;
  }

  return (
    <Box gap={1}>
      <CurrencyField
        label={t('forms.fields.currency')}
        sheetTitle={t('forms.fields.currencySheetTitle')}
        selected={selected}
        onSelect={onSelect}
        groups={groups}
        testID="account-currency-field"
      />

      <Text variant="caption" tone="textSecondary">
        {t('forms.account.currencyHint')}
      </Text>
    </Box>
  );
};

// A first Connect stores the owner of its key, and writes a Bybit holding only when the account has
// a coin to show, so the next key is compared only while the pending account keeps one: its own
// component, so no other kind of form builds the holdings read.
const PendingCryptoSyncForm: FC<
  Omit<ComponentProps<typeof CryptoSyncForm>, 'keepsBybitHoldings'>
> = (props) => {
  const { data: holdings } = useLiveQuery(holdingsRepo.listByAccountQuery(props.accountId), [
    'holdings',
  ]);

  return <CryptoSyncForm {...props} keepsBybitHoldings={keepsBybitHoldings(holdings)} />;
};

const AccountFormScreen: FC<AccountFormScreenProps> = ({ route, navigation }) => {
  // An `accountId` in the route params switches the form to EDIT mode: the same
  // fields, seeded from the existing account, saving through the update path
  // rather than create. Absent (the accounts list passes `{}`), it is a plain
  // create form.
  const editId = route.params?.accountId;
  const isEdit = editId !== undefined;
  const handbackId = route.params?.handbackId;

  const { t } = useTranslation();
  const cashCurrencyGroups = useCurrencyPickerGroups(CASH_CURRENCY_CONTEXT);

  const { initialDraft, saveDraft } = useDraftParam<FormDraft | AccountFormDraft>(
    navigation,
    route,
  );
  const [opening] = useState(() => openingOf(isEdit, route.params?.initialKind, initialDraft));

  const [name, setName] = useState(opening.name);
  const [kind, setKind] = useState<Kind>(opening.kind);
  // The Property or Loan the user just picked, shown on the kind field until
  // the swap replaces this screen (see `handleSelectKind`).
  const [pickedImplicitKind, setPickedImplicitKind] = useState<Kind | undefined>(undefined);
  const [currency, setCurrency] = useState<Currency>(opening.currency);
  // The account currency of every non-cash create and of every edit, cash included (an edit
  // seeds it from the stored value). null = untouched: the field then shows the base, but the
  // write gets null, so the base is read inside the write (a create) or the stored currency is
  // left alone (an update). A cash create has no such pick: its `currency` above is both the
  // cash holding's and the account's.
  const [accountCurrency, setAccountCurrency] = useState<Currency | null>(opening.accountCurrency);
  const [initialValue, setInitialValue] = useState(opening.initialValue);
  // A create form seeds the icon with the initially-selected kind's default
  // glyph so it opens on a sensible symbol; the user can still override it in
  // the picker below. Edit mode starts null and is hydrated from the stored
  // row (below), so the seed never clobbers a saved icon.
  const [icon, setIcon] = useState<string | null>(opening.icon);
  // Whether `icon` is the user's own pick rather than the kind's default, which
  // is all a swap to the holding form may carry: it re-derives its own default.
  // A kind switch resets the icon, so it resets this too.
  const [iconIsDirty, setIconIsDirty] = useState(opening.iconIsDirty);
  // Mirrors the icon's dirty pattern: null until the user taps a swatch. While
  // null, the effective color follows the selected kind's default
  // (defaultAccountColor[kind]) — the ColorPicker highlights that swatch and
  // switching kind moves it; once picked, the choice sticks.
  const [color, setColor] = useState<string | null>(opening.color);
  // The bank the user picked in the sync section's BankTypeField, tagging the
  // created row for later provider-specific handling (import, connect status).
  // null = nothing picked yet: a new bank account cannot Save until it is set
  // (`missingCatalogPick`), `other` being the pick for any bank not listed. Never
  // auto-seeded on a fresh bank create (no auto-jump to Monobank). An existing
  // account saved before the pick was required can still hold null here, and
  // keeps it on edit.
  const [bankId, setBankId] = useState<BankId | null>(opening.bankId);
  // The broker picked in BrokerTypeField, the same shape as `bankId`.
  const [brokerId, setBrokerId] = useState<BrokerId | null>(opening.brokerId);
  // The exchange or wallet picked in ExchangeTypeField on a crypto create form, the same shape as
  // `bankId`. null = nothing picked: the account saves with no bank id, and is not required to
  // pick one.
  const [exchangeId, setExchangeId] = useState<ExchangeCatalogId | null>(opening.exchangeId);
  const catalogId = catalogIdFor(kind, { bankId, brokerId, exchangeId });
  // `resolveEntityColor` — not a bare nullish-coalesce onto the kind default —
  // because `color`/`kind` here are seeded straight from a stored row
  // (setColor(editingAccount.color) / setKind(editingAccount.kind) below): a
  // stored empty-string color and a since-removed kind (the schema enum is
  // TS-only, no CHECK constraint) both reach here as unusable values the bare
  // pattern would let through as ''/undefined.
  const effectiveColor = resolveEntityColor(color, defaultAccountColor[kind]);
  const scheme = useActiveColorScheme();

  // The same Connect actions the account-detail screen uses. On a create the
  // account row is created FIRST, then the credential is saved and the connect
  // runs against its id — a bad credential leaves a created-but-unconnected
  // account the user repairs from its detail screen (connect-first: the field's
  // Connect creates the row before Save). Every kind runs
  // its connect on a field's OWN Connect (connectMonobank for bank;
  // connectWallet / connectBinance for crypto) — there is no implicit connect on
  // Save any more.
  const { sync: syncMonobank } = useSync();
  const { sync: syncCrypto } = useCryptoSync();
  // Its own instance, so a refusal text shows only under the Bybit field: a failed Binance or
  // wallet connect, then a switch to Bybit, would otherwise leave that text there.
  const {
    sync: syncBybit,
    error: bybitConnectError,
    clearError: clearBybitConnectError,
  } = useCryptoSync();

  // The account's id is pre-generated once for this create session so the
  // per-source fields — which bind to an EXISTING account id (a per-account
  // Keychain item and a `sync({ targetAccountId })`) — have a stable id to key
  // against before the row exists. Every Connect inserts the row with this exact id (and leaves
  // a stored one as it is), so a field's Keychain write and first sync land on a row that exists,
  // and Save then writes to the same id. Shared by both the bank and crypto kinds. No ref
  // remembers the insert: whether the row exists is the database's to say, because a fold can
  // leave a Connect running in the old screen that inserts the row after this one opened, and a
  // row can be deleted elsewhere after a Connect inserted it.
  const { pendingAccountId } = opening;
  // A render-visible mirror of "a Connect has started inserting the row", used only to DISABLE
  // the kind switch and the bank picker once a source is connected — switching kind afterwards
  // would leave a started row of the old kind behind, and re-picking the bank would make Save
  // overwrite the connected row's bank id. It is state because the disable must re-render; it is
  // reset to false on a failed insert, and the live query below keeps the lock on while a row is
  // stored.
  const [accountRowStarted, setAccountRowStarted] = useState(false);
  // The account being edited, or in a create form the row a Connect inserted under the pending id,
  // possibly from the screen a fold replaced.
  const { data: accounts } = useLiveQuery(accountsRepo.byIdQuery(editId ?? pendingAccountId), [
    'accounts',
  ]);
  // Display only: the base the untouched account-currency field shows. No write reads it.
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const draft: AccountFormDraft = {
    saved: true,
    name,
    icon,
    iconIsDirty,
    color,
    kind,
    currency,
    accountCurrency,
    initialValue,
    bankId,
    brokerId,
    exchangeId,
    pendingAccountId,
  };
  const onFieldBlur = useDraftAutosave(draft, saveDraft);
  // A form that remounted from its saved draft does not know yet whether the screen a fold
  // replaced still has the insert of the pending row queued, which the live query above shows
  // only once it lands. Locked, a pick cannot send Save to a second account or clear that row's
  // bank; the lock lifts only when the write queue says no such row is stored.
  const isRowUnknown = usePendingRowLock(pendingAccountId, !isEdit && opening.isSaved);
  const isPickLocked = isEdit || accountRowStarted || accounts.length > 0 || isRowUnknown;
  // ONE shared attempted-submit flag for every validated field on this form
  // (kiko-code-style's form validation model), set true by a blocked Connect
  // OR a blocked Save — never a per-field flag: each field's own error below
  // still derives from ONLY its own value, this just gates when either can
  // first show, so a fresh create form shows no error before the user has
  // tried to submit.
  const [attemptedSave, setAttemptedSave] = useState(false);

  // The name field's own wrapper — a blocked Connect/Save (empty name) scrolls
  // it into view alongside its inline error, rather than leaving the reason
  // rendered off-screen above the fold. See scroll-to-field.ts.
  const { scrollableRef, onContentSizeChange, scrollTo } = useScrollToField();
  // A Connect field holding typed input that was not connected turns the first Save press into a
  // reminder under its Connect button (see `useConnectReminder`).
  const { reminderFor, remindOnSave } = useConnectReminder(scrollTo);
  const nameFieldRef = useRef<FieldInstance>(null);
  // The name field's own inner TextInput, so a blocked Connect/Save can
  // focus it imperatively once it has scrolled into view (see `onSettled`
  // below) — HoldingIdentityField's own `nameInputRef` prop already exposes
  // this same ref shape.
  const nameInputRef = useRef<TextInputInstance>(null);
  // The cash-only initial-value field's own wrapper + inner TextInput refs —
  // the SAME pair the name field above carries, so a blocked Save on it scrolls
  // and focuses exactly like a blocked name does.
  const initialValueFieldRef = useRef<FieldInstance>(null);
  const initialValueInputRef = useRef<TextInputInstance>(null);
  // The bank or broker picker's wrapper — one ref, since only one of the two
  // renders at a time. A picker has no keyboard, so a blocked Save only
  // scrolls it into view; the error under it is the cue.
  const catalogFieldRef = useRef<FieldInstance>(null);

  // What both writes of the account row store. The icon goes in the same write as the rest: a
  // second write could fail after the row exists, and a Binance connect would then clear the key
  // pair of an account that is there.
  const accountRow = (): Parameters<typeof accountsRepo.saveFormAccount>[0] => ({
    id: pendingAccountId,
    name: trimmedName,
    // Neither cash (createCashAccount returns before this) nor property/debt
    // (the swap to the holding form leaves this form first) reaches here.
    kind,
    // The raw pick, never `accountCurrency ?? baseCurrency`: null makes the write read the base
    // itself and never rewrite a stored currency. A value read here would be the first-frame
    // fallback or a base another tab has since changed.
    currency: accountCurrency,
    color,
    icon,
    bankId: catalogId,
  });

  const ensureAccount = (): Promise<string> => {
    // Parity with the bank Save gate (`canSave = trimmedName !== ''`): a sync
    // form is always visible and a credential/address may be entered, but NO
    // account row is ever created without a name. A field's own Connect tapped
    // with an empty (whitespace-only) name rejects HERE before any insert — the
    // field surfaces its existing "could not connect" state and the name-required
    // reason renders below the name field so the user understands why. The
    // `accountRowStarted` kind-lock is left untouched (no row was started), so a
    // retry after typing a name re-attempts cleanly. Save is separately blocked
    // on `!canSave`, so this also guards the programmatic path.
    if (!canSave) {
      setAttemptedSave(true);
      scrollTo(nameFieldRef, () => nameInputRef.current?.focus());

      return Promise.reject(new Error('name-required'));
    }
    setAccountRowStarted(true);

    // A row already stored under the pending id (an earlier Connect, or another screen's after a
    // fold) is left as it is, so every Connect can insert and none depends on an earlier one.
    return accountsRepo.createIfAbsent(accountRow()).catch((error: unknown) => {
      setAccountRowStarted(false);
      throw error;
    });
  };

  // Shared by every field's Connect handler below: `true` once the account row
  // exists (creating it on first call), `false` on any failure — a name-missing
  // rejection or a failed insert — so each caller returns its own "could not
  // connect" `false` without repeating the same try/catch three times.
  // The thunk must itself be `async`: fnts `either` calls it OUTSIDE the
  // promise chain, so a plain `() => ensureAccount()` lets a synchronous
  // throw (e.g. `scrollToField` failing before the name-required reject)
  // escape `either` entirely instead of becoming a Left.
  const accountEnsured = async (): Promise<boolean> =>
    isRight(await either(async () => ensureAccount()));

  // The bank field creates the row FIRST (connect-first), then stores the validated
  // token to the Keychain keyed by the pre-generated id, then runs the first
  // Monobank sync against it (the write-only-secret order).
  // Any failure BEFORE the sync returns false so the field shows its "could not
  // connect" status rather than an unhandled rejection. The token goes ONLY to the Keychain —
  // never to the database or a log.
  const connectMonobank = async (token: string): Promise<boolean> => {
    if (!(await accountEnsured())) {
      return false;
    }

    try {
      // The token binds to the pre-generated account id (a per-account Keychain
      // item), so it can never clobber another account's secret.
      await saveToken(pendingAccountId, token);
    } catch {
      return false;
    }

    return syncMonobank(pendingAccountId);
  };

  // Both crypto fields create the row FIRST (connect-first), then run the shared sync
  // against it. `CryptoSyncForm`/`BinanceCredentialsField` validate the
  // credential and write the Binance secret to the Keychain themselves, keyed by
  // the pre-generated id, before calling these — the secret never reaches this
  // screen, the DB, or a log (the Binance callbacks get only the token of the field's write). A
  // create failure is caught here (via
  // `accountEnsured`) and surfaced to the field as a `false` (not-connected)
  // result, so the field shows its "could not connect" status instead of an
  // unhandled rejection that would leave it stuck on "checking".
  const connectWallet = async (address: string): Promise<boolean> => {
    if (!(await accountEnsured())) {
      return false;
    }

    return syncCrypto({
      providerId: 'btc_wallet',
      targetAccountId: pendingAccountId,
      address,
    });
  };

  // A field stored a pair under the pre-generated account id with the write `written`, and no
  // Connect of it will follow: the exchange's Connect failed to ensure the row, or the field
  // unmounted during the write and the form decides instead. Only when no row owns the id does
  // nothing else ever clear the pair: a reject on an empty name leaves a row that is there with its
  // keys, even one another screen's Connect has still queued (the read waits behind it), and a
  // failed read of the row keeps them too. The clear removes the pair `written` stored and no other
  // write's, not even an equal pair: a remounted field saves its own pair outside the write queue,
  // possibly after the read above answered. A failed clear is logged: the caller still reports its
  // own outcome.
  const clearPairIfRowMissing = async (
    exchange: 'Binance' | 'Bybit',
    clearIfWrittenBy: (accountId: string, written: WriteToken) => Promise<void>,
    written: WriteToken,
  ): Promise<void> => {
    const rowIsMissing =
      bifoldr(await either<unknown, boolean>(async () => accountsRepo.exists(pendingAccountId))) ===
      false;

    if (rowIsMissing) {
      await logOnFailure(`[account-form] the ${exchange} key pair could not be cleared`, () =>
        clearIfWrittenBy(pendingAccountId, written),
      );
    }
  };

  const clearBinancePairIfRowMissing = (written: BinanceWriteToken): Promise<void> =>
    clearPairIfRowMissing('Binance', clearCredentialsIfWrittenBy, written);

  const clearBybitPairIfRowMissing = (written: WriteToken): Promise<void> =>
    clearPairIfRowMissing('Bybit', clearBybitCredentialsIfWrittenBy, written);

  // The key-pair exchanges connect the same way: the field stored the pair first, so a Connect that
  // cannot create the row clears it before it reports the failure.
  const connectKeyPair = async (
    stored: WriteToken,
    clearPair: (written: WriteToken) => Promise<void>,
    sync: () => Promise<boolean>,
  ): Promise<boolean> => {
    if (!(await accountEnsured())) {
      await clearPair(stored);

      return false;
    }

    return sync();
  };

  const connectBinance = (stored: BinanceWriteToken): Promise<boolean> =>
    connectKeyPair(stored, clearBinancePairIfRowMissing, () =>
      syncCrypto({ providerId: 'binance', targetAccountId: pendingAccountId }),
    );

  const connectBybit = (stored: WriteToken): Promise<boolean> =>
    connectKeyPair(stored, clearBybitPairIfRowMissing, () =>
      syncBybit({ providerId: 'bybit', targetAccountId: pendingAccountId }),
    );

  // In edit mode, the account being edited seeds the form (the query above always runs: hooks
  // can't be conditional).
  const editingAccount = isEdit ? accounts.at(0) : undefined;

  // Seed the form once from the loaded account. `useLiveQuery` resolves
  // asynchronously, so the initial render precedes the data; a one-shot ref
  // guards against re-seeding (and clobbering the user's in-progress edits) on
  // every subsequent live-query emission. A saved draft is the user's edits, so
  // it starts the ref spent and the stored account never overwrites it.
  const hydrated = useRef(opening.isSaved);
  useEffect(() => {
    if (!isEdit || hydrated.current || editingAccount === undefined) {
      return;
    }
    hydrated.current = true;
    setName(accountDisplayName(editingAccount, t));
    setKind(isSupportedKind(editingAccount.kind) ? editingAccount.kind : INITIAL_KIND);
    setIcon(editingAccount.icon);
    setColor(editingAccount.color);
    // The edit form seeds `bankId` too, so the disabled picker below shows the
    // bank or broker the account was created with.
    // `isBankId` guards against a stored value from a since-removed catalog
    // entry, mirroring `isSupportedKind` above.
    setBankId(isBankId(editingAccount.bankId) ? editingAccount.bankId : null);
    setBrokerId(isBrokerId(editingAccount.bankId) ? editingAccount.bankId : null);
    setAccountCurrency(editingAccount.currency);
  }, [isEdit, editingAccount, t]);

  // The stack sets the static "Add Account" title; in edit mode override it with
  // "Edit Account" so the header reads correctly for the update flow.
  useLayoutEffect(() => {
    if (isEdit) {
      navigation.setOptions({ title: t('forms.account.editTitle') });
    }
  }, [isEdit, navigation, t]);

  const trimmedName = name.trim();
  const canSave = trimmedName !== '';

  // Not part of `canSave`: that gates the name error and `ensureAccount`,
  // which a field's own Connect shares, and neither is about this pick.
  const catalogPickIssue = missingCatalogPick(isEdit, kind, catalogId);
  const catalogPickError = catalogPickErrorText(t, attemptedSave, catalogPickIssue);

  const initialValueProblem = initialValueIssue(initialValue);
  const initialValueError =
    attemptedSave && initialValueProblem !== null
      ? t(INITIAL_VALUE_ERROR_KEY[initialValueProblem])
      : undefined;

  // The initial-value field only exists for a NEW cash account (see its
  // conditional render below), so it can never block Save in edit mode or
  // for any other kind.
  const initialValueInvalid = !isEdit && kind === 'cash' && initialValueProblem !== null;

  const save = async (): Promise<void> => {
    // Every blocked field's own issue is computed up front — not one early
    // return per field — so with BOTH the name and the initial value blank,
    // both show together on the first Save press rather than the name error
    // hiding the initial-value one until a second press (kiko-code-style's
    // form validation model). Only the SCROLL target picks one: the first
    // invalid field in the form's own top-to-bottom order (name, bank or
    // broker pick, then initial value).
    const scrollTargets = [
      { invalid: !canSave, ref: nameFieldRef, focus: () => nameInputRef.current?.focus() },
      { invalid: catalogPickIssue !== null, ref: catalogFieldRef, focus: undefined },
      {
        invalid: initialValueInvalid,
        ref: initialValueFieldRef,
        focus: () => initialValueInputRef.current?.focus(),
      },
    ];
    const firstInvalid = scrollTargets.find((target) => target.invalid);

    if (firstInvalid !== undefined) {
      setAttemptedSave(true);
      scrollTo(firstInvalid.ref, firstInvalid.focus);

      return;
    }

    // Soft, unlike the fields above: it asks once, so a second Save press goes through.
    if (remindOnSave()) {
      return;
    }

    try {
      if (isEdit) {
        // Update the editable fields in one transaction; the icon routes
        // through setIcon, so a cleared icon persists an explicit null. What an
        // account IS — its kind, its bank or broker, and the cash currency +
        // initial value of its create-time initial holding — is set on create
        // only, so this patch never carries any of it (nor `institution`, so a
        // live-connected account's sync stays untouched). The account currency is the
        // one exception, when the user changed it.
        const patchedCurrency = currencyPatch(accountCurrency, editingAccount?.currency);

        await accountsRepo.update(editId, {
          name: storedName(kind, trimmedName, t),
          color,
          ...patchedCurrency,
        });

        // Right after the update commits, not after the icon write below: a failed icon write
        // keeps the form open, and the retry then finds the currency stored and patches none.
        if (patchedCurrency.currency !== undefined) {
          refreshAfterCurrencyWrite();
        }

        await accountsRepo.setIcon(editId, icon);
        navigation.goBack();

        return;
      }

      if (kind === 'cash') {
        // `initialValueInvalid` (checked in `scrollTargets` above) already
        // blocked Save on a blank or negative value, so reaching here means it
        // is a valid amount.
        const { holdingId } = await accountsRepo.createCashAccount({
          name: trimmedName,
          currency,
          initialBalance: Money.fromMajor(currency, parseAmount(initialValue)),
          icon,
          color,
        });

        // After the commit, so a rejected write hands nothing back to the picker.
        handBackCreatedOption(handbackId, holdingId);
        // The one pick is the cash holding's currency too, so this create needs its rate like
        // the holding form's does.
        refreshAfterCurrencyWrite();
        navigation.goBack();

        return;
      }

      // Every kind but cash (returned above) shares one create path. A field's
      // own Connect may already have inserted the row (connect-first): the one
      // write below then stores any name/color/icon edited AFTER connecting on
      // it, rather than inserting a DUPLICATE account (the field already handled
      // the credential + first sync). With no row, this Save is the first write
      // and creates it — an unconnected bank/crypto account is valid (the user
      // connects a source later from its detail screen), and a metals account has
      // no source to connect at all. (Property and debt never get here: picking
      // either swaps to the holding form, which leaves this form first.) The write
      // looks the row up itself, queued behind any Connect insert still waiting, so no earlier
      // read can make it update a row that is missing or insert one that is there.
      await accountsRepo.saveFormAccount(accountRow());

      // A null pick stores the base, which the rates already cover.
      if (accountCurrency !== null) {
        refreshAfterCurrencyWrite();
      }

      navigation.goBack();
    } catch {
      // A DB write failure (disk full, locked) must not vanish silently — the
      // screen was about to navigate away with nothing saved. Keep it open and
      // say so, mirroring contribution-form's established Alert pattern.
      alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');
    }
  };

  const { onPress: onSave, isSubmitting } = useSubmitOnce(save);

  useFormHeaderItems({ navigation, onSave, hasSave: true, isSaving: isSubmitting });

  // Selecting an account type re-seeds the icon field with that type's default
  // glyph; the user can still override it in the picker afterward, and picking
  // a different type resets the icon to the new type's default. Only reachable
  // in create mode — the kind chip is disabled in edit mode below.
  const handleSelectKind = (nextKind: Kind): void => {
    // Property and Loan leave this form (see `swapToHoldingForm`), so there is
    // no kind to switch to here. Only the kind field shows the pick, at once:
    // the sheet is still closing, and left on the old kind the form looks
    // frozen. `kind` itself stays, so the fields, icon and color the swap is
    // about to remove do not jump away first.
    if (isImplicitAccountKind(nextKind)) {
      setPickedImplicitKind(nextKind);

      return;
    }

    // The sheet lists the selected kind too: re-picking it must not wipe the
    // bank/broker pick, a hand-picked icon, or a token typed into the connect
    // field the pick mounts.
    if (nextKind === kind) {
      return;
    }

    setKind(nextKind);
    setIcon(accountKindSymbol[nextKind]);
    setIconIsDirty(false);
    setBankId(null);
    setBrokerId(null);
    setExchangeId(null);
  };

  // Property and Loan are the one implicit account of their kind, so there is
  // no account to describe here: the holding form takes over, and `replace`
  // keeps Back from returning to this form. It runs once the kind sheet has
  // finished closing, as replacing sooner would unmount the screen that owns
  // the sheet mid-close.
  const swapToHoldingForm = (nextKind: Kind): void => {
    if (isImplicitAccountKind(nextKind)) {
      navigation.replace('HoldingForm', {
        implicitKind: nextKind,
        draft: { name, icon: iconIsDirty ? icon : null, color },
        // Only a defined id: the holding form's params carry no `handbackId` key otherwise.
        ...foldMap(maybe(handbackId), (carriedId) => ({ handbackId: carriedId })),
      });
    }
  };

  const pickIcon = (picked: string): void => {
    setIcon(picked);
    setIconIsDirty(true);
  };

  const clearIcon = (): void => {
    setIcon(null);
    setIconIsDirty(false);
  };

  return (
    <Screen
      scroll
      scrollableRef={scrollableRef}
      onContentSizeChange={onContentSizeChange}
      onFieldBlur={onFieldBlur}
    >
      <Box gap={4} testID="account-form">
        {/* One shared icon+name block for every kind, cash included: the icon
            picker stays visible whatever the kind is. Both create paths
            (createCashAccount and the shared create) persist the picked icon in
            their own atomic insert. */}
        <View ref={nameFieldRef}>
          <HoldingIdentityField
            icons={accountIconPool}
            icon={icon}
            fallbackIcon={fallbackIconFor(kind)}
            iconColor={entityDisplayColor(effectiveColor, scheme)}
            name={name}
            onChangeName={setName}
            onSelectIcon={pickIcon}
            onRemoveIcon={clearIcon}
            namePlaceholder={t('forms.account.namePlaceholder')}
            required
            error={attemptedSave && !canSave ? t('forms.fields.nameRequiredError') : undefined}
            nameInputRef={nameInputRef}
            testID="holding-identity-name-field"
          />
        </View>

        <ColorPicker
          label={t('forms.fields.color')}
          value={effectiveColor}
          swatchSet="entity"
          onSelect={setColor}
        />

        <Divider testID="form-divider" />

        {/* Kind fixes an account's structure (a cash account owns an initial
            cash holding; a bank/crypto does not), and no repo path re-shapes it,
            so it is read-only in edit mode — shown, but not switchable. It also
            locks once a bank/crypto source has been connected (which already
            inserted the row): switching kind afterwards would make Save create a
            SECOND account and orphan the started row. The bank picker below locks
            the same way. */}
        <AccountKindField
          selected={shownKind(kind, pickedImplicitKind)}
          onSelect={handleSelectKind}
          onSelectClosed={swapToHoldingForm}
          closesWithoutAnimation={isImplicitAccountKind}
          disabled={isPickLocked}
        />

        {/* In create AND edit mode, like the bank picker; edit shows it disabled,
            since a broker is picked on create only. A broker account is manual
            only, so no sync section follows it. */}
        {kind === 'broker' && (
          <View ref={catalogFieldRef}>
            <BrokerTypeField
              label={t('forms.account.brokerType')}
              sheetTitle={t('forms.account.brokerTypeSheetTitle')}
              selected={brokerId}
              onSelect={setBrokerId}
              required={!isEdit}
              disabled={isEdit}
              error={catalogPickError}
              testID="account-broker-type-field"
            />
          </View>
        )}

        {/* The currency + initial value seed the cash account's initial holding
            at creation only; they have no meaning once the holding exists (its
            balance is edited on the holding itself), so the edit form omits
            them. */}
        {!isEdit && kind === 'cash' && (
          <>
            <CurrencyField
              label={t('forms.fields.currency')}
              sheetTitle={t('forms.fields.currencySheetTitle')}
              selected={currency}
              onSelect={setCurrency}
              groups={cashCurrencyGroups}
              testID="account-currency-field"
            />

            <View ref={initialValueFieldRef}>
              <TextField
                label={t('forms.account.initialValue')}
                value={initialValue}
                onChangeText={(text) => setInitialValue(groupAmount(text))}
                keyboardType="decimal-pad"
                placeholder={t('forms.account.initialValuePlaceholder')}
                suffix={currencySymbol[currency]}
                error={initialValueError}
                inputRef={initialValueInputRef}
              />
            </View>
          </>
        )}

        {/* The currency the account card shows its total in. Never locked with the kind and the
            bank pick: a pick made after a Connect is still written by Save, and an edit of a
            synced or cash account changes only this display currency. */}
        <AccountCurrencyField
          isEdit={isEdit}
          kind={kind}
          selected={shownAccountCurrency(accountCurrency, settingsRows.at(0)?.baseCurrency)}
          onSelect={setAccountCurrency}
        />

        {/* The "which bank does this account represent" identity picker —
            shown in BOTH create and edit mode, so the edit form shows the
            account's bank, but DISABLED there: `bankId` is picked on create
            only, whether or not the account is connected. The
            live-sync Connect field stays CREATE-ONLY — editing an already-
            connected account's real connection is BankSyncSection's job on
            the account-detail screen (Monobank-only, Guideline 2.5.19),
            untouched here. The credential field itself is NOT required (no asterisk): an
            account still creates with no credentials — a secret is masked
            and write-only, going straight to the Keychain on save, never
            into a stored row or a log. */}
        {kind === 'bank' && (
          <Box gap={4}>
            <Divider testID="form-divider" />

            {/* Unconditional (not create-only): an edit render's bank block
                otherwise sits under a bare divider with no heading naming
                the section at all — the SAME heading create mode already
                shows above `BankTypeField`. */}
            <Text variant="heading">{t('accountDetail.synchronization')}</Text>

            <View ref={catalogFieldRef}>
              <BankTypeField
                label={t('forms.account.bankType')}
                sheetTitle={t('forms.account.bankTypeSheetTitle')}
                selected={bankId}
                onSelect={setBankId}
                required={!isEdit}
                disabled={isPickLocked}
                error={catalogPickError}
                testID="account-bank-type-field"
              />
            </View>

            {!isEdit && bankId === 'monobank' && (
              <MonobankConnectField
                accountId={pendingAccountId}
                onConnect={connectMonobank}
                reminder={reminderFor('monobank')}
              />
            )}

            {isSpecificBankId(bankId) && bankId !== 'monobank' && (
              <Text variant="caption" tone="textSecondary">
                {t('forms.account.importOnlyBankHint')}
              </Text>
            )}
          </Box>
        )}

        {/* The exchange or wallet picker, and below it the SAME sync form the account-detail
            screen uses, reused here rather than hand-rolled, for the picked entry. The picker
            shows on CREATE only: an edit never changes what the account is connected to, and an
            edit's connection is managed on the account-detail screen. It renders the moment
            Crypto is selected — full parity with the bank form above, with NO name gate and
            no required pick — and the sync form follows the pick (an unpicked or manual account
            has no field). The create invariant is enforced instead of hidden: each field's own
            Connect inserts the account row (via ensureAccount) keyed by the pre-generated id,
            and ensureAccount refuses to create a row while `!canSave` (empty name), mirroring
            the bank Save gate. A Connect tapped early surfaces both the field's "could not
            connect" state and the name-required reason above, and writes no row. */}
        {!isEdit && kind === 'crypto' && (
          <Box gap={4}>
            <Divider testID="form-divider" />

            <Text variant="heading">{t('accountDetail.synchronization')}</Text>

            <ExchangeTypeField
              label={t('forms.account.exchangeType')}
              sheetTitle={t('forms.account.exchangeTypeSheetTitle')}
              selected={exchangeId}
              onSelect={setExchangeId}
              disabled={isPickLocked}
              testID="account-exchange-type-field"
            />

            {foldMap(maybe(exchangeId), (source) => (
              <PendingCryptoSyncForm
                accountId={pendingAccountId}
                source={source}
                onConnectWallet={connectWallet}
                onConnectBinance={connectBinance}
                onConnectBybit={connectBybit}
                walletReminder={reminderFor('wallet')}
                binanceReminder={reminderFor('binance')}
                bybitReminder={reminderFor('bybit')}
                onBinanceStoredWhileUnmounted={clearBinancePairIfRowMissing}
                onBybitStoredWhileUnmounted={clearBybitPairIfRowMissing}
                bybitConnectError={bybitConnectError}
                onBybitKeyChange={clearBybitConnectError}
              />
            ))}
          </Box>
        )}
      </Box>
    </Screen>
  );
};

export default AccountFormScreen;
