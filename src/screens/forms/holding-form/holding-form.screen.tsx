import { match } from 'ts-pattern';
import { Alert, View } from 'react-native';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { holdingsRepo, type LoanPricePointOp } from '@kiko/holdings/repo';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import type { ScrollViewInstance, TextInputInstance } from 'react-native';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  creatableHoldingTypesForAccount,
  type HoldingType,
  holdingTypes,
  holdingTypesForAccountKind,
} from '../../../holdings/holding-type';
import ColorPicker from '../color-picker';
import {
  useHeaderInset,
  scrollToField,
  type FieldInstance,
} from '../scroll-to-field/scroll-to-field';
import { Money } from '../../../currency/money';
import HoldingTypeField from '../holding-type-field';
import type { HoldingRow } from '../../../db/schema';
import { parseAmount } from '../../../currency/parse';
import Box from '../../../design-system/components/box';
import { shiftDecimal } from '../../../currency/decimal';
import { useLiveQuery } from '../../../db/use-live-query';
import HoldingIdentityField from '../holding-identity-field';
import Button from '../../../design-system/components/button';
import Screen from '../../../design-system/components/screen';
import { usePriceBook } from '../../../prices/use-price-book';
import Divider from '../../../design-system/components/divider';
import { useSubmitOnce } from '../use-submit-once/use-submit-once';
import TextField from '../../../design-system/components/text-field';
import { holdingTypeSymbol } from '../../../holdings/entity-symbols';
import { dayKeyOf, type PriceBook } from '../../../prices/price-book';
import { defaultHoldingColor } from '../../../holdings/entity-colors';
import { resolveEntityColor } from '../../../design-system/entity-tint';
import type { AccountsStackParamList } from '../../../navigation/types';
import { loanOutstandingMinorAt } from '../../../holdings/loan-schedule';
import CurrencyField from '../../../design-system/components/currency-field';
import { groupAmount, majorAmountText } from '../amount-format/amount-format';
import { asLoanMeta, type LoanMeta } from '../../../holdings/holding-metadata';
import { isSyncedAccount, isSyncedHolding } from '../../../holdings/deletable';
import { type Currency, currencyScale, currencySymbol } from '../../../currency/currency';
import { KIKO_ENTITIES_ICONS } from '../../../design-system/components/icon-picker-modal/icon-pools';

import {
  useLoanFields,
  type LoanReasonKey,
  type UseLoanFieldsResult,
} from './loan/use-loan-fields';
import {
  useTermDepositFields,
  type UseTermDepositFieldsResult,
} from './term-deposit/use-term-deposit-fields';
import LoanFormBlock from './loan/loan-form-block';
import BondFormBlock from './bond/bond-form-block';
import MetalFormBlock from './metal/metal-form-block';
import PropertyFormBlock from './property/property-form-block';
import TermDepositFormBlock from './term-deposit/term-deposit-form-block';
import { useBondFields, type UseBondFieldsResult } from './bond/use-bond-fields';
import { useMetalFields, type UseMetalFieldsResult } from './metal/use-metal-fields';
import type { ScrollTarget, CreatePayload, HoldingTypeForm } from './holding-type-form';
import { usePropertyFields, type UsePropertyFieldsResult } from './property/use-property-fields';

type HoldingFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'HoldingForm'>;

// The partial row an edit-mode save writes: always the editable identity fields
// (name, color), plus the one value field that belongs to the type — a
// deposit/bond's value derives from its metadata (its balance is not stored), so
// those write metadata; every other type writes its edited balance. A synced
// (Monobank) holding is the exception: its balance is owned by the sync, so the
// patch omits balanceMinorUnits entirely and only touches the identity fields.
const buildHoldingPatch = (params: {
  name: string;
  color: string | null;
  type: HoldingType;
  currency: Currency;
  openingBalance: string;
  metadata: Record<string, unknown> | undefined;
  isSynced: boolean;
}): Partial<HoldingRow> => {
  const { name, color, type, currency, openingBalance, metadata, isSynced } = params;

  // A ledgerless type (term_deposit, bond, property_item — see kiko-domain)
  // never writes a balance here: its value derives from its own metadata, not
  // a raw stored balance. A property's `metadata` on this edit path is always
  // `{ category, lots }` with the ORIGINAL (hydrated) lots preserved verbatim
  // — see `buildMetadata`'s own `property_item` branch — so an edit never
  // rewrites cost/quantity history; only category is user-editable here.
  if (isLedgerlessHoldingType(type)) {
    return { name, color, metadata };
  }

  if (isSynced) {
    return { name, color };
  }

  return {
    name,
    color,
    balanceMinorUnits: Money.fromMajor(currency, parseAmount(openingBalance) || 0).minorUnits,
  };
};

