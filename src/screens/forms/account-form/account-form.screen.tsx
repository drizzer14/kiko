import type { TFunction } from 'i18next';
import { Money } from '@kiko/currency/money';
import {
  useHeaderInset,
  scrollToField,
  type FieldInstance,
} from '@kiko/design-system/scroll-to-field';
import { useSync } from '@kiko/sync/use-sync';
import { accountsRepo } from '@kiko/accounts';
import either, { isRight } from 'fnts/either';
import { useTranslation } from 'react-i18next';
import { logOnFailure } from '@kiko/diagnostics';
import { saveToken } from '@kiko/monobank/token';
import { parseAmount } from '@kiko/currency/parse';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import { type BrokerId, isBrokerId } from '@kiko/brokers';
import { useCryptoSync } from '@kiko/sync/use-crypto-sync';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import { id, type AccountRow, useLiveQuery } from '@kiko/db';
import Divider from '@kiko/design-system/components/divider';
import { clearCredentials } from '@kiko/crypto-sync/binance';
import BankTypeField from '@kiko/screens/forms/bank-type-field';
import { groupAmount } from '@kiko/screens/forms/amount-format';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import TextField from '@kiko/design-system/components/text-field';
import { defaultAccountColor } from '@kiko/holdings/entity-colors';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import BrokerTypeField from '@kiko/screens/forms/broker-type-field';
import { resolveEntityColor } from '@kiko/design-system/entity-tint';
import ColorPicker from '@kiko/design-system/components/color-picker';
import AccountKindField from '@kiko/screens/forms/account-kind-field';
import { isImplicitAccountKind } from '@kiko/holdings/implicit-account';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import CurrencyField from '@kiko/design-system/components/currency-field';
import CryptoSyncForm from '@kiko/design-system/components/crypto-sync-form';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AccountsStackParamList, FormDraft } from '@kiko/navigation/types';
import { View, type ScrollViewInstance, type TextInputInstance } from 'react-native';
import { type FC, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { accountKindSymbol, genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import { KIKO_ENTITIES_ICONS } from '@kiko/design-system/components/icon-picker-modal';
import { type BankId, isBankId, isSpecificBankId } from '@kiko/bank-sync/bank-catalog';
import HoldingIdentityField from '@kiko/design-system/components/holding-identity-field';
import MonobankConnectField from '@kiko/design-system/components/monobank-connect-field';
import { type Currency, currencySymbol, fiatCurrencyOptions } from '@kiko/currency/currency';

type AccountFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'AccountForm'>;

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
};

// What a create form opens with: a plain create opens on the default kind with
// that kind's glyph, and a swap back from the holding form carries the
// identity the user already typed. A carried icon is a pick, so it stays one;
// an absent one follows the opening kind's default like any untouched icon.
const createSeed = (initialKind: Kind | undefined, draft: FormDraft | undefined): CreateSeed => {
  const kind = initialKind ?? INITIAL_KIND;

  return {
    kind,
    name: draft?.name ?? '',
    icon: draft?.icon ?? accountKindSymbol[kind],
    iconIsDirty: typeof draft?.icon === 'string',
    color: draft?.color ?? null,
  };
};

// A stored `kind` can still hold a value that is no longer part of the CURRENT
// schema enum — the schema's `enum` is TS-only (no DB CHECK constraint), so a
// row under a kind the app no longer knows can persist. Guards the edit-mode
// hydration below against that case so an unrecognized stored kind never
// assigns outside `Kind`'s own type (and the symbol/color lookups below never
// silently miss).
const isSupportedKind = (value: string): value is Kind => Object.hasOwn(accountKindSymbol, value);

// `accounts.bankId` holds the catalog identity of whichever kind has a picker,
// so each kind writes only its own picker's pick: a broker id never lands on a
// bank account, and a bank id never on a broker.
const catalogIdFor = (
  kind: Kind,
  bankId: BankId | null,
  brokerId: BrokerId | null,
): BankId | BrokerId | null => (kind === 'broker' ? brokerId : bankId);

// What an edit writes as `bankId`: a pick the user made wins, and a picker left
// untouched writes back the stored value as it is. A stored id neither picker
// lists (a bank since removed from the catalog, or a bank id on a broker row)
// seeds the picker as no pick, so without this it would be saved as NULL and
// the account would lose it though the user never touched that field.
const savedCatalogId = (picked: string | null, stored: string | null): string | null =>
  picked ?? stored;

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

const AccountFormScreen: FC<AccountFormScreenProps> = ({ route, navigation }) => {
  // An `accountId` in the route params switches the form to EDIT mode: the same
  // fields, seeded from the existing account, saving through the update path
  // rather than create. Absent (the accounts list passes `{}`), it is a plain
  // create form.
  const editId = route.params?.accountId;
  const isEdit = editId !== undefined;
  const seed = createSeed(route.params?.initialKind, route.params?.draft);

  const { t } = useTranslation();

  const [name, setName] = useState(seed.name);
  const [kind, setKind] = useState<Kind>(seed.kind);
  const [currency, setCurrency] = useState<Currency>('UAH');
  const [initialValue, setInitialValue] = useState('');
  // A create form seeds the icon with the initially-selected kind's default
  // glyph so it opens on a sensible symbol; the user can still override it in
  // the picker below. Edit mode starts null and is hydrated from the stored
  // row (below), so the seed never clobbers a saved icon.
  const [icon, setIcon] = useState<string | null>(isEdit ? null : seed.icon);
  // Whether `icon` is the user's own pick rather than the kind's default, which
  // is all a swap to the holding form may carry: it re-derives its own default.
  // A kind switch resets the icon, so it resets this too.
  const [iconIsDirty, setIconIsDirty] = useState(seed.iconIsDirty);
  // Mirrors the icon's dirty pattern: null until the user taps a swatch. While
  // null, the effective color follows the selected kind's default
  // (defaultAccountColor[kind]) — the ColorPicker highlights that swatch and
  // switching kind moves it; once picked, the choice sticks.
  const [color, setColor] = useState<string | null>(seed.color);
  // The bank the user picked in the sync section's BankTypeField, tagging the
  // created row for later provider-specific handling (import, connect status).
  // null = nothing picked yet: a new bank account cannot Save until it is set
  // (`missingCatalogPick`), `other` being the pick for any bank not listed. Never
  // auto-seeded on a fresh bank create (no auto-jump to Monobank). An existing
  // account saved before the pick was required can still hold null here, and
  // keeps it on edit.
  const [bankId, setBankId] = useState<BankId | null>(null);
  // The broker picked in BrokerTypeField, the same shape as `bankId`.
  const [brokerId, setBrokerId] = useState<BrokerId | null>(null);
  // The stored `bankId` as the edit form loaded it, which the two pickers above
  // cannot always show (see `savedCatalogId`).
  const [storedCatalogId, setStoredCatalogId] = useState<string | null>(null);
  const catalogId = catalogIdFor(kind, bankId, brokerId);
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
  // account the user repairs from its detail screen (connect-first: the field's
  // Connect creates the row before Save). Every kind runs
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
  // DUPLICATE account (connect-first). On a REJECTED create the ref is reset to null
  // (see below) so a retry re-attempts and Save never silently no-ops.
  const accountCreate = useRef<Promise<string> | null>(null);
  // A render-visible mirror of "the row has been (or is being) inserted", used
  // only to DISABLE the kind switch once a source is connected — switching kind
  // afterwards would route Save down a branch that creates a SECOND account and
  // orphans the started row. It is state (not just the ref) because the disable
  // must re-render; it follows the ref, reset to false on a failed create so the
  // switch re-enables when no row actually exists.
  const [accountRowStarted, setAccountRowStarted] = useState(false);
  // ONE shared attempted-submit flag for every validated field on this form
  // (kiko-code-style's form validation model), set true by a blocked Connect
  // OR a blocked Save — never a per-field flag: each field's own error below
  // still derives from ONLY its own value, this just gates when either can
  // first show, so a fresh create form shows no error before the user has
  // tried to submit.
  const [attemptedSave, setAttemptedSave] = useState(false);
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
  // The cash-only initial-value field's own wrapper + inner TextInput refs —
  // the SAME pair the name field above carries, so a blocked Save on it scrolls
  // and focuses exactly like a blocked name does (it used to have no scroll
  // target at all).
  const initialValueFieldRef = useRef<FieldInstance>(null);
  const initialValueInputRef = useRef<TextInputInstance>(null);
  // The bank or broker picker's wrapper — one ref, since only one of the two
  // renders at a time. A picker has no keyboard, so a blocked Save only
  // scrolls it into view; the error under it is the cue.
  const catalogFieldRef = useRef<FieldInstance>(null);
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
      setAttemptedSave(true);
      scrollToField(
        scrollableRef,
        nameFieldRef,
        { currentOffset: scrollOffset.value, headerInset, contentHeight: contentHeightRef.current },
        () => nameInputRef.current?.focus(),
      );

      return Promise.reject(new Error('name-required'));
    }
    // The icon goes in the same insert: a second write could fail after the row
    // exists, and a Binance connect reads any failure here as "no row" and
    // clears the key pair of an account that is there.
    accountCreate.current ??= (async () => {
      await accountsRepo.create({
        id: pendingAccountId,
        name: trimmedName,
        // Neither cash (createCashAccount returns before this) nor property/debt
        // (the swap to the holding form leaves this form first) reaches here.
        kind,
        color,
        icon,
        bankId: catalogId,
      });

      return pendingAccountId;
    })().catch((error: unknown) => {
      // A failed insert (DB locked, disk full) must not poison the session: clear
      // the latch so a retry — or the Save fallback — re-attempts, rather than
      // leaving the ref non-null and sending Save down the UPDATE branch, which
      // would match no row and silently no-op while the user believes they
      // saved. Re-throw so the caller still sees the failure.
      accountCreate.current = null;
      setAccountRowStarted(false);
      throw error;
    });
    setAccountRowStarted(true);

    return accountCreate.current;
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
  // Monobank sync against it (the write-only-secret order — Global Constraint 2).
  // Any failure BEFORE the sync returns false so the field shows its "could not
  // connect" status rather than an unhandled rejection; the ensureAccount reset
  // above lets the next Connect retry. The token goes ONLY to the Keychain —
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
  // screen, the DB, or a log. A create failure is caught here (via
  // `accountEnsured`) and surfaced to the field as a `false` (not-connected)
  // result, so the field shows its "could not connect" status instead of an
  // unhandled rejection that would leave it stuck on "checking"; the ref
  // reset above lets the next Connect retry.
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

  const connectBinance = async (): Promise<boolean> => {
    if (!(await accountEnsured())) {
      // The field stored its key pair under the pre-generated account id before
      // this connect, and no row owns it now, so nothing else would ever clear
      // it. A failed clear is logged: the connect still reports its own failure.
      await logOnFailure('[account-form] the Binance key pair could not be cleared', () =>
        clearCredentials(pendingAccountId),
      );

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
    // The edit form seeds `bankId` too, so the picker below renders and the
    // user can view or change an account's bank identity after create.
    setStoredCatalogId(editingAccount.bankId);
    // `isBankId` guards against a stored value from a since-removed catalog
    // entry, mirroring `isSupportedKind` above.
    setBankId(isBankId(editingAccount.bankId) ? editingAccount.bankId : null);
    setBrokerId(isBrokerId(editingAccount.bankId) ? editingAccount.bankId : null);
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
      scrollToField(
        scrollableRef,
        firstInvalid.ref,
        { currentOffset: scrollOffset.value, headerInset, contentHeight: contentHeightRef.current },
        firstInvalid.focus,
      );

      return;
    }

    try {
      if (isEdit) {
        // Update the editable identity fields in one transaction; the icon routes
        // through setIcon (so a cleared icon persists an explicit null), the same
        // split the create path uses. Kind is read-only, and the cash currency +
        // initial value belong to the create-time initial holding, so neither is
        // touched here. `bankId` is editable too — this patch never
        // carries `institution`, so a live-connected account's sync stays
        // untouched no matter what bank identity is picked here.
        await accountsRepo.update(editId, {
          name: trimmedName,
          color,
          bankId: savedCatalogId(catalogId, storedCatalogId),
        });
        await accountsRepo.setIcon(editId, icon);
        navigation.goBack();

        return;
      }

      if (kind === 'cash') {
        // `initialValueInvalid` (checked in `scrollTargets` above) already
        // blocked Save on a blank or negative value, so reaching here means it
        // is a valid amount.
        await accountsRepo.createCashAccount({
          name: trimmedName,
          currency,
          initialBalance: Money.fromMajor(currency, parseAmount(initialValue)),
          icon,
          color,
        });
        navigation.goBack();

        return;
      }

      // Every kind but cash (returned above) shares one create path. A field's
      // own Connect may already have inserted the row via
      // ensureAccount (connect-first); if so, persist any name/color/icon edited
      // AFTER connecting rather than inserting a DUPLICATE account (the field
      // already handled the credential + first sync). Otherwise this Save is
      // the first write, so create the row now — an unconnected bank/crypto
      // account is valid (the user connects a source later from its detail
      // screen), and a property or metals account has no source to connect at
      // all — it always takes this branch.
      if (accountCreate.current !== null) {
        await accountsRepo.update(pendingAccountId, {
          name: trimmedName,
          color,
          bankId: catalogId,
        });
        await accountsRepo.setIcon(pendingAccountId, icon);
      } else {
        await ensureAccount();
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

  // Selecting an account type re-seeds the icon field with that type's default
  // glyph; the user can still override it in the picker afterward, and picking
  // a different type resets the icon to the new type's default. Only reachable
  // in create mode — the kind chip is disabled in edit mode below.
  const handleSelectKind = (nextKind: Kind): void => {
    // Property and Loan leave this form (see `swapToHoldingForm`), so there is
    // no kind to switch to here.
    if (isImplicitAccountKind(nextKind)) {
      return;
    }

    setKind(nextKind);
    setIcon(accountKindSymbol[nextKind]);
    setIconIsDirty(false);
    setBankId(null);
    setBrokerId(null);
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
            picker stays visible whatever the kind is. Both create paths
            (createCashAccount and the shared create) persist the picked icon in
            their own atomic insert. */}
        <View ref={nameFieldRef}>
          <HoldingIdentityField
            icons={KIKO_ENTITIES_ICONS}
            icon={icon}
            fallbackIcon={FALLBACK_ICON}
            iconColor={effectiveColor}
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

        <ColorPicker label={t('forms.fields.color')} value={effectiveColor} onSelect={setColor} />

        <Divider testID="form-divider" />

        {/* Kind fixes an account's structure (a cash account owns an initial
            cash holding; a bank/crypto does not), and no repo path re-shapes it,
            so it is read-only in edit mode — shown, but not switchable. It also
            locks once a bank/crypto source has been connected (which already
            inserted the row): switching kind afterwards would make Save create a
            SECOND account and orphan the started row. */}
        <AccountKindField
          selected={kind}
          onSelect={handleSelectKind}
          onSelectClosed={swapToHoldingForm}
          disabled={isEdit || accountRowStarted}
        />

        {/* In create AND edit mode, like the bank picker. A broker account is
            manual only, so no sync section follows it. */}
        {kind === 'broker' && (
          <View ref={catalogFieldRef}>
            <BrokerTypeField
              label={t('forms.account.brokerType')}
              sheetTitle={t('forms.account.brokerTypeSheetTitle')}
              selected={brokerId}
              onSelect={setBrokerId}
              required={!isEdit}
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
              options={fiatCurrencyOptions}
              onOpenChange={setIsCurrencySheetOpen}
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

        {/* The "which bank does this account represent" identity picker —
            shown in BOTH create and edit mode, so the edit
            form can view or change `bankId` too. The
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
                error={catalogPickError}
                testID="account-bank-type-field"
              />
            </View>

            {!isEdit && bankId === 'monobank' && (
              <MonobankConnectField onConnect={connectMonobank} />
            )}

            {isSpecificBankId(bankId) && bankId !== 'monobank' && (
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
