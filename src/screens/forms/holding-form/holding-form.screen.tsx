import { match } from 'ts-pattern';
import { View } from 'react-native';
import {
  creatableHoldingTypesForAccount,
  type HoldingType,
  holdingTypes,
  holdingTypesForAccountKind,
} from '@kiko/holdings/holding-type';
import {
  useHeaderInset,
  scrollToField,
  type FieldInstance,
} from '@kiko/design-system/scroll-to-field';
import { accountsRepo } from '@kiko/accounts';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import Box from '@kiko/design-system/components/box';
import type { Currency } from '@kiko/currency/currency';
import { usePriceBook } from '@kiko/prices/use-price-book';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import { needsPriceBook } from '@kiko/holdings/priced-value';
import Divider from '@kiko/design-system/components/divider';
import { runLoanAutoLink } from '@kiko/loans/use-loan-auto-link';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import { refreshMarketData } from '@kiko/sync/refresh-market-data';
import { defaultHoldingColor } from '@kiko/holdings/entity-colors';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import { resolveEntityColor } from '@kiko/design-system/entity-tint';
import ColorPicker from '@kiko/design-system/components/color-picker';
import { holdingCurrencyOptions } from '@kiko/holdings/holding-currency';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { useLiveQuery, type AccountRow, type HoldingRow } from '@kiko/db';
import CurrencyField from '@kiko/design-system/components/currency-field';
import type { ScrollViewInstance, TextInputInstance } from 'react-native';
import { isSyncedAccount, isSyncedHolding } from '@kiko/holdings/deletable';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { KIKO_ENTITIES_ICONS } from '@kiko/design-system/components/icon-picker-modal';
import { defaultHoldingSymbol, holdingTypeSymbol } from '@kiko/holdings/entity-symbols';
import HoldingIdentityField from '@kiko/design-system/components/holding-identity-field';
import { type FC, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { holdingDescriptor, isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';

import HoldingTypeField from '../holding-type-field';
import type { AccountsStackParamList } from '../../../navigation/types';
import type { HoldingSelectOption } from '../holding-select-field/holding-select-field.props';

import LoanFormBlock from './loan/loan-form-block';
import BondFormBlock from './bond/bond-form-block';
import MetalFormBlock from './metal/metal-form-block';
import MetalTypeField from './metal/metal-type-field';
import { useLoanFields } from './loan/use-loan-fields';
import { useBondFields } from './bond/use-bond-fields';
import { useMetalFields } from './metal/use-metal-fields';
import BalanceFormBlock from './balance/balance-form-block';
import PropertyFormBlock from './property/property-form-block';
import PropertyTypeField from './property/property-type-field';
import { useBalanceFields } from './balance/use-balance-fields';
import { usePropertyFields } from './property/use-property-fields';
import type { ScrollTarget, HoldingTypeForm } from './holding-type-form';
import TermDepositFormBlock from './term-deposit/term-deposit-form-block';
import { useTermDepositFields } from './term-deposit/use-term-deposit-fields';

// Fire-and-forget, only for a loan: the matcher backfills from the loan's
// own start date, so a create OR an edit (principal/schedule/
// paymentHoldingId/lenderName/lenderIban can all change) needs a fresh run —
// unlike `refreshMarketData`, which never fires on an edit at all
// (type/currency are read-only there). Never rejects (its own doc comment),
// so `save` never awaits or catches it. Extracted to a module-level function
// (a plain call, not an inline `if`) so this ONE extra branch stays out of
// `save`'s own cognitive-complexity budget.
const runLoanAutoLinkIfLoan = (type: HoldingType): void => {
  if (type === 'loan') {
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) runLoanAutoLink catches every failure and never rejects
    runLoanAutoLink();
  }
};

// The loan form's "Paid from" picker options: every OPEN, non-ledgerless
// holding in the LOAN's own currency — a `paymentHoldingId` link is only
// ever a meaningful matcher signal when the payer holding shares the loan's
// currency (mirrors `buildLoanOptions`'s identical currency filter on the
// transaction form's own loan-payment field). A loan holding is itself
// ledgerless, so this can never offer the loan as its own payer.
//
// A filter never hides an active selection (kiko-design-system): the
// CURRENTLY selected `paymentHoldingId` is unioned back in even once it has
// since closed or moved to another currency — mirrors `buildLoanOptions`'s
// own union-back — or `PaymentHoldingField` would resolve no match for it
// and silently show "None" for a link that still exists in the metadata,
// with no way to see or clear it.
const buildPaymentHoldingOptions = (
  holdings: readonly HoldingRow[],
  accountNameById: ReadonlyMap<string, string>,
  loanCurrency: Currency,
  selectedHoldingId: string | null,
): HoldingSelectOption[] => {
  const openOptions = holdings
    .filter(
      (candidate) =>
        candidate.closedAt == null &&
        candidate.currency === loanCurrency &&
        !isLedgerlessHoldingType(candidate.type),
    )
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      icon: candidate.icon ?? defaultHoldingSymbol(candidate),
      color: resolveEntityColor(candidate.color, defaultHoldingColor[candidate.type]),
      currency: candidate.currency,
      accountName: accountNameById.get(candidate.accountId) ?? '',
    }));

  if (selectedHoldingId === null || openOptions.some((option) => option.id === selectedHoldingId)) {
    return openOptions;
  }

  const selectedHolding = holdings.find((candidate) => candidate.id === selectedHoldingId);

  if (selectedHolding === undefined) {
    return openOptions;
  }

  return [
    ...openOptions,
    {
      id: selectedHolding.id,
      name: selectedHolding.name,
      icon: selectedHolding.icon ?? defaultHoldingSymbol(selectedHolding),
      color: resolveEntityColor(selectedHolding.color, defaultHoldingColor[selectedHolding.type]),
      currency: selectedHolding.currency,
      accountName: accountNameById.get(selectedHolding.accountId) ?? '',
    },
  ];
};