// The fields `buildLoanMeta`/`buildLoanCreatePayload` both need (ponytail:
// a `Pick` off the hook's own result type, not a restated shape).
type LoanFieldsSnapshot = Pick<
  UseLoanFieldsResult,
  'kind' | 'principal' | 'startDate' | 'schedule' | 'annualRatePct' | 'termMonths'
>;

// A loan's `LoanMeta` (T26/T28, spec 5.1) — shared by `buildMetadata`'s EDIT
// branch and `buildLoanCreatePayload` below, so the two can never build a
// differently shaped `LoanMeta` for the same field values.
const buildLoanMeta = (fields: LoanFieldsSnapshot, currency: Currency): LoanMeta => ({
  kind: fields.kind,
  principalMinorUnits: Money.fromMajor(currency, parseAmount(fields.principal) || 0).minorUnits,
  startDate: fields.startDate ?? Date.now(),
  schedule: fields.schedule,
  ...(fields.schedule === 'none'
    ? {}
    : {
        annualRatePct: parseAmount(fields.annualRatePct) || 0,
        termMonths: parseAmount(fields.termMonths) || 0,
      }),
});

// The loan CREATE payload (T28): a zero stored balance (ledgerless — its
// value derives entirely from the schedule math / its own manual series,
// kiko-domain) plus the `LoanMeta` above. A `'none'` schedule (an informal
// debt) ADDITIONALLY writes a first `manual` price point on the holding's
// own `holding:<id>` series equal to the principal, dated the start day —
// mirroring `buildPropertyCreatePayload`'s own first-point convention —
// so `loanOutstandingMinorAt`'s manual-series read never comes up empty
// before the user records a real correction. An `'annuity'`/`'differentiated'`
// schedule writes none: its outstanding is computed at read time from the
// principal + schedule (`loanOutstandingMinorAt`'s own no-correction
// fallback), so no correction point is needed yet.
const buildLoanCreatePayload = (
  fields: LoanFieldsSnapshot,
  currency: Currency,
): {
  balanceMinorUnits: number;
  metadata: LoanMeta;
  firstPricePoint?: { day: number; price: string };
} => {
  const metadata = buildLoanMeta(fields, currency);

  if (fields.schedule !== 'none') {
    return { balanceMinorUnits: 0, metadata };
  }

  const day = dayKeyOf(fields.startDate ?? Date.now());

  return {
    balanceMinorUnits: 0,
    metadata,
    firstPricePoint: {
      day,
      price: shiftDecimal(String(metadata.principalMinorUnits), -currencyScale[currency]),
    },
  };
};

/**
 * The `LoanPricePointOp` a loan EDIT's `holdingsRepo.updateLoan` call needs
 * — the three-case ruling in kiko-domain's "Loan form + detail": (a) a
 * schedule change INTO `'none'` preserves the OLD schedule's current
 * outstanding as a manual point, so the debt never silently reads as 0 the
 * instant the schedule is cleared; (b) a `'none'` loan's principal/start-date
 * edit moves its start-day point (any later correction stays); (c) every
 * other transition (including `'none'` OUT to a schedule) leaves the manual
 * series untouched — a correction point is still valid for a scheduled loan
 * (N10a). `oldMeta === null` (a fresh holding, or unparsed metadata) has
 * nothing to reconcile.
 */
const buildLoanPricePointOp = (params: {
  oldMeta: LoanMeta | null;
  newMeta: LoanMeta;
  holdingId: string;
  currency: Currency;
  book: PriceBook;
  now: number;
}): LoanPricePointOp => {
  const { oldMeta, newMeta, holdingId, currency, book, now } = params;

  if (oldMeta === null) {
    return { kind: 'none' };
  }

  if (oldMeta.schedule !== 'none' && newMeta.schedule === 'none') {
    // (a) normally dates the preserved point today. But `loanOutstandingMinorAt`
    // reads 0 for any instant before the loan's own `startDate` (a future-start
    // loan), so dating it today would write a permanent 0 that outlives the
    // start date once it arrives. Write the principal at the start day instead
    // — mirroring the create-mode `'none'` first point — whenever today is
    // still before that day.
    const beforeStart = dayKeyOf(now) < dayKeyOf(newMeta.startDate);
    const day = beforeStart ? dayKeyOf(newMeta.startDate) : dayKeyOf(now);
    const outstanding = beforeStart
      ? newMeta.principalMinorUnits
      : loanOutstandingMinorAt(oldMeta, holdingId, book, now);

    return {
      kind: 'upsert',
      day,
      price: shiftDecimal(String(outstanding), -currencyScale[currency]),
      currency,
    };
  }

  if (
    oldMeta.schedule === 'none' &&
    newMeta.schedule === 'none' &&
    (oldMeta.principalMinorUnits !== newMeta.principalMinorUnits ||
      oldMeta.startDate !== newMeta.startDate)
  ) {
    return {
      kind: 'move',
      oldDay: dayKeyOf(oldMeta.startDate),
      newDay: dayKeyOf(newMeta.startDate),
      price: shiftDecimal(String(newMeta.principalMinorUnits), -currencyScale[currency]),
      currency,
    };
  }

  return { kind: 'none' };
};

