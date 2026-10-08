import { match } from 'ts-pattern';
import {
  creatableHoldingTypesForAccount,
  type HoldingType,
  holdingTypes,
  holdingTypesForAccountKind,
} from '@kiko/holdings/holding-type';
import {
  holdingCurrencyOptions,
  isCurrencyExpectedForHoldingType,
} from '@kiko/holdings/holding-currency';
import type { TFunction } from 'i18next';
import {
  holdsOnlyDebts,
  holdingDescriptor,
  isLedgerlessHoldingType,
} from '@kiko/holdings/holding-descriptor';
import maybe, { foldMap } from 'fnts/maybe';
import { accountsRepo } from '@kiko/accounts';
import { useTranslation } from 'react-i18next';
import {
  type CreateHoldingRoute,
  resolveCreateHoldingTarget,
} from '@kiko/screens/forms/create-holding-target';
import { holdingsRepo } from '@kiko/holdings/repo';
import Box from '@kiko/design-system/components/box';
import type { Currency } from '@kiko/currency/currency';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import { type TextInputInstance, View } from 'react-native';
import { needsPriceBook } from '@kiko/holdings/priced-value';
import Divider from '@kiko/design-system/components/divider';
import { runLoanAutoLink } from '@kiko/loans/use-loan-auto-link';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import { holdingIconPool } from '@kiko/holdings/entity-icon-pool';
import { defaultHoldingColor } from '@kiko/holdings/entity-colors';
import { refreshMarketData } from '@kiko/sync/refresh-market-data';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import { resolveEntityColor } from '@kiko/design-system/entity-tint';
import ColorPicker from '@kiko/design-system/components/color-picker';
import HoldingTypeField from '@kiko/screens/forms/holding-type-field';
import AccountKindField from '@kiko/screens/forms/account-kind-field';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import { useLiveQuery, type AccountRow, type HoldingRow } from '@kiko/db';
import CurrencyField from '@kiko/design-system/components/currency-field';
import { useCurrentPriceBook } from '@kiko/prices/use-current-price-book';
import { useScrollToField } from '@kiko/design-system/use-scroll-to-field';
import { isSyncedAccount, isSyncedHolding } from '@kiko/holdings/deletable';
import { toHoldingOption } from '@kiko/screens/forms/holding-select-option';
import { type FC, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AccountsStackParamList, FormDraft } from '@kiko/navigation/types';
import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';
import { defaultHoldingSymbol, holdingTypeSymbol } from '@kiko/holdings/entity-symbols';
import HoldingIdentityField from '@kiko/design-system/components/holding-identity-field';
import { type ImplicitAccountKind, isImplicitAccountKind } from '@kiko/holdings/implicit-account';

import LoanFormBlock from './loan/loan-form-block';
import LoanKindField from './loan/loan-kind-field';
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
import { type HoldingFormTarget, holdingFormDraft, holdingFormTarget } from './holding-form-target';