// Which field fills the Type slot. A `property` account's only type IS its
// category, so the category picker takes the slot. Wherever a `metal` holding
// can be created — a metals account, or a bank that sells metals — or one is
// being edited, each metal is its own row (`MetalTypeField`), after the
// account's other creatable types; an edit locks the type, so it lists the
// metals alone. Everything else, including the edit of a non-metal holding on
// a bank that sells metals, keeps the generic field.
type TypeSlot =
  | { kind: 'property' }
  | { kind: 'metal'; otherTypes: readonly HoldingType[] }
  | { kind: 'generic' };

const typeSlotFor = (
  accountKind: AccountRow['kind'] | undefined,
  typeOptions: readonly HoldingType[],
  isEdit: boolean,
  type: HoldingType,
): TypeSlot => {
  if (accountKind === 'property') {
    return { kind: 'property' };
  }

  if (isEdit) {
    return type === 'metal' ? { kind: 'metal', otherTypes: [] } : { kind: 'generic' };
  }

  if (typeOptions.includes('metal')) {
    return { kind: 'metal', otherTypes: typeOptions.filter((option) => option !== 'metal') };
  }

  return { kind: 'generic' };
};

type HoldingFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'HoldingForm'>;

const HoldingFormScreen: FC<HoldingFormScreenProps> = ({ route, navigation }) => {
  const { accountId, holdingId, returnTo } = route.params;
  const { t } = useTranslation();
  // Human display text for the id-like holding types (the select field
  // below still reports the underlying value on select). Built from the
  // catalog inside the component (rather than a module-level constant) so it
  // always reflects the active language.
  const typeLabels: Record<HoldingType, string> = {
    card: t('forms.holding.card'),
    term_deposit: t('forms.holding.deposit'),
    bond: t('forms.holding.bond'),
    cash: t('forms.account.cash'),
    crypto_asset: t('forms.holding.cryptoAsset'),
    jar: t('forms.holding.jar'),
    property_item: t('forms.holding.propertyItem'),
    metal: t('forms.holding.metal'),
    loan: t('forms.holding.loan'),
  };
  // A `holdingId` in the route params switches the form to EDIT mode: the same
  // fields, seeded from the existing holding, saving through the update path
  // rather than create.
  const isEdit = holdingId !== undefined;
  // The account this holding is created under; its `kind` constrains which
  // holding types are offered (a bank can't hold a crypto asset or cash, etc.).
  const { data: accounts } = useLiveQuery(accountsRepo.byIdQuery(accountId), ['accounts']);
  const account = accounts.at(0);
  const accountKind = account?.kind;
  // Whether THIS account is a live sync connection (see `isSyncedAccount` in
  // `../../../holdings/deletable`) — an unresolved account (query still
  // loading) is treated as not-yet-synced.
  const isSynced = account !== undefined && isSyncedAccount(account);
  // The full set of types this account kind may hold — used in EDIT mode so an
  // existing synced (card/jar) row's type still renders read-only.
  const allowedTypes = accountKind ? holdingTypesForAccountKind[accountKind] : holdingTypes;
  // The types a user may MANUALLY create here: the full set minus whichever
  // sync-only types THIS account's sync actually owns. A live-synced (Monobank)
  // bank excludes both card and jar (its sync creates them); a non-synced,
  // statement-import-only bank has no sync to own a card, so card is offered —
  // jar stays excluded regardless (see `creatableHoldingTypesForAccount`'s
  // comment). `account?.bankId` additionally gates `metal` under a `bank`
  // account (the sellsMetals allow-list; undefined for a `metals`-kind
  // account, which never gates on it). The create form offers only these;
  // edit mode keeps
  // the full set (above).
  const creatableTypes = accountKind
    ? creatableHoldingTypesForAccount(accountKind, isSynced, account?.bankId)
    : holdingTypes;
  // Create mode offers the manually-creatable subset; edit mode shows the full
  // set (its chip is read-only) so a synced card/jar row still displays.
  const typeOptions = isEdit ? allowedTypes : creatableTypes;

  // In edit mode, load the holding being edited so its fields can seed the form.
  // The query always runs (hooks can't be conditional); an empty id in create
  // mode simply matches no row.
  const { data: editHoldings } = useLiveQuery(holdingsRepo.byIdQuery(holdingId ?? ''), [
    'holdings',
  ]);
  const editingHolding = isEdit ? editHoldings.at(0) : undefined;
  // A synced (Monobank) holding's balance is owned by the sync, not the user:
  // its name/icon/color stay editable, but the balance field is hidden and never
  // written back so an edit does not clobber the last synced balance. The
  // account row loaded above gates this: a disconnected account KEEPS its
  // holdings' sync keys (so a reconnect re-adopts them), and the user owns
  // those balances again meanwhile.
  const isSyncedEdit =
    editingHolding !== undefined && isSyncedHolding(editingHolding, accounts.at(0));

  const [name, setName] = useState('');
  // The selected type starts at `card`, then the effect below snaps it to the
  // first CREATABLE type for the account's kind once it loads — so a bank create
  // (where card/jar are sync-only and excluded) defaults to `term_deposit`, and
  // an edit seeds the real type from the row.
  const [type, setType] = useState<HoldingType>('card');

  // Reactive `PriceBook`, passed through `EditContext.book` to every hook's
  // own `saveEdit`: a loan edit that changes its schedule INTO `'none'`
  // needs the OLD schedule's outstanding, which may itself be anchored on an
  // existing manual correction (see `useLoanFields`'s own `saveEdit`).
  // kiko-architecture: skip the price_points read while the active type
  // (the row being edited, read straight off the query rather than waiting
  // for the type-sync effect below; the currently selected type in create
  // mode) never reads it (`needsPriceBook`). Save waits for the book on an
  // edit: saved against a still-empty book, a loan changed into `'none'`
  // would store its schedule-only outstanding as a permanent manual point.
  const { book: priceBook, isLoading: isPriceBookLoading } = usePriceBook(
    needsPriceBook(editingHolding?.type ?? type),
  );
  const [currency, setCurrency] = useState<Currency>('UAH');
  // DEVICE BUG fix (root cause): while the currency sheet's search field can
  // be focused, this screen's background ScrollView must NOT react to the
  // keyboard's frame change — it does not contain that responder, but
  // `automaticallyAdjustKeyboardInsets` reacts to any focus regardless
  // (see `screen.component.tsx`, `CurrencyField`'s `onOpenChange`).
  const [isCurrencySheetOpen, setIsCurrencySheetOpen] = useState(false);
  // The icon is null until the user picks one ("not dirty"): while null, the
  // chip shows the selected type's default glyph (`defaultHoldingSymbol`, a
  // property's own category glyph) and switching type or category re-derives
  // it, so an untouched icon follows the selection. Once the user picks (icon
  // !== null, "dirty"), that choice overrides the default and type changes no
  // longer move it.
  const [icon, setIcon] = useState<string | null>(null);
  // The color mirrors the icon's dirty pattern: null until the user taps a
  // swatch ("not dirty"). While null, the effective color follows the selected
  // type's default (defaultHoldingColor[type]), so the ColorPicker highlights
  // that swatch and switching type moves it. Once picked (color !== null,
  // "dirty"), the choice sticks and type changes no longer move it.
  const [color, setColor] = useState<string | null>(null);
  // `resolveEntityColor` — not a bare nullish-coalesce onto the type default —
  // because `color` here is seeded straight from a stored row
  // (setColor(holding.color) below): a stored empty-string color reaches
  // here as an unusable value the bare pattern would let through as ''.
  const effectiveColor = resolveEntityColor(color, defaultHoldingColor[type]);

  // Keep the selected type valid for what the form currently OFFERS. The account
  // loads asynchronously, so once its option set is known, a default (or
  // previously selected) type outside that set snaps to the first offered type —
  // which also re-derives the non-dirty icon to match. `typeOptions` is the
  // creatable subset in create mode (so a bank create snaps `card` -> the first
  // creatable type, `term_deposit`) and the full set in edit mode (so a seeded
  // synced card/jar stays put).
  useEffect(() => {
    if (!typeOptions.includes(type)) {
      setType(typeOptions[0]);
    }
  }, [typeOptions, type]);

  // The scroll-mode ScrollView's ref, so adding a contribution can bring the
  // newly appended row into view. `useScrollOffset` reads its LIVE content
  // offset, so a blocked Save's `scrollToField` call below knows whether the
  // first-invalid field is already visible without re-measuring the scroll
  // position itself.
  const scrollableRef = useAnimatedRef<ScrollViewInstance>();
  const scrollOffset = useScrollOffset(scrollableRef);
  const headerInset = useHeaderInset();
  // The ScrollView's own total content height, captured off `Screen`'s
  // `onContentSizeChange` (forwarded from its ScrollView) so `scrollToField`
  // can bound an over-large target against the real content extent — see
  // scroll-to-field.ts's own overshoot-clamp doc. A plain ref, not state:
  // read only imperatively at Save-press time, never needs to re-render.
  const contentHeightRef = useRef(0);

  // The one place this screen calls `scrollToField`, closing over the four
  // geometry values above — every call site (a blocked Save, an added
  // contribution) hands it just the target field and its optional focus
  // follow-up, so the geometry can never drift between call sites.
  const scrollTo = (ref: RefObject<FieldInstance | null>, focus?: () => void): void => {
    scrollToField(
      scrollableRef,
      ref,
      { currentOffset: scrollOffset.value, headerInset, contentHeight: contentHeightRef.current },
      focus,
    );
  };

  // Per-field wrapper refs, one per validated field, passed to `scrollToField`
  // in `save`'s ordered first-invalid scroll below — each field's own inline
  // error (a `TextField`/`HoldingIdentityField` `error` prop, or a relocated
  // `FieldError` for the two group/relational reasons) sits right beside it,
  // so the scroll always lands on the same field the message is anchored to.
  const nameFieldRef = useRef<FieldInstance>(null);
  // The name field's own inner TextInput, so a blocked Save can focus it
  // imperatively once it has scrolled into view — mirrors `TextField`'s own
  // `inputRef` / `HoldingIdentityField`'s own `nameInputRef`. Every other
  // type's own fields carry their input ref alongside their `scrollTargets`
  // entry instead (see each `use<Type>Fields` hook).
  const nameInputRef = useRef<TextInputInstance>(null);

  const deposit = useTermDepositFields({ currency, scrollTo });
  const bond = useBondFields({ type, isEdit, currency, setCurrency, setName });
  const property = usePropertyFields({ isEdit, currency });
  const metal = useMetalFields({ isEdit });
  const loanFields = useLoanFields({ currency });
  // Stays mounted across every type, not only while a balance type is
  // selected, so a value typed before switching away survives the switch.
  const balance = useBalanceFields({ currency });

  // The loan form's own "Paid from" picker options — read here, alongside
  // every other holdings-derived option list, the same way the transaction
  // form reads its own `loanOptions`. Every OTHER holding type's form block
  // needs neither the full holdings list nor the full account list, so
  // these two queries are scoped to this ONE field rather than hoisted to
  // the top of the component.
  const { data: allHoldings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const { data: allAccounts } = useLiveQuery(accountsRepo.listQuery(), ['accounts']);
  const accountNameById = new Map(allAccounts.map((row) => [row.id, row.name] as const));
  const paymentHoldingOptions = buildPaymentHoldingOptions(
    allHoldings,
    accountNameById,
    currency,
    loanFields.paymentHoldingId,
  );

  // The one place every holding type's own form behaviour is looked up —
  // `active` is what `isValid`, the blocked-Save scroll, and the create/edit
  // writes below all read through, so none of them need their own
  // `match(type)` dispatch. Each of the four ledgered types shares the SAME
  // `balance` hook instance (it stays mounted regardless of which type is
  // selected — see that hook's own doc comment).
  const forms: Record<HoldingType, HoldingTypeForm> = {
    term_deposit: deposit,
    bond,
    property_item: property,
    metal,
    loan: loanFields,
    card: balance,
    cash: balance,
    crypto_asset: balance,
    jar: balance,
  };
  const active = forms[type];

  // A holding type with a fixed currency (today, only `metal` — NBU quotes
  // precious metals only in UAH, kiko-pricing) offers no currency picker at
  // all (below) and this effect forces the state back to that fixed currency
  // whenever the type is (or becomes) one — covering a user who picked a
  // different currency before switching the type chip.
  useEffect(() => {
    const fixedCurrency = holdingDescriptor(type).fixedCurrency;

    if (fixedCurrency !== null && currency !== fixedCurrency) {
      setCurrency(fixedCurrency);
    }
  }, [type, currency]);

  // Seed the form once from the loaded holding (edit mode only). `useLiveQuery`
  // resolves asynchronously, so the initial render precedes the data; a one-shot
  // ref guards against re-seeding (and clobbering in-progress edits) on every
  // subsequent live-query emission. The type-specific fields are rebuilt from
  // the stored metadata: minor-unit money reads back as grouped major strings.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!isEdit || hydrated.current || editingHolding === undefined) {
      return;
    }
    hydrated.current = true;
    const holding = editingHolding;
    setName(holding.name);
    setType(holding.type);
    setCurrency(holding.currency);
    setIcon(holding.icon);
    setColor(holding.color);

    // The balance seed is the normal path for card/cash/crypto_asset/jar —
    // those types have no type-specific fields of their own. It is also the
    // fallback for a corrupted row's `type`: SQLite enforces no constraint on
    // the stored `type` column (`holdingDescriptor`'s own doc comment), so it
    // could be any string. The `Object.hasOwn` guard (mirroring
    // `holdingDescriptorOrUndefined`) routes both cases to the balance seed.
    const seeds: Record<string, HoldingTypeForm['seed']> = {
      term_deposit: deposit.seed,
      bond: bond.seed,
      property_item: property.seed,
      metal: metal.seed,
      loan: loanFields.seed,
    };
    const seed = Object.hasOwn(seeds, holding.type) ? seeds[holding.type] : balance.seed;
    seed(holding);
  }, [
    isEdit,
    editingHolding,
    deposit.seed,
    bond.seed,
    property.seed,
    metal.seed,
    loanFields.seed,
    balance.seed,
  ]);

  // The stack sets the static "Add Holding" title; in edit mode override it with
  // "Edit Holding" so the header reads correctly for the update flow.
  useLayoutEffect(() => {
    if (isEdit) {
      navigation.setOptions({ title: t('forms.holding.editTitle') });
    }
  }, [isEdit, navigation, t]);

  const isValid = name.trim().length > 0 && active.isValid;

  const [attemptedSave, setAttemptedSave] = useState(false);

  // Shown only after a failed Save press: gated on `attemptedSave` so it
  // renders nothing before the first press.
  const showNameReason = attemptedSave && name.trim().length === 0;

  const save = async (): Promise<void> => {
    if (!isValid) {
      setAttemptedSave(true);

      const nameTarget: ScrollTarget = {
        invalid: name.trim().length === 0,
        ref: nameFieldRef,
        focus: () => nameInputRef.current?.focus(),
      };
      const target = [nameTarget, ...active.scrollTargets].find((candidate) => candidate.invalid);

      if (target) {
        scrollTo(target.ref, target.focus);
      }

      return;
    }

    try {
      if (isEdit && holdingId !== undefined) {
        // Type/currency are read-only in edit mode. The hook write carries no
        // icon (each `saveEdit`'s own doc comment), so it is written here
        // separately, unconditionally, so clearing a custom icon
        // (icon === null) persists the removal rather than leaving the old
        // glyph.
        await active.saveEdit({
          holdingId,
          name,
          color,
          currency,
          isSynced: isSyncedEdit,
          editingHolding,
          book: priceBook,
        });
        await holdingsRepo.setIcon(holdingId, icon);

        // Unlike `refreshMarketData` below (type/currency are read-only in
        // edit mode, so it never fires here), a loan's principal, schedule,
        // paymentHoldingId, lenderName, and lenderIban all stay editable —
        // any of them can change what the matcher would now link, so an
        // EDIT backfills too (see `runLoanAutoLinkIfLoan`'s own doc comment).
        runLoanAutoLinkIfLoan(type);

        navigation.goBack();

        return;
      }

      // Every ledgerless type (property/metal/loan/deposit/bond)'s
      // `createPayload` writes a zero stored balance — its value derives
      // entirely from its own lots/schedule. Only `useBalanceFields`
      // (card/cash/crypto_asset/jar) reads its own live opening-balance field.
      const newHoldingId = await holdingsRepo.create({
        accountId,
        name,
        type,
        currency,
        // Persist the color only when the user picked one (dirty). Left null, the
        // row follows its type's default at display time — the same fallback the
        // icon uses — so a type-default color is not frozen onto the row.
        color,
        ...active.createPayload(),
      });

      // Persist the chosen icon on the freshly-created row, using the id the
      // create resolved to. Awaited so it commits before navigating away.
      if (icon !== null) {
        await holdingsRepo.setIcon(newHoldingId, icon);
      }

      // The FIRST metal, foreign-currency, or crypto holding needs its
      // price/rate visible without an app restart — trigger the SAME gated
      // refresh app-open runs, unthrottled (a manual create is a deliberate
      // user action, not a background poll). Both steps gate themselves on
      // data presence (kiko-architecture), so this is a no-op for a
      // type/currency that needs neither. `refreshMarketData` never rejects
      // and logs its own failure, so it never turns a successful create into
      // a shown error. Fire-and-forget (not awaited): the refresh is a
      // background nicety, not a save precondition — Save must not sit on
      // the network before navigating back; only fire the refresh after the
      // write commits.
      // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) refreshMarketData never rejects; see the comment above
      refreshMarketData({ throttled: false, metals: true });
      // A freshly created loan can already have past ledger history worth
      // backfilling (see `runLoanAutoLinkIfLoan`'s own doc comment).
      runLoanAutoLinkIfLoan(type);

      // A `returnTo` route param (set only by the "Create new holding" entry
      // points on StatementImport/ColumnMapping) carries that screen's own
      // full params plus a `screen` discriminant — this create was launched
      // from THAT screen's own target-holding picker, so pop back to it with
      // `holdingId` merged in, rather than a bare `goBack()`, which handed
      // back no id and left the just-created holding unselected even though
      // it already showed in the list. This is `popTo`, NOT `navigate`:
      // React Navigation 7's `navigate(name, params)` PUSHES a duplicate of
      // an already-on-stack route unless it is the CURRENT route, `getId`
      // matches, or `{ pop: true }` is passed
      // (`node_modules/@react-navigation/routers/src/StackRouter.tsx`'s
      // `NAVIGATE` case) — none of which apply here. `popTo` reuses the
      // existing StatementImport/ColumnMapping instance in place (its own
      // local React state, e.g. the user's already-picked columns, survives)
      // and merges `holdingId` into its params; see
      // `src/navigation/root-navigator/statement-import-return.navigator.test.tsx` for the
      // real-router proof a `navigationSpy` test cannot give. `ts-pattern`'s
      // exhaustive match narrows the union so each branch's `params`
      // type-checks against its own screen (kiko-code-style). Every other
      // HoldingForm entry point carries no `returnTo` and keeps the plain
      // `goBack()`.
      if (returnTo === undefined) {
        navigation.goBack();
      } else {
        match(returnTo)
          .with({ screen: 'StatementImport' }, ({ params }) =>
            navigation.popTo(
              'StatementImport',
              { ...params, holdingId: newHoldingId },
              { merge: true },
            ),
          )
          .with({ screen: 'ColumnMapping' }, ({ params }) =>
            navigation.popTo(
              'ColumnMapping',
              { ...params, holdingId: newHoldingId },
              { merge: true },
            ),
          )
          .exhaustive();
      }
    } catch {
      // Mirrors contribution-form's and account-form's Alert pattern: a write
      // failure keeps the screen open with the entered values intact, rather
      // than navigating away as if nothing was wrong.
      alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');
    }
  };

  const { onPress: onSave, isSubmitting } = useSubmitOnce(save);

  return (
    <Screen
      scroll
      scrollableRef={scrollableRef}
      automaticallyAdjustKeyboardInsets={!isCurrencySheetOpen}
      onContentSizeChange={(_width, height) => {
        contentHeightRef.current = height;
      }}
      footer={
        <Button onPress={onSave} disabled={isSubmitting || (isEdit && isPriceBookLoading)}>
          {t('common.save')}
        </Button>
      }
    >
      <Box gap={4} testID="holding-form">
        <View ref={nameFieldRef}>
          <HoldingIdentityField
            icons={KIKO_ENTITIES_ICONS}
            icon={icon}
            fallbackIcon={defaultHoldingSymbol({ type, metadata: { category: property.category } })}
            iconColor={effectiveColor}
            name={name}
            onChangeName={setName}
            onSelectIcon={setIcon}
            onRemoveIcon={() => setIcon(null)}
            namePlaceholder={t('forms.holding.namePlaceholder')}
            required
            error={showNameReason ? t('forms.fields.nameRequiredError') : undefined}
            nameInputRef={nameInputRef}
            testID="holding-name"
          />
        </View>

        <ColorPicker label={t('forms.fields.color')} value={effectiveColor} onSelect={setColor} />

        <Divider testID="form-divider" />

        {/* A holding's type shapes its metadata and value math, and its currency
            fixes the unit of every stored balance/transaction; no repo path
            re-shapes either, so both are read-only in edit mode — shown, but not
            switchable. `typeOptions` is the manually-creatable subset in create
            mode: a bank drops the sync-only card/jar (Monobank owns those), so a
            bank create offers only term_deposit / bond. Edit mode uses the full
            set so an existing synced card/jar row still displays its (read-only)
            type. */}
        {/* A select sheet, mirroring AccountKindField — up to 9 long type
            names (e.g. "Строковий депозит") run too wide for a chip row, the
            same label-width reasoning that moved LoanSection's kind onto
            `SelectField`. `typeSlotFor` picks which field fills the slot. */}
        {match(typeSlotFor(accountKind, typeOptions, isEdit, type))
          .with({ kind: 'property' }, () => (
            <PropertyTypeField
              selected={property.category}
              onSelect={property.setCategory}
              testID="property-category-field"
            />
          ))
          .with({ kind: 'metal' }, ({ otherTypes }) => (
            <MetalTypeField
              otherTypes={otherTypes}
              typeLabels={typeLabels}
              type={type}
              metal={metal.metal}
              onSelectType={setType}
              onSelectMetal={metal.setMetal}
              testID="holding-type-field"
            />
          ))
          .with({ kind: 'generic' }, () => (
            <HoldingTypeField
              options={typeOptions}
              selected={type}
              onSelect={setType}
              labels={typeLabels}
              icons={holdingTypeSymbol}
              disabled={isEdit}
              testID="holding-type-field"
            />
          ))
          .exhaustive()}

        {/* A holding type with a fixed currency (today, only `metal` — NBU
            quotes precious metals only in UAH, kiko-pricing) offers no
            currency picker at all — the effect above keeps `currency` at
            that fixed value underneath regardless of what this field would
            otherwise show. */}
        {holdingDescriptor(type).fixedCurrency === null && (
          <CurrencyField
            label={t('forms.fields.currency')}
            sheetTitle={t('forms.fields.currencySheetTitle')}
            selected={currency}
            onSelect={setCurrency}
            options={holdingCurrencyOptions(type)}
            cryptoFirst={type === 'crypto_asset'}
            disabled={isEdit}
            onOpenChange={setIsCurrencySheetOpen}
            testID="holding-currency-field"
          />
        )}

        {match(type)
          .with('term_deposit', () => (
            <TermDepositFormBlock fields={deposit} attemptedSave={attemptedSave} />
          ))
          .with('bond', () => <BondFormBlock fields={bond} attemptedSave={attemptedSave} />)
          .with('property_item', () => (
            <PropertyFormBlock fields={property} attemptedSave={attemptedSave} isEdit={isEdit} />
          ))
          .with('metal', () => (
            <MetalFormBlock fields={metal} attemptedSave={attemptedSave} isEdit={isEdit} />
          ))
          .with('loan', () => (
            <LoanFormBlock
              fields={loanFields}
              attemptedSave={attemptedSave}
              paymentHoldingOptions={paymentHoldingOptions}
            />
          ))
          .with('card', 'cash', 'crypto_asset', 'jar', () => (
            <BalanceFormBlock fields={balance} isSyncedEdit={isSyncedEdit} />
          ))
          .exhaustive()}
      </Box>
    </Screen>
  );
};

export default HoldingFormScreen;