// The EDIT-mode save for a loan (T28 review round 1, I1) — extracted out of
// `save` purely to keep that function's own branch count under the
// cognitive-complexity budget, the same reason `buildLoanPricePointOp` and
// `LoanFormBlock` are their own top-level functions. `oldMeta` reads the
// STILL-STORED (pre-edit) metadata off the live-queried `editingHolding`, so
// `buildLoanPricePointOp` can tell what actually changed.
const saveLoanEdit = (params: {
  holdingId: string;
  patch: Partial<HoldingRow>;
  editingHolding: HoldingRow | undefined;
  loanFields: LoanFieldsSnapshot;
  currency: Currency;
  book: PriceBook;
}): Promise<void> => {
  const { holdingId, patch, editingHolding, loanFields, currency, book } = params;
  const oldMeta = editingHolding ? asLoanMeta(editingHolding.metadata) : null;

  return holdingsRepo.updateLoan(
    holdingId,
    patch,
    buildLoanPricePointOp({
      oldMeta,
      newMeta: buildLoanMeta(loanFields, currency),
      holdingId,
      currency,
      book,
      now: Date.now(),
    }),
  );
};

// The whole EDIT-mode write (metadata/balance + icon), extracted out of
// `save` purely to keep that function's own branch count under the
// cognitive-complexity budget. A loan's edit ALSO reconciles its manual
// `holding:<id>` series in the same transaction (`saveLoanEdit`, T28 review
// round 1, I1); every other type's edited balance lands on the ledger
// instead (`updateWithBalanceDelta`, not `update` — a patch with no balance
// in it, a deposit/bond/synced holding, writes no ledger row).
const saveEdit = async (params: {
  holdingId: string;
  patch: Partial<HoldingRow>;
  editingHolding: HoldingRow | undefined;
  loanFields: LoanFieldsSnapshot;
  type: HoldingType;
  currency: Currency;
  book: PriceBook;
  icon: string | null;
}): Promise<void> => {
  const { holdingId, patch, editingHolding, loanFields, type, currency, book, icon } = params;

  if (type === 'loan') {
    await saveLoanEdit({ holdingId, patch, editingHolding, loanFields, currency, book });
  } else {
    await holdingsRepo.updateWithBalanceDelta(holdingId, patch, Date.now());
  }

  // Write the icon unconditionally in edit mode so clearing a custom icon
  // (icon === null) persists the removal rather than leaving the old glyph.
  await holdingsRepo.setIcon(holdingId, icon);
};

// The EDIT-mode save for a hook-owned ledgerless type (term_deposit, bond,
// property_item — R3 Phase C) — extracted out of `save` purely to keep that function's own
// branch count under the cognitive-complexity budget, the same reason
// `saveLoanEdit` is. Routed through the hook's own `saveEdit` rather than
// `buildHoldingPatch`/the generic `saveEdit` above: it builds its metadata
// from state closed over inside the hook, which no longer lives on this
// screen. That hook write carries no icon (its own doc comment), so this
// helper writes it separately, same as every edit path.
const saveHookEdit = async (params: {
  holdingId: string;
  fields: HoldingTypeForm;
  name: string;
  color: string | null;
  currency: Currency;
  isSynced: boolean;
  editingHolding: HoldingRow | undefined;
  book: PriceBook;
  icon: string | null;
}): Promise<void> => {
  const { holdingId, fields, name, color, currency, isSynced, editingHolding, book, icon } = params;

  await fields.saveEdit({ holdingId, name, color, currency, isSynced, editingHolding, book });
  await holdingsRepo.setIcon(holdingId, icon);
};