// Fire-and-forget, only for a loan: the matcher backfills from the loan's
// own start date, so a create OR an edit (principal/schedule/
// paymentHoldingId/lenderName/lenderIban can all change) needs a fresh run.
// Never rejects (its own doc comment),
// so `save` never awaits or catches it. Extracted to a module-level function
// (a plain call, not an inline `if`) so this ONE extra branch stays out of
// `save`'s own cognitive-complexity budget.
const runLoanAutoLinkIfLoan = (type: HoldingType): void => {
  if (type === 'loan') {
    // runLoanAutoLink catches every failure and never rejects.
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
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
    .map((candidate) => toHoldingOption(candidate, accountNameById));

  if (selectedHoldingId === null || openOptions.some((option) => option.id === selectedHoldingId)) {
    return openOptions;
  }

  const selectedHolding = holdings.find((candidate) => candidate.id === selectedHoldingId);

  if (selectedHolding === undefined) {
    return openOptions;
  }

  return [...openOptions, toHoldingOption(selectedHolding, accountNameById)];
};

// Which field fills the Type slot. A `property` account's only type IS its
// category, and a `debt` account's only type IS its loan kind, so the category
// or kind picker takes the slot. Wherever a `metal` holding
// can be created — a metals account, or a bank that sells metals — or one is
// being edited, each metal is its own row (`MetalTypeField`), after the
// account's other creatable types; an edit locks the type, so it lists the
// metals alone. Everything else, including the edit of a non-metal holding on
// a bank that sells metals, keeps the generic field.
type TypeSlot =
  | { kind: 'property' }
  | { kind: 'loan' }
  | { kind: 'metal'; otherTypes: readonly HoldingType[] }
  | { kind: 'generic' };

const typeSlotFor = (
  accountKind: AccountRow['kind'] | undefined,
  typeOptions: readonly HoldingType[],
  isEdit: boolean,
  type: HoldingType,
): TypeSlot =>
  match(accountKind)
    .with('property', (): TypeSlot => ({ kind: 'property' }))
    .with('debt', (): TypeSlot => ({ kind: 'loan' }))
    .otherwise((): TypeSlot => {
      if (isEdit) {
        return type === 'metal' ? { kind: 'metal', otherTypes: [] } : { kind: 'generic' };
      }

      if (typeOptions.includes('metal')) {
        return { kind: 'metal', otherTypes: typeOptions.filter((option) => option !== 'metal') };
      }

      return { kind: 'generic' };
    });

// An implicit create names no account, so the account query it shares with the
// account mode gets the empty id that matches no row.
const targetAccountId = (target: HoldingFormTarget): string =>
  match(target)
    .with({ kind: 'account' }, ({ accountId }) => accountId)
    .with({ kind: 'implicit' }, () => '')
    .exhaustive();

// What constrains the offered holding types: the named account's kind once its
// row loads, or the kind an implicit create was opened for.
const kindOfTarget = (
  target: HoldingFormTarget,
  account: AccountRow | undefined,
): AccountRow['kind'] | undefined =>
  match(target)
    .with({ kind: 'account' }, () => account?.kind)
    .with({ kind: 'implicit' }, ({ implicitKind }) => implicitKind)
    .exhaustive();

type NewHoldingInput = Parameters<typeof accountsRepo.createImplicitHolding>[1];

// Inserts the holding and resolves to its id: into the named account, or into
// the implicit account of the kind, which that one write finds or creates.
const createHolding = (target: HoldingFormTarget, input: NewHoldingInput): Promise<string> =>
  match(target)
    .with({ kind: 'account' }, ({ accountId }) => holdingsRepo.create({ accountId, ...input }))
    .with({ kind: 'implicit' }, async ({ implicitKind }) => {
      const { holdingId } = await accountsRepo.createImplicitHolding(implicitKind, input);

      return holdingId;
    })
    .exhaustive();

// The header names what the form does. An implicit create keeps the account
// form's title, since on screen it is that form with the fields swapped, and a
// debt account's form names a loan, never a "holding".
const headerTitle = (
  t: TFunction,
  flags: { isEdit: boolean; isImplicit: boolean; debtAccount: boolean },
): string | undefined =>
  match(flags)
    .with({ isEdit: true, debtAccount: true }, () => t('forms.holding.editLoanTitle'))
    .with({ isEdit: true }, () => t('forms.holding.editTitle'))
    .with({ isImplicit: true }, () => t('forms.account.addTitle'))
    .with({ debtAccount: true }, () => t('forms.holding.addLoanTitle'))
    .otherwise(() => undefined);

// This screen is registered in BOTH the Accounts and Home stacks (Home reaches it
// from the transaction form's empty pickers), so it cannot bind its props to one
// stack's param list. It declares exactly the navigation methods it calls,
// structurally satisfied by either stack. `popTo` is only reached when a
// `returnTo` is present, which only the Accounts stack's import screens set.
type HoldingFormScreenProps = {
  route: { params: AccountsStackParamList['HoldingForm'] };
  navigation: {
    goBack: () => void;
    setOptions: (options: { title: string }) => void;
    setParams: (params: { implicitKind: ImplicitAccountKind }) => void;
    replace: (name: 'AccountForm', params: AccountsStackParamList['AccountForm']) => void;
    push: (...route: CreateHoldingRoute) => void;
    popTo: <Name extends 'StatementImport' | 'ColumnMapping'>(
      name: Name,
      params: AccountsStackParamList[Name],
      options: { merge: true },
    ) => void;
  };
};

type HoldingFormNavigation = HoldingFormScreenProps['navigation'];

// The kind field's two outcomes in implicit mode. The other implicit kind
// re-targets this form at once, in place. Any other kind leaves for the account
// form once the sheet has closed, so the field shows that pick at once: the
// sheet is still closing, and left on the old kind the form looks frozen.
const retargetImplicitKind = (
  navigation: HoldingFormNavigation,
  kind: AccountRow['kind'],
  showLeavingKind: (kind: AccountRow['kind']) => void,
): void => {
  if (isImplicitAccountKind(kind)) {
    navigation.setParams({ implicitKind: kind });

    return;
  }

  showLeavingKind(kind);
};

// Any other kind creates an account, so the account form takes over. It runs
// once the kind sheet has finished closing, as replacing sooner would unmount
// the screen that owns the sheet mid-close.
const leaveForAccountForm = (
  navigation: HoldingFormNavigation,
  kind: AccountRow['kind'],
  draft: FormDraft,
): void => {
  if (!isImplicitAccountKind(kind)) {
    navigation.replace('AccountForm', { initialKind: kind, draft });
  }
};

// A kind that creates an account takes the user to the account form, which only
// runs once the kind sheet's Modal is gone, so that sheet closes with no fade
// rather than make the swap wait for it.
const isLeavingKind = (kind: AccountRow['kind']): boolean => !isImplicitAccountKind(kind);

// What the kind field shows: the kind just picked that leaves for the account
// form, else the implicit kind this form is on. At module scope to keep this
// branch out of HoldingFormScreen's own cognitive complexity score.
const shownKind = (
  implicitKind: AccountRow['kind'],
  leavingKind: AccountRow['kind'] | undefined,
): AccountRow['kind'] => leavingKind ?? implicitKind;

const HoldingFormScreen: FC<HoldingFormScreenProps> = ({ route, navigation }) => {
  const { holdingId, returnTo } = route.params;
  // A named account, or the implicit one a create finds or makes on Save, and
  // the identity the account form carried over (an implicit create only).
  const target = holdingFormTarget(route.params);
  const draft = holdingFormDraft(route.params);
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
  // The example name in the empty Name field, one per type, so the hint never
  // names a different kind of holding than the selected one.
  const namePlaceholders: Record<HoldingType, string> = {
    card: t('forms.holding.namePlaceholders.card'),
    term_deposit: t('forms.holding.namePlaceholders.deposit'),
    bond: t('forms.holding.namePlaceholders.bond'),
    cash: t('forms.holding.namePlaceholders.cash'),
    crypto_asset: t('forms.holding.namePlaceholders.cryptoAsset'),
    jar: t('forms.holding.namePlaceholders.jar'),
    property_item: t('forms.holding.namePlaceholders.propertyItem'),
    metal: t('forms.holding.namePlaceholders.metal'),
    loan: t('forms.holding.namePlaceholders.loan'),
  };
  // A `holdingId` in the route params switches the form to EDIT mode: the same
  // fields, seeded from the existing holding, saving through the update path
  // rather than create.
  const isEdit = holdingId !== undefined;
  // The account this holding is created under; its `kind` constrains which
  // holding types are offered (a bank can't hold a crypto asset or cash, etc.).
  const { data: accounts } = useLiveQuery(accountsRepo.byIdQuery(targetAccountId(target)), [
    'accounts',
  ]);
  const account = accounts.at(0);
  const accountKind = kindOfTarget(target, account);
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

  const [name, setName] = useState(draft.name);
  // The selected type starts at the first type the form offers right now
  // (`typeOptions[0]`). The account loads asynchronously, so the effect below
  // snaps it to the first CREATABLE type for the account's kind once the option
  // set is known — a bank create (where card/jar are sync-only and excluded)
  // lands on `term_deposit` — and an edit seeds the real type from the row.
  const [type, setType] = useState<HoldingType>(typeOptions[0]);

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
  const { book: priceBook, isLoading: isPriceBookLoading } = useCurrentPriceBook(
    needsPriceBook(editingHolding?.type ?? type),
  );
  const [currency, setCurrency] = useState<Currency>('UAH');
  // While the currency sheet's search field can be
  // focused, this screen's background ScrollView must NOT react to the
  // keyboard's frame change — it does not contain that responder, but
  // `automaticallyAdjustKeyboardInsets` reacts to any focus regardless (see
  // `screen.component.tsx`, `CurrencyField`'s `onOpenChange`).
  const [isSearchSheetOpen, setIsSearchSheetOpen] = useState(false);
  // The kind just picked on the kind field that leaves for the account form,
  // shown there until the swap replaces this screen (see `retargetImplicitKind`).
  const [leavingKind, setLeavingKind] = useState<AccountRow['kind'] | undefined>(undefined);
  // The icon is null until the user picks one ("not dirty"): while null, the
  // chip shows the selected type's default glyph (`defaultHoldingSymbol`, a
  // property's own category glyph) and switching type or category re-derives
  // it, so an untouched icon follows the selection. Once the user picks (icon
  // !== null, "dirty"), that choice overrides the default and type changes
  // leave it in place.
  const [icon, setIcon] = useState<string | null>(draft.icon);
  // The color mirrors the icon's dirty pattern: null until the user taps a
  // swatch ("not dirty"). While null, the effective color follows the selected
  // type's default (defaultHoldingColor[type]), so the ColorPicker highlights
  // that swatch and switching type moves it. Once picked (color !== null,
  // "dirty"), the choice sticks and type changes leave it in place.
  const [color, setColor] = useState<string | null>(draft.color);
  // `resolveEntityColor` — not a bare nullish-coalesce onto the type default —
  // because `color` here is seeded straight from a stored row
  // (setColor(holding.color) below): a stored empty-string color reaches
  // here as an unusable value the bare pattern would let through as ''.
  const effectiveColor = resolveEntityColor(color, defaultHoldingColor[type]);

  // Keep the selected type valid for what the form currently OFFERS. The account
  // loads asynchronously, so once its option set is known, a default (or
  // already-selected) type outside that set snaps to the first offered type —
  // which also re-derives the non-dirty icon to match. `typeOptions` is the
  // creatable subset in create mode (so a bank create snaps `card` -> the first
  // creatable type, `term_deposit`) and the full set in edit mode (so a seeded
  // synced card/jar stays put).
  useEffect(() => {
    if (!typeOptions.includes(type)) {
      setType(typeOptions[0]);
    }
  }, [typeOptions, type]);

  // Every call site (a blocked Save, an added contribution) hands `scrollTo`
  // just the target field and its optional focus follow-up, so the scroll
  // geometry can never drift between call sites.
  const { scrollableRef, onContentSizeChange, scrollTo } = useScrollToField();

  // Per-field wrapper refs, one per validated field, passed to `scrollTo`
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
  const bond = useBondFields({ type, isEdit, currency, setCurrency, name, setName });
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
  // `push`, not `navigate`: `navigate` to this form's own route name only
  // changes this route's params, which would turn the loan form into the new
  // holding's form. A push leaves this one mounted underneath with its draft.
  // The picker lists the holdings `buildPaymentHoldingOptions` keeps that can be
  // created in the loan's currency.
  const createPaymentHolding = (): void => {
    navigation.push(
      ...resolveCreateHoldingTarget(
        {
          anchorAccountId: undefined,
          accepts: (type) =>
            !isLedgerlessHoldingType(type) && isCurrencyExpectedForHoldingType(type, currency),
        },
        allAccounts,
      ),
    );
  };

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
  // "Edit Holding" so the header reads correctly for the update flow. An edit's
  // route says on the first frame whether it is a loan; the account row only
  // arrives on a later render.
  const debtAccount = route.params.debtAccount ?? holdsOnlyDebts(accountKind);
  const isImplicit = target.kind === 'implicit';

  useLayoutEffect(() => {
    foldMap(maybe(headerTitle(t, { isEdit, isImplicit, debtAccount })), (title) =>
      navigation.setOptions({ title }),
    );
  }, [isEdit, isImplicit, debtAccount, navigation, t]);

  const isValid = name.trim().length > 0 && active.isValid;

  const [attemptedSave, setAttemptedSave] = useState(false);

  // Shown only after a failed Save press: gated on `attemptedSave` so it
  // renders nothing before the first press.
  const showNameReason = attemptedSave && name.trim().length === 0;

  // Every field shows its own error from now on; the first one still invalid
  // scrolls into view.
  const revealInvalid = (targets: readonly ScrollTarget[]): void => {
    setAttemptedSave(true);

    const target = targets.find((candidate) => candidate.invalid);

    if (target) {
      scrollTo(target.ref, target.focus);
    }
  };

  // Type/currency are read-only in edit mode. The hook write carries no icon
  // (each `saveEdit`'s own doc comment), so it is written here separately,
  // unconditionally, so clearing a custom icon (icon === null) persists the
  // removal rather than leaving the old glyph.
  const saveEdit = async (editedHoldingId: string): Promise<void> => {
    await active.saveEdit({
      holdingId: editedHoldingId,
      name,
      color,
      currency,
      isSynced: isSyncedEdit,
      editingHolding,
      book: priceBook,
    });
    await holdingsRepo.setIcon(editedHoldingId, icon);

    // A loan's principal, schedule, paymentHoldingId, lenderName, and
    // lenderIban all stay editable — any of them can change what the
    // matcher would now link, so an EDIT backfills too (see
    // `runLoanAutoLinkIfLoan`'s own doc comment).
    runLoanAutoLinkIfLoan(type);

    navigation.goBack();
  };

  const save = async (): Promise<void> => {
    if (!isValid) {
      const nameTarget: ScrollTarget = {
        invalid: name.trim().length === 0,
        ref: nameFieldRef,
        focus: () => nameInputRef.current?.focus(),
      };

      revealInvalid([nameTarget, ...active.scrollTargets]);

      return;
    }

    try {
      if (isEdit && holdingId !== undefined) {
        await saveEdit(holdingId);

        return;
      }

      // Every ledgerless type (property/metal/loan/deposit/bond)'s
      // `createPayload` writes a zero stored balance — its value derives
      // entirely from its own lots/schedule. Only `useBalanceFields`
      // (card/cash/crypto_asset/jar) reads its own live opening-balance field.
      const newHoldingId = await createHolding(target, {
        name,
        type,
        currency,
        // Persist the color only when the user picked one (dirty). Left null, the
        // row follows its type's default at display time — the same fallback the
        // icon uses — so a type-default color is not frozen onto the row.
        color,
        // The icon goes in the create's own write: a second write could fail
        // after the row exists, and the retry would then insert it again.
        icon,
        ...active.createPayload(),
      });

      // The FIRST metal, foreign-currency, or crypto holding needs its
      // price/rate visible without an app restart — trigger the SAME gated
      // refresh app-open runs, unthrottled (a manual create is a deliberate
      // user action, not a background poll). Every step gates itself on
      // data presence (kiko-architecture), so this is a no-op for a
      // type/currency that needs none of them. `refreshMarketData` never rejects
      // and logs its own failure, so it never turns a successful create into
      // a shown error. Fire-and-forget (not awaited): the refresh is a
      // background nicety, not a save precondition — Save must not sit on
      // the network before navigating back; only fire the refresh after the
      // write commits.
      // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) never rejects
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
      automaticallyAdjustKeyboardInsets={!isSearchSheetOpen}
      onContentSizeChange={onContentSizeChange}
      footer={
        <Button onPress={onSave} disabled={isSubmitting || (isEdit && isPriceBookLoading)}>
          {t('common.save')}
        </Button>
      }
    >
      <Box gap={4} testID="holding-form">
        <View ref={nameFieldRef}>
          <HoldingIdentityField
            icons={holdingIconPool}
            icon={icon}
            fallbackIcon={defaultHoldingSymbol({
              type,
              metadata: { category: property.category, kind: loanFields.kind },
            })}
            iconColor={effectiveColor}
            name={name}
            onChangeName={setName}
            onSelectIcon={setIcon}
            onRemoveIcon={() => setIcon(null)}
            namePlaceholder={namePlaceholders[type]}
            required
            error={showNameReason ? t('forms.fields.nameRequiredError') : undefined}
            nameInputRef={nameInputRef}
            testID="holding-name"
          />
        </View>

        <ColorPicker label={t('forms.fields.color')} value={effectiveColor} onSelect={setColor} />

        <Divider testID="form-divider" />

        {/* Where the account form's kind field sits, so picking Property or Loan
            there swaps the fields below it and leaves this one in place. */}
        {match(target)
          .with({ kind: 'implicit' }, ({ implicitKind }) => (
            <AccountKindField
              selected={shownKind(implicitKind, leavingKind)}
              onSelect={(kind) => retargetImplicitKind(navigation, kind, setLeavingKind)}
              onSelectClosed={(kind) =>
                leaveForAccountForm(navigation, kind, { name, icon, color })
              }
              closesWithoutAnimation={isLeavingKind}
              disabled={false}
            />
          ))
          .with({ kind: 'account' }, () => null)
          .exhaustive()}

        {/* A holding's type shapes its metadata and value math, and its currency
            fixes the unit of every stored balance/transaction; no repo path
            re-shapes either, so both are read-only in edit mode — shown, but not
            switchable. `typeOptions` is the manually-creatable subset in create
            mode: a bank drops the sync-only card/jar (Monobank owns those), so a
            bank create offers only term_deposit / bond. Edit mode uses the full
            set so an existing synced card/jar row still displays its (read-only)
            type. */}
        {/* A select sheet, mirroring AccountKindField — up to 9 long type
            names (e.g. "Строковий депозит") run too wide for a chip row.
            `typeSlotFor` picks which field fills the slot. */}
        {match(typeSlotFor(accountKind, typeOptions, isEdit, type))
          .with({ kind: 'property' }, () => (
            <PropertyTypeField
              selected={property.category}
              onSelect={property.setCategory}
              testID="property-category-field"
            />
          ))
          .with({ kind: 'loan' }, () => (
            <LoanKindField
              selected={loanFields.kind}
              onSelect={loanFields.setKind}
              testID="loan-kind-field"
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
            onOpenChange={setIsSearchSheetOpen}
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
              onCreatePaymentHolding={createPaymentHolding}
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