// The whole isEdit-mode write: `term_deposit`/`bond`/`property_item` route
// through `saveHookEdit` above; every other type builds its patch via
// `buildHoldingPatch` and writes it through `saveEdit`. Extracted out of
// `save` purely to keep that function's own branch count under the
// cognitive-complexity budget — the type dispatch itself is what pushed
// `save` over the limit.
const performEditSave = (params: {
  type: HoldingType;
  holdingId: string;
  deposit: UseTermDepositFieldsResult;
  bond: UseBondFieldsResult;
  property: UsePropertyFieldsResult;
  metal: UseMetalFieldsResult;
  name: string;
  color: string | null;
  currency: Currency;
  openingBalance: string;
  metadata: Record<string, unknown> | undefined;
  isSynced: boolean;
  editingHolding: HoldingRow | undefined;
  loanFields: LoanFieldsSnapshot;
  book: PriceBook;
  icon: string | null;
}): Promise<void> => {
  const {
    type,
    holdingId,
    deposit,
    bond,
    property,
    metal,
    name,
    color,
    currency,
    openingBalance,
    metadata,
    isSynced,
    editingHolding,
    loanFields,
    book,
    icon,
  } = params;

  const hookFields: HoldingTypeForm | null = match(type)
    .with('term_deposit', () => deposit)
    .with('bond', () => bond)
    .with('property_item', () => property)
    .with('metal', () => metal)
    .otherwise(() => null);

  if (hookFields !== null) {
    return saveHookEdit({
      holdingId,
      fields: hookFields,
      name,
      color,
      currency,
      isSynced,
      editingHolding,
      book,
      icon,
    });
  }

  return saveEdit({
    holdingId,
    patch: buildHoldingPatch({ name, color, type, currency, openingBalance, metadata, isSynced }),
    editingHolding,
    loanFields,
    type,
    currency,
    book,
    icon,
  });
};

// The type-specific CREATE payload: `property_item` and `metal` (T20) each
// seed their own first lot (`buildPropertyCreatePayload`/
// `buildMetalCreatePayload` above) instead of a plain opening balance +
// generic metadata; `loan` (T28) seeds its `LoanMeta` (and, for a `'none'`
// schedule, its first manual correction point) the same way. Grouped here —
// rather than a nested ternary in `save`'s create call, which the project's
// `noNestedTernary` lint rule forbids — so `save` keeps a single flat spread.
const createPayloadFor = (params: {
  type: HoldingType;
  currency: Currency;
  openingBalance: string;
  metadata: Record<string, unknown> | undefined;
  loanFields: LoanFieldsSnapshot;
  depositCreatePayload: (openingBalanceMinorUnits: number) => CreatePayload;
  bondCreatePayload: (openingBalanceMinorUnits: number) => CreatePayload;
  propertyCreatePayload: (openingBalanceMinorUnits: number) => CreatePayload;
  metalCreatePayload: (openingBalanceMinorUnits: number) => CreatePayload;
}): CreatePayload => {
  const { type } = params;

  // Keeps today's hidden-balance quirk (reported, not fixed, per R3 Phase
  // C's Risks table): a deposit's/bond's opening-balance field is hidden by
  // `isLedgerlessHoldingType`, but any value typed under another type before
  // switching still parses through here.
  if (type === 'term_deposit') {
    return params.depositCreatePayload(
      Money.fromMajor(params.currency, parseAmount(params.openingBalance) || 0).minorUnits,
    );
  }

  if (type === 'bond') {
    return params.bondCreatePayload(
      Money.fromMajor(params.currency, parseAmount(params.openingBalance) || 0).minorUnits,
    );
  }

  if (type === 'property_item') {
    // Unlike deposit/bond, a property's create payload never reads
    // `openingBalance` at all — its own `cost` field (hidden alongside it by
    // `isLedgerlessHoldingType`) is what the hook's `createPayload` actually
    // uses, so this passes 0 rather than parsing a field property ignores.
    return params.propertyCreatePayload(0);
  }

  if (type === 'metal') {
    // Like property, a metal's create payload never reads `openingBalance`
    // at all — its own quantity/cost fields are what the hook's
    // `createPayload` actually uses, so this passes 0 rather than parsing a
    // field metal ignores.
    return params.metalCreatePayload(0);
  }

  if (type === 'loan') {
    return buildLoanCreatePayload(params.loanFields, params.currency);
  }

  return {
    balanceMinorUnits: Money.fromMajor(params.currency, parseAmount(params.openingBalance) || 0)
      .minorUnits,
    metadata: params.metadata,
  };
};

// The name-required reason, shown only after a failed Save press: gated on
// `attemptedSave` so it renders nothing before the first press. The
// type-specific per-field reasons (term deposit / bond) no longer flow
// through this helper — each field now calls its own reason function
// directly, since each field needs its OWN reason, not the type's single
// first-failing one. Kept as a module-level helper (rather than inline in
// the component) to mirror the pattern the rest of this file already uses
// for save-time branching.
const saveReasonsFor = (params: {
  attemptedSave: boolean;
  name: string;
}): { showNameReason: boolean } => {
  const { attemptedSave, name } = params;

  return { showNameReason: attemptedSave && name.trim().length === 0 };
};

// The wrapper refs `firstInvalidFieldRef` (below) picks a scroll target from —
// grouped into its own type so that function's own signature reads as one
// param per concern (the reasons, then the refs) rather than eight positional
// refs.
type ValidatedFieldRefs = {
  nameFieldRef: RefObject<FieldInstance | null>;
  annualRateFieldRef: RefObject<FieldInstance | null>;
  termMonthsFieldRef: RefObject<FieldInstance | null>;
  loanPrincipalFieldRef: RefObject<FieldInstance | null>;
  loanStartDateFieldRef: RefObject<FieldInstance | null>;
};

// A blocked Save's FOCUS action for each TEXT-backed validated field — called
// once `scrollToField` has positioned it on screen (see `save`'s own
// `onSettled` callback below). The contributions group and the maturity date
// have no matching entry: both are composite/picker targets with no single
// input to focus (a date picker has no keyboard of its own), so `save`'s
// scroll for those two lands the field on screen with no focus follow-up.
type ValidatedFieldFocus = {
  name: () => void;
  annualRate: () => void;
  termMonths: () => void;
  loanPrincipal: () => void;
};

// The first still-invalid field's own wrapper ref (plus its FOCUS action,
// when it has one — see `ValidatedFieldFocus` above), in the SAME priority
// order `deposit.scrollTargets`/`bond.scrollTargets` already check their
// fields in: the name field first (it always applies, independent of type),
// then the active type's fields. `save`'s `!isValid` branch passes this
// straight to `scrollTo`. Module-level and pure (given the already-computed
// reason keys) so this branching stays out of `save`'s own
// cognitive-complexity budget.
const firstInvalidFieldRef = (params: {
  name: string;
  type: HoldingType;
  depositScrollTargets: readonly ScrollTarget[];
  bondScrollTargets: readonly ScrollTarget[];
  propertyScrollTargets: readonly ScrollTarget[];
  metalScrollTargets: readonly ScrollTarget[];
  loanReasonKey: LoanReasonKey | null;
  refs: ValidatedFieldRefs;
  focus: ValidatedFieldFocus;
}): { ref: RefObject<FieldInstance | null>; focus?: () => void } | null => {
  const {
    name,
    type,
    depositScrollTargets,
    bondScrollTargets,
    propertyScrollTargets,
    metalScrollTargets,
    loanReasonKey,
    refs,
    focus,
  } = params;

  const order: { invalid: boolean; ref: RefObject<FieldInstance | null>; focus?: () => void }[] = [
    { invalid: name.trim().length === 0, ref: refs.nameFieldRef, focus: focus.name },
    ...(type === 'term_deposit' ? depositScrollTargets : []),
    ...(type === 'bond' ? bondScrollTargets : []),
    ...(type === 'property_item' ? propertyScrollTargets : []),
    ...(type === 'metal' ? metalScrollTargets : []),
    ...(type === 'loan'
      ? [
          {
            invalid: loanReasonKey === 'forms.holding.loanPrincipalError',
            ref: refs.loanPrincipalFieldRef,
            focus: focus.loanPrincipal,
          },
          {
            invalid: loanReasonKey === 'forms.holding.loanStartDateError',
            ref: refs.loanStartDateFieldRef,
          },
          {
            invalid: loanReasonKey === 'forms.holding.annualRateError',
            ref: refs.annualRateFieldRef,
            focus: focus.annualRate,
          },
          {
            invalid: loanReasonKey === 'forms.holding.termMonthsError',
            ref: refs.termMonthsFieldRef,
            focus: focus.termMonths,
          },
        ]
      : []),
  ];

  const entry = order.find((candidate) => candidate.invalid);

  return foldMap(maybe(entry), (found) => ({ ref: found.ref, focus: found.focus })) ?? null;
};

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
  // account (T17's allow-list; undefined for a `metals`-kind account, which
  // never gates on it). The create form offers only these; edit mode keeps
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

  // Reactive `PriceBook` (T28 review round 1, I1): a loan edit that changes
  // its schedule INTO `'none'` needs the OLD schedule's outstanding, which
  // may itself be anchored on an existing manual correction — see
  // `buildLoanPricePointOp`.
  const priceBook = usePriceBook();

  const [name, setName] = useState('');
  // The selected type starts at `card`, then the effect below snaps it to the
  // first CREATABLE type for the account's kind once it loads — so a bank create
  // (where card/jar are sync-only and excluded) defaults to `term_deposit`, and
  // an edit seeds the real type from the row.
  const [type, setType] = useState<HoldingType>('card');
  const [currency, setCurrency] = useState<Currency>('UAH');
  // DEVICE BUG fix (root cause): while the currency sheet's search field can
  // be focused, this screen's background ScrollView must NOT react to the
  // keyboard's frame change — it does not contain that responder, but
  // `automaticallyAdjustKeyboardInsets` reacts to any focus regardless
  // (see `screen.component.tsx`, `CurrencyField`'s `onOpenChange`).
  const [isCurrencySheetOpen, setIsCurrencySheetOpen] = useState(false);
  const [openingBalance, setOpeningBalance] = useState('');
  // The icon is null until the user picks one ("not dirty"): while null, the
  // chip shows the selected type's default glyph (holdingTypeSymbol[type]) and
  // switching type re-derives it, so an untouched icon follows the type. Once
  // the user picks (icon !== null, "dirty"), that choice overrides the default
  // and type changes no longer move it.
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
  // Shared with the Loan form's own annual-rate/term-months fields (the
  // deposit hook owns its own separate pair) — only one of the two types
  // renders at a time, so the same wrapper ref/input ref safely serves
  // whichever one is mounted.
  const annualRateFieldRef = useRef<FieldInstance>(null);
  const termMonthsFieldRef = useRef<FieldInstance>(null);
  const loanPrincipalFieldRef = useRef<FieldInstance>(null);
  const loanStartDateFieldRef = useRef<FieldInstance>(null);
  // The TEXT-backed validated fields' own inner TextInput/name-input, so a
  // blocked Save can focus the first-invalid one imperatively once it has
  // scrolled into view — mirrors `TextField`'s own `inputRef` /
  // `HoldingIdentityField`'s own `nameInputRef`. The contributions group and
  // the maturity date are composite/picker targets with no single input to
  // focus (a picker/date has no keyboard of its own), so they have no
  // matching entry here — `save`'s scroll below simply omits the focus
  // callback for those two.
  const nameInputRef = useRef<TextInputInstance>(null);
  const annualRateInputRef = useRef<TextInputInstance>(null);
  const termMonthsInputRef = useRef<TextInputInstance>(null);
  const loanPrincipalInputRef = useRef<TextInputInstance>(null);

  // term_deposit state + validation + create/edit payloads (R3 Phase C's
  // worked example) — every field, the per-field reasons, the edit-mode
  // seed, and the create/edit payload builders live in the hook, the same
  // way `useLoanFields` extracted the Loan form's own state.
  const deposit = useTermDepositFields({ currency, scrollTo });

  // bond state + validation + create/edit payloads (R3 Phase C) — every
  // field, the ISIN/Manual mode, the per-field reasons, the edit-mode seed,
  // and the create/edit payload builders live in the hook, the same way
  // `useTermDepositFields` extracted the deposit form's own state.
  const bond = useBondFields({ type, isEdit, currency, setCurrency, setName });

  // property_item state + validation + create/edit payload (R3 Phase C) —
  // the category/cost state, the ORIGINAL (hydrated) lots carried unchanged
  // through an edit, the per-field reason, the edit-mode seed, and the
  // create/edit payload builders live in the hook, the same way
  // `useBondFields` extracted the bond form's own state.
  const property = usePropertyFields({ isEdit, currency });

  // metal state + validation + create/edit payload (R3 Phase C) — the
  // element/form/unit/purity/first-lot state, the ORIGINAL (hydrated) lots
  // carried unchanged through an edit, the per-field reason, the edit-mode
  // seed, and the create/edit payload builders live in the hook, the same
  // way `usePropertyFields` extracted the property form's own state.
  const metal = useMetalFields({ isEdit });

  // loan state (T28). Unlike property/metal, every field here is editable in
  // BOTH create and edit mode (mirrors term_deposit/bond) — see
  // `useLoanFields`'s own doc comment for why this hook owns the full state
  // + per-schedule validation rather than a bag of module-level helpers.
  const loanFields = useLoanFields();

  // A `metal` holding's value is hard-fixed to UAH regardless of currency
  // (NBU quotes precious metals only in UAH — kiko-pricing), so the currency
  // field is hidden for it (below) and this effect forces the state back to
  // UAH whenever the type is (or becomes) `metal` — covering a user who
  // picked a different currency before switching the type chip to Precious
  // metal.
  useEffect(() => {
    if (type === 'metal' && currency !== 'UAH') {
      setCurrency('UAH');
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

    match(holding)
      .with({ type: 'term_deposit' }, (termDepositHolding) => {
        deposit.seed(termDepositHolding);
      })
      .with({ type: 'bond' }, (bondHolding) => {
        bond.seed(bondHolding);
      })
      .with({ type: 'property_item' }, (propertyHolding) => {
        property.seed(propertyHolding);
      })
      .with({ type: 'metal' }, (metalHolding) => {
        metal.seed(metalHolding);
      })
      .with({ type: 'loan' }, (loanHolding) => {
        loanFields.seed(loanHolding);
      })
      // Not `.exhaustive()`: the original if-chain's trailing, unconditional
      // statement tolerated any unmatched `type`, not only the other 4
      // literal types — a malformed or absent `type` falls back to reading
      // the plain balance instead of throwing.
      .otherwise((rest) => {
        setOpeningBalance(groupAmount(majorAmountText(rest.currency, rest.balanceMinorUnits)));
      });
  }, [isEdit, editingHolding, loanFields.seed, deposit.seed, bond.seed, property.seed, metal.seed]);

  // The stack sets the static "Add Holding" title; in edit mode override it with
  // "Edit Holding" so the header reads correctly for the update flow.
  useLayoutEffect(() => {
    if (isEdit) {
      navigation.setOptions({ title: t('forms.holding.editTitle') });
    }
  }, [isEdit, navigation, t]);

  const buildMetadata = (): Record<string, unknown> | undefined => {
    // A loan's CREATE metadata is built separately (see `save`'s create
    // branch, `buildLoanCreatePayload`) — a `'none'` schedule additionally
    // writes a `firstPricePoint` there. This branch covers EDIT mode only:
    // unlike property/metal, every field stays user-editable after
    // creation (T28) — there is no fixed-at-creation "first lot" a loan's
    // principal/dates/schedule are frozen against.
    if (type === 'loan' && isEdit) {
      return buildLoanMeta(loanFields, currency);
    }
    return undefined;
  };

  const isValid =
    name.trim().length > 0 &&
    match(type)
      .with('term_deposit', () => deposit.isValid)
      .with('bond', () => bond.isValid)
      .with('property_item', () => property.isValid)
      .with('metal', () => metal.isValid)
      .with('loan', () => loanFields.isValid)
      .with('card', 'cash', 'crypto_asset', 'jar', () => true)
      .exhaustive();

  const [attemptedSave, setAttemptedSave] = useState(false);

  const { showNameReason } = saveReasonsFor({ attemptedSave, name });

  const save = async (): Promise<void> => {
    if (!isValid) {
      setAttemptedSave(true);

      const target = firstInvalidFieldRef({
        name,
        type,
        depositScrollTargets: deposit.scrollTargets,
        bondScrollTargets: bond.scrollTargets,
        propertyScrollTargets: property.scrollTargets,
        metalScrollTargets: metal.scrollTargets,
        loanReasonKey: loanFields.reasonKey,
        refs: {
          nameFieldRef,
          annualRateFieldRef,
          termMonthsFieldRef,
          loanPrincipalFieldRef,
          loanStartDateFieldRef,
        },
        focus: {
          name: () => nameInputRef.current?.focus(),
          annualRate: () => annualRateInputRef.current?.focus(),
          termMonths: () => termMonthsInputRef.current?.focus(),
          loanPrincipal: () => loanPrincipalInputRef.current?.focus(),
        },
      });

      if (target) {
        scrollTo(target.ref, target.focus);
      }

      return;
    }

    const metadata = buildMetadata();

    try {
      if (isEdit && holdingId !== undefined) {
        // The term-deposit/every-other-type dispatch, plus the whole write
        // itself, lives in `performEditSave` (extracted purely to keep THIS
        // function's own branch count under the cognitive-complexity
        // budget). Type/currency are read-only.
        await performEditSave({
          type,
          holdingId,
          deposit,
          bond,
          property,
          metal,
          name,
          color,
          currency,
          openingBalance,
          metadata,
          isSynced: isSyncedEdit,
          editingHolding,
          loanFields,
          book: priceBook,
          icon,
        });

        navigation.goBack();

        return;
      }

      // A property's or a metal's create payload is built separately
      // (`createPayloadFor`, delegating to `buildPropertyCreatePayload` /
      // `buildMetalCreatePayload`): a zero stored balance and one lot each —
      // property additionally writes a first manual price point equal to the
      // entered cost, in the SAME transaction (`holdingsRepo.create`'s
      // `firstPricePoint` param); metal writes none (kiko-pricing: its price
      // comes from the SHARED metal instrument, never a per-holding one).
      // Every other type writes its entered opening balance and the metadata
      // `buildMetadata` built above.
      const newHoldingId = await holdingsRepo.create({
        accountId,
        name,
        type,
        currency,
        // Persist the color only when the user picked one (dirty). Left null, the
        // row follows its type's default at display time — the same fallback the
        // icon uses — so a type-default color is not frozen onto the row.
        color,
        ...createPayloadFor({
          type,
          currency,
          openingBalance,
          metadata,
          loanFields,
          depositCreatePayload: deposit.createPayload,
          bondCreatePayload: bond.createPayload,
          propertyCreatePayload: property.createPayload,
          metalCreatePayload: metal.createPayload,
        }),
      });

      // Persist the chosen icon on the freshly-created row, using the id the
      // create resolved to. Awaited so it commits before navigating away.
      if (icon !== null) {
        await holdingsRepo.setIcon(newHoldingId, icon);
      }

      // Item 2 (F3, BUG) + C1 (F3 part 1 fix round 1, Critical): a `returnTo`
      // route param (set only by the "Create new holding" entry points on
      // StatementImport/ColumnMapping) carries that screen's own full params
      // plus a `screen` discriminant — this create was launched from THAT
      // screen's own target-holding picker, so pop back to it with
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
      // `src/navigation/statement-import-return.navigator.test.tsx` for the
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
      Alert.alert(t('forms.fields.saveErrorTitle'), t('forms.fields.saveErrorMessage'));
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
        <Button onPress={onSave} disabled={isSubmitting}>
          {t('common.save')}
        </Button>
      }
    >
      <Box gap={4} testID="holding-form">
        <View ref={nameFieldRef}>
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
            names (e.g. "Строковий депозит") run too wide for a chip row,
            the same label-width reasoning that moved PropertySection's
            category and LoanSection's kind onto `SelectField`. */}
        <HoldingTypeField
          options={typeOptions}
          selected={type}
          onSelect={setType}
          labels={typeLabels}
          icons={holdingTypeSymbol}
          disabled={isEdit}
          testID="holding-type-field"
        />

        {/* A metal holding's value is hard-fixed to UAH (NBU quotes precious
            metals only in UAH — kiko-pricing), so it offers no currency
            picker at all — the state effect above keeps `currency` at 'UAH'
            underneath regardless of what this field would otherwise show. */}
        {type !== 'metal' && (
          <CurrencyField
            label={t('forms.fields.currency')}
            selected={currency}
            onSelect={setCurrency}
            disabled={isEdit}
            onOpenChange={setIsCurrencySheetOpen}
            testID="holding-currency-field"
          />
        )}

        {!isLedgerlessHoldingType(type) && !isSyncedEdit && (
          <TextField
            label={t('forms.holding.balance')}
            value={openingBalance}
            onChangeText={(text) => setOpeningBalance(groupAmount(text))}
            keyboardType="decimal-pad"
            placeholder={t('forms.holding.balancePlaceholder')}
            suffix={currencySymbol[currency]}
          />
        )}

        {type === 'term_deposit' && (
          <TermDepositFormBlock fields={deposit} attemptedSave={attemptedSave} />
        )}

        {type === 'bond' && <BondFormBlock fields={bond} attemptedSave={attemptedSave} />}

        {type === 'property_item' && (
          <PropertyFormBlock fields={property} attemptedSave={attemptedSave} isEdit={isEdit} />
        )}

        {type === 'metal' && (
          <MetalFormBlock fields={metal} attemptedSave={attemptedSave} isEdit={isEdit} />
        )}

        <LoanFormBlock
          type={type}
          t={t}
          attemptedSave={attemptedSave}
          currency={currency}
          loanFields={loanFields}
          loanPrincipalFieldRef={loanPrincipalFieldRef}
          loanPrincipalInputRef={loanPrincipalInputRef}
          loanStartDateFieldRef={loanStartDateFieldRef}
          annualRateFieldRef={annualRateFieldRef}
          annualRateInputRef={annualRateInputRef}
          termMonthsFieldRef={termMonthsFieldRef}
          termMonthsInputRef={termMonthsInputRef}
        />
      </Box>
    </Screen>
  );
};

export default HoldingFormScreen;
