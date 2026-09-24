import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import { Alert, View } from 'react-native';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { holdingsRepo, type LoanPricePointOp } from '@kiko/holdings/repo';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import type { ScrollViewInstance, TextInputInstance } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';

import DateField from '../date-field';
import {
  creatableHoldingTypesForAccount,
  type HoldingType,
  holdingTypes,
  isLedgerlessHoldingType,
  holdingTypesForAccountKind,
} from '../../../holdings/holding-type';
import ColorPicker from '../color-picker';
import {
  asBondMeta,
  asLoanMeta,
  asMetalMeta,
  asPropertyMeta,
  asTermDepositMeta,
  type BondKind,
  type BondMeta,
  type BondCouponFrequency,
  type LoanMeta,
  type Metal,
  type MetalForm,
  type MetalUnit,
  type PropertyCategory,
  type CompoundingFrequency,
  type TermDepositMeta,
} from '../../../holdings/holding-metadata';
import {
  useHeaderInset,
  scrollToField,
  type FieldInstance,
} from '../scroll-to-field/scroll-to-field';
import { Money } from '../../../currency/money';
import type { Lot } from '../../../holdings/lots';
import HoldingTypeField from '../holding-type-field';
import type { HoldingRow } from '../../../db/schema';
import { parseAmount } from '../../../currency/parse';
import Box from '../../../design-system/components/box';
import { useLiveQuery } from '../../../db/use-live-query';
import Text from '../../../design-system/components/text';
import HoldingIdentityField from '../holding-identity-field';
import Button from '../../../design-system/components/button';
import Screen from '../../../design-system/components/screen';
import Switch from '../../../design-system/components/switch';
import { usePriceBook } from '../../../prices/use-price-book';
import Divider from '../../../design-system/components/divider';
import ChipRow from '../../../design-system/components/chip-row';
import { useSubmitOnce } from '../use-submit-once/use-submit-once';
import TextField from '../../../design-system/components/text-field';
import { holdingTypeSymbol } from '../../../holdings/entity-symbols';
import { dayKeyOf, type PriceBook } from '../../../prices/price-book';
import { defaultHoldingColor } from '../../../holdings/entity-colors';
import FieldError from '../../../design-system/components/field-error';
import { resolveEntityColor } from '../../../design-system/entity-tint';
import type { AccountsStackParamList } from '../../../navigation/types';
import { loanOutstandingMinorAt } from '../../../holdings/loan-schedule';
import CurrencyField from '../../../design-system/components/currency-field';
import { groupAmount, majorAmountText } from '../amount-format/amount-format';
import { isSyncedAccount, isSyncedHolding } from '../../../holdings/deletable';
import { type Currency, currencyScale, currencySymbol } from '../../../currency/currency';
import { compareDecimal, normalizeDecimal, shiftDecimal } from '../../../currency/decimal';
import { KIKO_ENTITIES_ICONS } from '../../../design-system/components/icon-picker-modal/icon-pools';

import LoanSection from './loan-section';
import MetalSection from './metal-section';
import PropertySection from './property-section';
import BondIsinSection from './bond-isin-section';
import ManualBondFields from './manual-bond-fields';
import { useBondIsinMode, type IsinReasonKey } from './use-bond-isin-mode';
import type { BondEntryMode } from './bond-isin-section/bond-isin-section.props';
import { useLoanFields, type LoanReasonKey, type UseLoanFieldsResult } from './use-loan-fields';

type HoldingFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'HoldingForm'>;

// The literal i18n keys `termDepositReasonKey` may return, so `t()` (typed
// from src/i18n/locales/en.ts) accepts them.
type TermDepositReasonKey =
  | 'forms.holding.contributionsRequiredError'
  | 'forms.holding.contributionIncompleteError'
  | 'forms.holding.annualRateError'
  | 'forms.holding.termMonthsError';

// The literal i18n keys `bondReasonKey` may return, so `t()` (typed from
// src/i18n/locales/en.ts) accepts them.
type BondReasonKey =
  | 'forms.holding.quantityError'
  | 'forms.holding.faceValueError'
  | 'forms.holding.couponPctError'
  | 'forms.holding.purchaseDateRequiredError'
  | 'forms.holding.maturityDateRequiredError'
  | 'forms.holding.maturityDateError';

// The literal i18n key `propertyReasonKey` may return, so `t()` (typed from
// src/i18n/locales/en.ts) accepts it.
type PropertyReasonKey = 'forms.holding.propertyCostError';

// The literal i18n keys `metalReasonKey` may return — reusing the SAME
// generic quantity error the bond form already carries, and the Lot form's
// own total-cost error, rather than minting a metal-specific duplicate of
// either message. `purityError` is metal-specific: no other form field
// validates a 0-1 fineness ratio.
type MetalReasonKey =
  | 'forms.holding.quantityError'
  | 'forms.lot.totalCostError'
  | 'forms.holding.purityError';

// `saved` marks a contribution that is already persisted in the holding's
// stored metadata (an edit-mode hydrated row) versus one the user just added in
// this session. Only unsaved rows may be removed — a persisted contribution is
// part of the deposit's history, so its Remove control renders disabled. The
// flag is explicit rather than inferred from id ordering: an explicit boolean is
// clearer and does not break if the seeding/id scheme ever changes.
type Contribution = { id: number; amount: string; date: number | null; saved: boolean };

// Seed the repeatable contributions list from a stored deposit: each stored
// amount is minor units, shown back in the field as a grouped major string the
// user can edit (the inverse of the create form's parse-on-save). Every seeded
// row is `saved: true` — it already exists in the database, so it cannot be
// removed here.
const seedContributions = (meta: TermDepositMeta, currency: Currency): Contribution[] =>
  meta.contributions.map((contribution, index) => ({
    id: index,
    amount: groupAmount(majorAmountText(currency, contribution.amountMinorUnits)),
    date: contribution.date,
    saved: true,
  }));

// Seeds term_deposit's edit-mode fields from stored metadata. A no-op for
// invalid/absent metadata. Extracted out of the seed effect below (the same
// cognitive-complexity reason `seedPropertyFields`/`seedMetalFields` further
// down are their own functions rather than an inline `if (meta) {...}`).
const seedTermDepositFields = (
  holding: HoldingRow,
  setters: {
    setContributions: (rows: Contribution[]) => void;
    setNextContributionId: (id: number) => void;
    setAnnualRate: (value: string) => void;
    setTermMonths: (value: string) => void;
    setRecap: (value: boolean) => void;
    setCompounding: (value: CompoundingFrequency) => void;
  },
): void => {
  const meta = asTermDepositMeta(holding.metadata);

  if (meta === null) {
    return;
  }

  const rows = seedContributions(meta, holding.currency);
  setters.setContributions(rows);
  setters.setNextContributionId(rows.length);
  setters.setAnnualRate(String(meta.annualRatePct));
  setters.setTermMonths(String(meta.termMonths));
  setters.setRecap(meta.recapitalization);
  setters.setCompounding(meta.compounding);
};

// Seed the bond number/date fields from stored metadata. Minor-unit money
// fields (face value, purchase price) convert back to grouped major strings;
// plain-number fields (quantity, coupon %) render verbatim.
const seedBondFields = (meta: BondMeta, currency: Currency) => ({
  quantity: groupAmount(String(meta.quantity)),
  faceValue: groupAmount(majorAmountText(currency, meta.faceValueMinorUnits)),
  couponPct: String(meta.couponPct),
  purchasePrice: groupAmount(majorAmountText(currency, meta.purchasePriceMinorUnits)),
  purchaseDate: meta.purchaseDate,
  maturityDate: meta.maturityDate,
  bondKind: meta.bondKind,
  couponFrequency: meta.couponFrequency,
  // Edit mode always opens Manual (spec 6.4 #6), with the stored ISIN (or ''
  // for a bond saved before T25) shown and still editable.
  isin: meta.isin ?? '',
});

// Seeds bond's edit-mode fields from stored metadata, the same extraction
// reason as `seedTermDepositFields` above.
const seedBondMetaFields = (
  holding: HoldingRow,
  setters: {
    setQuantity: (value: string) => void;
    setFaceValue: (value: string) => void;
    setCouponPct: (value: string) => void;
    setPurchasePrice: (value: string) => void;
    setPurchaseDate: (value: number) => void;
    setMaturityDate: (value: number) => void;
    setBondKind: (value: BondKind) => void;
    setCouponFrequency: (value: BondMeta['couponFrequency']) => void;
    setIsin: (value: string) => void;
    setBondMode: (value: BondEntryMode) => void;
  },
): void => {
  const meta = asBondMeta(holding.metadata);

  if (meta === null) {
    return;
  }

  const fields = seedBondFields(meta, holding.currency);
  setters.setQuantity(fields.quantity);
  setters.setFaceValue(fields.faceValue);
  setters.setCouponPct(fields.couponPct);
  setters.setPurchasePrice(fields.purchasePrice);
  setters.setPurchaseDate(fields.purchaseDate);
  setters.setMaturityDate(fields.maturityDate);
  setters.setBondKind(fields.bondKind);
  setters.setCouponFrequency(fields.couponFrequency);
  setters.setIsin(fields.isin);
  // Edit always opens Manual (spec 6.4 #6) — the register is never consulted
  // again once a holding is saved (spec 6.4 #5).
  setters.setBondMode('manual');
};

// Seeds property_item's two edit-mode fields (category + the ORIGINAL lots,
// carried through unchanged on save — cost/quantity history is fixed at
// creation, PropertySection hides its Cost field in edit mode) from stored
// metadata. A no-op for invalid/absent metadata. Extracted out of the seed
// effect below (rather than an inline `if (meta) {...}`, the shape
// `seedContributions`/`seedBondFields` themselves don't need since THEY are
// pure builders, not setters) so that effect's own branching stays under the
// cognitive-complexity budget.
const seedPropertyFields = (
  holding: HoldingRow,
  setters: {
    setPropertyCategory: (category: PropertyCategory) => void;
    setPropertyLots: (lots: Lot[]) => void;
  },
): void => {
  const meta = asPropertyMeta(holding.metadata);

  if (meta === null) {
    return;
  }

  setters.setPropertyCategory(meta.category);
  setters.setPropertyLots(meta.lots);
};

// Seeds metal's edit-mode fields (metal/form/unit/purity + the ORIGINAL lots,
// carried through unchanged on save — quantity/cost history is fixed at
// creation, MetalSection hides its first-lot fields in edit mode; a later
// buy/sell goes through the dedicated Lot form instead) from stored metadata.
// A no-op for invalid/absent metadata, mirroring `seedPropertyFields` above.
const seedMetalFields = (
  holding: HoldingRow,
  setters: {
    setMetalMetal: (metal: Metal) => void;
    setMetalForm: (form: MetalForm) => void;
    setMetalUnit: (unit: MetalUnit) => void;
    setMetalPurity: (purity: string) => void;
    setMetalLots: (lots: Lot[]) => void;
  },
): void => {
  const meta = asMetalMeta(holding.metadata);

  if (meta === null) {
    return;
  }

  setters.setMetalMetal(meta.metal);
  setters.setMetalForm(meta.form);
  setters.setMetalUnit(meta.unit);
  setters.setMetalPurity(meta.purity);
  setters.setMetalLots(meta.lots);
};

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

// The property CREATE payload (T16): a `property_item` writes a zero stored
// balance (its value lives entirely in `metadata.lots` / `price_points` —
// kiko-domain), one lot dated today for a quantity of "1" at the entered
// cost, and a first `manual` price point equal to that same cost, so the
// holding never reads as "no price yet" before the user records a real
// revaluation. The lot's day and the price point's day share the SAME
// `dayKeyOf` normalization `PriceBook` itself reads price points by, and the
// point's `price` is derived from the SAME minor-units cost the lot carries
// (never re-parsed from the raw text field), so the two can never disagree.
const buildPropertyCreatePayload = (params: {
  category: PropertyCategory;
  currency: Currency;
  cost: string;
}): {
  balanceMinorUnits: number;
  metadata: Record<string, unknown>;
  firstPricePoint: { day: number; price: string };
} => {
  const { category, currency, cost } = params;
  const costMinorUnits = Money.fromMajor(currency, parseAmount(cost) || 0).minorUnits;
  const day = dayKeyOf(Date.now());
  const lot: Lot = { day, quantityDelta: '1', costMinorUnits };

  return {
    balanceMinorUnits: 0,
    metadata: { category, lots: [lot] },
    firstPricePoint: {
      day,
      price: shiftDecimal(String(costMinorUnits), -currencyScale[currency]),
    },
  };
};

// The pre-filled purity — the standard bar/coin fineness — shown before
// the user types anything of their own.
const DEFAULT_METAL_PURITY = '0.9999';

// Both metal-metadata builders below only ever run once `metalPurityReasonKey`
// has already confirmed `normalizeDecimal(value)` parses — a `null` result
// here can only mean that validation gate itself has a bug, never a value
// the user actually typed, so this throws instead of silently substituting
// `DEFAULT_METAL_PURITY` for whatever the user entered.
const normalizedPurityOrThrow = (purity: string): string => {
  const normalized = normalizeDecimal(purity);

  if (normalized === null) {
    throw new Error('Metal purity failed to parse after passing Save validation');
  }

  return normalized;
};

// The metal CREATE payload (T20): a `metal` holding writes a zero stored
// balance (its value lives entirely in `metadata.lots` / the SHARED
// `metal:<XAU|XAG|XPT|XPD>` price series — kiko-pricing) and one lot dated
// today for the entered quantity/cost. Unlike `buildPropertyCreatePayload`,
// no `firstPricePoint` is written: a metal's price comes from the metal-wide
// instrument (backfilled by `refreshMetalPrices`), never a per-holding one —
// see `asMetalMeta`'s own contract for why `quantityDelta`/`purity` are kept
// as the exact decimal STRINGS the user typed (`normalizeDecimal`), never
// round-tripped through a parsed `number`.
const buildMetalCreatePayload = (params: {
  metal: Metal;
  form: MetalForm;
  unit: MetalUnit;
  purity: string;
  quantity: string;
  cost: string;
}): { balanceMinorUnits: number; metadata: Record<string, unknown> } => {
  const { metal, form, unit, purity, quantity, cost } = params;
  const day = dayKeyOf(Date.now());
  const lot: Lot = {
    day,
    quantityDelta: normalizeDecimal(quantity) ?? '0',
    costMinorUnits: Money.fromMajor('UAH', parseAmount(cost) || 0).minorUnits,
  };

  return {
    balanceMinorUnits: 0,
    metadata: {
      metal,
      form,
      unit,
      purity: normalizedPurityOrThrow(purity),
      lots: [lot],
    },
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
  propertyCategory: PropertyCategory;
  propertyCost: string;
  metal: Metal;
  metalForm: MetalForm;
  metalUnit: MetalUnit;
  metalPurity: string;
  metalQuantity: string;
  metalCost: string;
  loanFields: LoanFieldsSnapshot;
}): {
  balanceMinorUnits: number;
  metadata: Record<string, unknown> | undefined;
  firstPricePoint?: { day: number; price: string };
} => {
  const { type } = params;

  if (type === 'property_item') {
    return buildPropertyCreatePayload({
      category: params.propertyCategory,
      currency: params.currency,
      cost: params.propertyCost,
    });
  }

  if (type === 'metal') {
    return buildMetalCreatePayload({
      metal: params.metal,
      form: params.metalForm,
      unit: params.metalUnit,
      purity: params.metalPurity,
      quantity: params.metalQuantity,
      cost: params.metalCost,
    });
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

const compoundingOptions: readonly CompoundingFrequency[] = [
  'bi-weekly',
  'monthly',
  'quarterly',
  'annually',
];

// The name-required reason, shown only after a failed Save press: gated on
// `attemptedSave` so it renders nothing before the first press. The
// type-specific per-field reasons (term deposit / bond) no longer flow
// through this helper — each field now calls `termDepositReasonKey()` /
// `bondReasonKey()` directly (see `fieldErrorMessage` below), since each field
// needs its OWN reason, not the type's single first-failing one. Kept as a
// module-level helper (rather than inline in the component) to mirror the
// pattern the rest of this file already uses for save-time branching.
const saveReasonsFor = (params: {
  attemptedSave: boolean;
  name: string;
}): { showNameReason: boolean } => {
  const { attemptedSave, name } = params;

  return { showNameReason: attemptedSave && name.trim().length === 0 };
};

// The active error message for a field's OWN independent reason (each of
// `contributionsFieldReasonKey`/`annualRateFieldReasonKey`/`bondQuantityFieldReasonKey`
// and their siblings below), or `undefined` while that field's own check
// still passes (or before the first failed Save press). Every field computes
// its reason from ONLY its own inputs, so fixing one field never changes
// what a DIFFERENT field renders — the shared `TermDepositReasonKey`/
// `BondReasonKey`/etc. chains stay in use only for `firstInvalidFieldRef`'s
// scroll target and each type's own `isValid` gate. Kept module-level and
// pure so its branch stays out of HoldingFormScreen's own
// cognitive-complexity budget (the same reason transaction-form's
// `resolveDescriptionPlaceholder` is a module-level helper).
const fieldErrorMessage = (
  t: TFunction,
  attemptedSave: boolean,
  reasonKey:
    | TermDepositReasonKey
    | BondReasonKey
    | IsinReasonKey
    | PropertyReasonKey
    | MetalReasonKey
    | LoanReasonKey
    | null,
): string | undefined => (attemptedSave ? foldMap(maybe(reasonKey), (key) => t(key)) : undefined);

// The ISIN field's OWN inline error text — every `isinReasonKey` EXCEPT
// `isinNotInRegister`, which `BondIsinSection` already surfaces as its own
// always-visible hint (not gated on Save), so showing it here too would
// duplicate that message.
// The contributions group's two sub-reasons (missing vs incomplete) render as
// TWO separate `<FieldError>`s though both come from the SAME
// `contributionsFieldReasonKey` check — this narrows to the specific
// sub-reason each one owns, so neither shows for the other's cause. Kept
// module-level so this comparison stays out of HoldingFormScreen's own
// cognitive-complexity budget, the same reason `fieldErrorMessage` is.
const contributionsSubReasonMessage = (
  t: TFunction,
  attemptedSave: boolean,
  reasonKey:
    | 'forms.holding.contributionsRequiredError'
    | 'forms.holding.contributionIncompleteError'
    | null,
  expectedKey:
    | 'forms.holding.contributionsRequiredError'
    | 'forms.holding.contributionIncompleteError',
): string | undefined => (attemptedSave && reasonKey === expectedKey ? t(expectedKey) : undefined);

const isinFieldErrorMessage = (
  t: TFunction,
  attemptedSave: boolean,
  reasonKey: IsinReasonKey | null,
): string | undefined =>
  reasonKey === null ||
  reasonKey === 'forms.holding.isinNotInRegister' ||
  reasonKey === 'forms.holding.isinRegisterNotLoaded'
    ? undefined
    : fieldErrorMessage(t, attemptedSave, reasonKey);

// The ISIN-mode-only coupon-frequency picker's OWN blocking error (T25
// review round 2, N2, orchestrator ruling): only once a Save attempt was
// made, only for the one match that left `couponFrequency` unmapped, and
// only until the user picks one. Module-level and pure, the same reason
// `isinFieldErrorMessage` above is, rather than an inline ternary in the
// component's own JSX.
const couponFrequencyErrorMessage = (
  t: TFunction,
  attemptedSave: boolean,
  needsCouponFrequencyPick: boolean,
  pickedCouponFrequency: BondCouponFrequency | null,
): string | undefined =>
  attemptedSave && needsCouponFrequencyPick && pickedCouponFrequency === null
    ? t('forms.holding.couponFrequencyRequiredError')
    : undefined;

// ISIN mode never mounts the maturity DateField (its terms are
// register-sourced) — a matured-still-registered bond's reason (or a
// register terms with no maturity date at all) is shown on the purchase
// date instead (T25 review round 1, I2), the one date the user actually
// controls there. The purchase field's OWN missing-date reason (`ownError`)
// always takes priority over a redirected maturity reason, in both modes.
const purchaseDateErrorMessage = (
  bondMode: BondEntryMode,
  ownError: string | undefined,
  maturityDateErrorMessage: string | undefined,
): string | undefined => ownError ?? (bondMode === 'isin' ? maturityDateErrorMessage : undefined);

// The wrapper refs `firstInvalidFieldRef` (below) picks a scroll target from —
// grouped into its own type so that function's own signature reads as one
// param per concern (the reasons, then the refs) rather than eight positional
// refs.
type ValidatedFieldRefs = {
  nameFieldRef: RefObject<FieldInstance | null>;
  contributionsFieldRef: RefObject<FieldInstance | null>;
  annualRateFieldRef: RefObject<FieldInstance | null>;
  termMonthsFieldRef: RefObject<FieldInstance | null>;
  isinFieldRef: RefObject<FieldInstance | null>;
  quantityFieldRef: RefObject<FieldInstance | null>;
  faceValueFieldRef: RefObject<FieldInstance | null>;
  couponPctFieldRef: RefObject<FieldInstance | null>;
  purchaseDateFieldRef: RefObject<FieldInstance | null>;
  maturityDateFieldRef: RefObject<FieldInstance | null>;
  propertyCostFieldRef: RefObject<FieldInstance | null>;
  metalPurityFieldRef: RefObject<FieldInstance | null>;
  metalQuantityFieldRef: RefObject<FieldInstance | null>;
  metalCostFieldRef: RefObject<FieldInstance | null>;
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
  isin: () => void;
  quantity: () => void;
  faceValue: () => void;
  couponPct: () => void;
  propertyCost: () => void;
  metalPurity: () => void;
  metalQuantity: () => void;
  metalCost: () => void;
  loanPrincipal: () => void;
};

// The first still-invalid field's own wrapper ref (plus its FOCUS action,
// when it has one — see `ValidatedFieldFocus` above), in the SAME priority
// order `termDepositReasonKey`/`bondReasonKey` already check their fields
// in: the name field first (it always applies, independent of type), then
// the active type's fields. `save`'s `!isValid` branch passes this straight
// to `scrollToField`. Module-level and pure (given the already-computed
// reason keys) so this branching stays out of `save`'s own
// cognitive-complexity budget — the same reason `fieldErrorMessage` above is
// a module-level helper.
const firstInvalidFieldRef = (params: {
  name: string;
  type: HoldingType;
  bondMode: BondEntryMode;
  termDepositReasonKey: TermDepositReasonKey | null;
  bondReasonKey: BondReasonKey | null;
  isinReasonKey: IsinReasonKey | null;
  needsCouponFrequencyPick: boolean;
  pickedCouponFrequency: BondCouponFrequency | null;
  propertyReasonKey: PropertyReasonKey | null;
  metalReasonKey: MetalReasonKey | null;
  loanReasonKey: LoanReasonKey | null;
  refs: ValidatedFieldRefs;
  focus: ValidatedFieldFocus;
}): { ref: RefObject<FieldInstance | null>; focus?: () => void } | null => {
  const {
    name,
    type,
    bondMode,
    termDepositReasonKey,
    bondReasonKey,
    isinReasonKey,
    needsCouponFrequencyPick,
    pickedCouponFrequency,
    propertyReasonKey,
    metalReasonKey,
    loanReasonKey,
    refs,
    focus,
  } = params;

  const order: { invalid: boolean; ref: RefObject<FieldInstance | null>; focus?: () => void }[] = [
    { invalid: name.trim().length === 0, ref: refs.nameFieldRef, focus: focus.name },
    ...(type === 'term_deposit'
      ? [
          {
            invalid:
              termDepositReasonKey === 'forms.holding.contributionsRequiredError' ||
              termDepositReasonKey === 'forms.holding.contributionIncompleteError',
            ref: refs.contributionsFieldRef,
          },
          {
            invalid: termDepositReasonKey === 'forms.holding.annualRateError',
            ref: refs.annualRateFieldRef,
            focus: focus.annualRate,
          },
          {
            invalid: termDepositReasonKey === 'forms.holding.termMonthsError',
            ref: refs.termMonthsFieldRef,
            focus: focus.termMonths,
          },
        ]
      : []),
    ...(type === 'bond'
      ? [
          {
            invalid: isinReasonKey !== null,
            ref: refs.isinFieldRef,
            focus: focus.isin,
          },
          {
            // The ISIN-mode-only coupon-frequency picker (N2) renders inside
            // `BondIsinSection`, just below the ISIN field — reusing its ref
            // lands the scroll close enough with no separate wrapper needed.
            invalid: needsCouponFrequencyPick && pickedCouponFrequency === null,
            ref: refs.isinFieldRef,
          },
          {
            invalid: bondReasonKey === 'forms.holding.quantityError',
            ref: refs.quantityFieldRef,
            focus: focus.quantity,
          },
          {
            invalid: bondReasonKey === 'forms.holding.faceValueError',
            ref: refs.faceValueFieldRef,
            focus: focus.faceValue,
          },
          {
            invalid: bondReasonKey === 'forms.holding.couponPctError',
            ref: refs.couponPctFieldRef,
            focus: focus.couponPct,
          },
          {
            invalid: bondReasonKey === 'forms.holding.purchaseDateRequiredError',
            ref: refs.purchaseDateFieldRef,
          },
          {
            // See `purchaseDateErrorMessage`'s own doc comment for why ISIN
            // mode's scroll target is the purchase date, not maturity.
            invalid: bondReasonKey === 'forms.holding.maturityDateRequiredError',
            ref: bondMode === 'isin' ? refs.purchaseDateFieldRef : refs.maturityDateFieldRef,
          },
          {
            invalid: bondReasonKey === 'forms.holding.maturityDateError',
            ref: bondMode === 'isin' ? refs.purchaseDateFieldRef : refs.maturityDateFieldRef,
          },
        ]
      : []),
    ...(type === 'property_item'
      ? [
          {
            invalid: propertyReasonKey === 'forms.holding.propertyCostError',
            ref: refs.propertyCostFieldRef,
            focus: focus.propertyCost,
          },
        ]
      : []),
    ...(type === 'metal'
      ? [
          {
            // Purity renders ABOVE the Quantity/Total cost fields in
            // MetalSection's own JSX, so it takes priority here too.
            invalid: metalReasonKey === 'forms.holding.purityError',
            ref: refs.metalPurityFieldRef,
            focus: focus.metalPurity,
          },
          {
            invalid: metalReasonKey === 'forms.holding.quantityError',
            ref: refs.metalQuantityFieldRef,
            focus: focus.metalQuantity,
          },
          {
            invalid: metalReasonKey === 'forms.lot.totalCostError',
            ref: refs.metalCostFieldRef,
            focus: focus.metalCost,
          },
        ]
      : []),
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

  return entry === undefined ? null : { ref: entry.ref, focus: entry.focus };
};

// The `type === 'loan'` details block as its own leaf component (T28),
// keeping its own cognitive-complexity budget instead of adding another
// branch to the already-at-the-ceiling screen. Renders null outside
// `type === 'loan'`, the same as the `&&` it replaces.
type LoanFormBlockProps = {
  type: HoldingType;
  t: TFunction;
  attemptedSave: boolean;
  currency: Currency;
  loanFields: UseLoanFieldsResult;
  loanPrincipalFieldRef: RefObject<FieldInstance | null>;
  loanPrincipalInputRef: RefObject<TextInputInstance | null>;
  loanStartDateFieldRef: RefObject<FieldInstance | null>;
  annualRateFieldRef: RefObject<FieldInstance | null>;
  annualRateInputRef: RefObject<TextInputInstance | null>;
  termMonthsFieldRef: RefObject<FieldInstance | null>;
  termMonthsInputRef: RefObject<TextInputInstance | null>;
};

const LoanFormBlock: FC<LoanFormBlockProps> = ({
  type,
  t,
  attemptedSave,
  currency,
  loanFields,
  loanPrincipalFieldRef,
  loanPrincipalInputRef,
  loanStartDateFieldRef,
  annualRateFieldRef,
  annualRateInputRef,
  termMonthsFieldRef,
  termMonthsInputRef,
}) => {
  if (type !== 'loan') {
    return null;
  }

  return (
    <Box gap={4}>
      <Divider testID="form-divider" />

      <Text variant="heading">{t('forms.holding.details')}</Text>

      <LoanSection
        kind={loanFields.kind}
        onSelectKind={loanFields.setKind}
        principal={loanFields.principal}
        onChangePrincipal={(text) => loanFields.setPrincipal(groupAmount(text))}
        principalError={fieldErrorMessage(t, attemptedSave, loanFields.fieldErrors.principalError)}
        principalFieldRef={loanPrincipalFieldRef}
        principalInputRef={loanPrincipalInputRef}
        currencySuffix={currencySymbol[currency]}
        startDate={loanFields.startDate}
        onChangeStartDate={loanFields.setStartDate}
        startDateError={fieldErrorMessage(t, attemptedSave, loanFields.fieldErrors.startDateError)}
        startDateFieldRef={loanStartDateFieldRef}
        schedule={loanFields.schedule}
        onSelectSchedule={loanFields.setSchedule}
        annualRatePct={loanFields.annualRatePct}
        onChangeAnnualRatePct={loanFields.setAnnualRatePct}
        annualRatePctError={fieldErrorMessage(
          t,
          attemptedSave,
          loanFields.fieldErrors.annualRateError,
        )}
        annualRatePctFieldRef={annualRateFieldRef}
        annualRatePctInputRef={annualRateInputRef}
        termMonths={loanFields.termMonths}
        onChangeTermMonths={loanFields.setTermMonths}
        termMonthsError={fieldErrorMessage(
          t,
          attemptedSave,
          loanFields.fieldErrors.termMonthsError,
        )}
        termMonthsFieldRef={termMonthsFieldRef}
        termMonthsInputRef={termMonthsInputRef}
      />
    </Box>
  );
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
  // Coupon frequency additionally offers 'semiannually', which compounding
  // does not; the shared vocabulary (monthly/quarterly/annually) resolves to
  // the same catalog key either way.
  const compoundingLabels: Record<CompoundingFrequency, string> = {
    'bi-weekly': t('forms.holding.biWeekly'),
    monthly: t('forms.holding.monthly'),
    quarterly: t('forms.holding.quarterly'),
    annually: t('forms.holding.annually'),
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

  // Per-field wrapper refs, one per validated field, passed to `scrollToField`
  // in `save`'s ordered first-invalid scroll below — each field's own inline
  // error (a `TextField`/`HoldingIdentityField` `error` prop, or a relocated
  // `FieldError` for the two group/relational reasons) sits right beside it,
  // so the scroll always lands on the same field the message is anchored to.
  const nameFieldRef = useRef<FieldInstance>(null);
  const contributionsFieldRef = useRef<FieldInstance>(null);
  // The LAST contribution row's own wrapper — a SEPARATE ref from
  // `contributionsFieldRef` above (which always anchors row 0, for the
  // Save-invalid scroll) — so `addContribution` below can scroll to whichever
  // row is newest, via the SAME occlusion-aware `scrollToField` helper
  // (round-6 device feedback item 3), rather than an unconditional
  // `scrollToEnd` that used to fire even when the new row was already
  // fully visible.
  const lastContributionFieldRef = useRef<FieldInstance>(null);
  const annualRateFieldRef = useRef<FieldInstance>(null);
  const termMonthsFieldRef = useRef<FieldInstance>(null);
  const isinFieldRef = useRef<FieldInstance>(null);
  const quantityFieldRef = useRef<FieldInstance>(null);
  const faceValueFieldRef = useRef<FieldInstance>(null);
  const couponPctFieldRef = useRef<FieldInstance>(null);
  const purchaseDateFieldRef = useRef<FieldInstance>(null);
  const maturityDateFieldRef = useRef<FieldInstance>(null);
  const propertyCostFieldRef = useRef<FieldInstance>(null);
  const metalPurityFieldRef = useRef<FieldInstance>(null);
  const metalQuantityFieldRef = useRef<FieldInstance>(null);
  const metalCostFieldRef = useRef<FieldInstance>(null);
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
  const isinInputRef = useRef<TextInputInstance>(null);
  const quantityInputRef = useRef<TextInputInstance>(null);
  const faceValueInputRef = useRef<TextInputInstance>(null);
  const couponPctInputRef = useRef<TextInputInstance>(null);
  const propertyCostInputRef = useRef<TextInputInstance>(null);
  const metalPurityInputRef = useRef<TextInputInstance>(null);
  const metalQuantityInputRef = useRef<TextInputInstance>(null);
  const metalCostInputRef = useRef<TextInputInstance>(null);
  const loanPrincipalInputRef = useRef<TextInputInstance>(null);

  // term deposit state
  const nextContributionId = useRef(1);
  const [contributions, setContributions] = useState<Contribution[]>([
    { id: 0, amount: '', date: null, saved: false },
  ]);
  const [annualRate, setAnnualRate] = useState('');
  const [termMonths, setTermMonths] = useState('');
  const [recapitalization, setRecap] = useState(false);
  const [compounding, setCompounding] = useState<CompoundingFrequency>('bi-weekly');

  // bond state
  const [quantity, setQuantity] = useState('');
  const [faceValue, setFaceValue] = useState('');
  const [couponPct, setCouponPct] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseDate, setPurchaseDate] = useState<number | null>(null);
  const [maturityDate, setMaturityDate] = useState<number | null>(null);
  const [bondKind, setBondKind] = useState<BondKind>('government');
  // Semiannual coupons are the common case for the government/corporate bonds
  // this tracks (the Monobank statement default), so the picker starts there.
  const [couponFrequency, setCouponFrequency] = useState<BondCouponFrequency>('semiannually');
  // The Bond form's "ISIN / Manual" mode (spec 6.3/6.4) — its own state,
  // register lookup, and side effects all live in `useBondIsinMode`.
  const {
    bondMode,
    setBondMode,
    isin,
    setIsin,
    registerTerms,
    registerLoaded,
    isinReasonKey,
    needsCouponFrequencyPick,
    pickedCouponFrequency,
    setPickedCouponFrequency,
  } = useBondIsinMode({
    type,
    isEdit,
    currency,
    purchaseDate,
    setPurchaseDate,
    setFaceValue,
    setCouponPct,
    setMaturityDate,
    setBondKind,
    setCouponFrequency,
    setCurrency,
    setName,
  });

  // property_item state. `propertyCost` is CREATE-only (PropertySection hides
  // its field in edit mode — cost/quantity history is fixed at creation; a
  // later revaluation goes through the dedicated "Update value" form
  // instead). `propertyLots` holds the ORIGINAL (hydrated) lots in edit mode,
  // carried through unchanged on save so an edit never rewrites cost/quantity
  // history — only `propertyCategory` is user-editable there.
  const [propertyCategory, setPropertyCategory] = useState<PropertyCategory>('real_estate');
  const [propertyCost, setPropertyCost] = useState('');
  const [propertyLots, setPropertyLots] = useState<Lot[]>([]);

  // metal state (T20). `metalQuantity`/`metalCost` are CREATE-only
  // (MetalSection hides its first-lot fields in edit mode — quantity/cost
  // history is fixed at creation; a later buy/sell goes through the
  // dedicated Lot form instead). `metalLots` holds the ORIGINAL (hydrated)
  // lots in edit mode, carried through unchanged on save.
  const [metalMetal, setMetalMetal] = useState<Metal>('XAU');
  const [metalForm, setMetalForm] = useState<MetalForm>('bar');
  const [metalUnit, setMetalUnit] = useState<MetalUnit>('oz');
  const [metalPurity, setMetalPurity] = useState(DEFAULT_METAL_PURITY);
  const [metalQuantity, setMetalQuantity] = useState('');
  const [metalCost, setMetalCost] = useState('');
  const [metalLots, setMetalLots] = useState<Lot[]>([]);

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

    if (holding.type === 'term_deposit') {
      seedTermDepositFields(holding, {
        setContributions,
        setNextContributionId: (id) => {
          nextContributionId.current = id;
        },
        setAnnualRate,
        setTermMonths,
        setRecap,
        setCompounding,
      });
      return;
    }

    if (holding.type === 'bond') {
      seedBondMetaFields(holding, {
        setQuantity,
        setFaceValue,
        setCouponPct,
        setPurchasePrice,
        setPurchaseDate,
        setMaturityDate,
        setBondKind,
        setCouponFrequency,
        setIsin,
        setBondMode,
      });
      return;
    }

    if (holding.type === 'property_item') {
      seedPropertyFields(holding, { setPropertyCategory, setPropertyLots });
      return;
    }

    if (holding.type === 'metal') {
      seedMetalFields(holding, {
        setMetalMetal,
        setMetalForm,
        setMetalUnit,
        setMetalPurity,
        setMetalLots,
      });
      return;
    }

    if (holding.type === 'loan') {
      loanFields.seed(holding);
      return;
    }

    setOpeningBalance(groupAmount(majorAmountText(holding.currency, holding.balanceMinorUnits)));
  }, [isEdit, editingHolding, setBondMode, setIsin, loanFields.seed]);

  // The stack sets the static "Add Holding" title; in edit mode override it with
  // "Edit Holding" so the header reads correctly for the update flow.
  useLayoutEffect(() => {
    if (isEdit) {
      navigation.setOptions({ title: t('forms.holding.editTitle') });
    }
  }, [isEdit, navigation, t]);

  const addContribution = (): void => {
    const id = nextContributionId.current++;
    setContributions((rows) => [...rows, { id, amount: '', date: null, saved: false }]);

    // The new row's fields are only measured after this render commits, so
    // defer the scroll to the next frame — otherwise `lastContributionFieldRef`
    // would still measure the PRE-add (one row shorter) layout. Same
    // deferred-RAF pattern as the categories screen's own
    // `scrollToAddCategoryForm`. Routes through the SAME occlusion-aware
    // `scrollToField` helper `save`'s own scroll-to-invalid uses below (round-6
    // device feedback item 3) — an unconditional `scrollToEnd` used to fire
    // even when the new row was already fully on screen.
    requestAnimationFrame(() => {
      scrollToField(scrollableRef, lastContributionFieldRef, {
        currentOffset: scrollOffset.value,
        headerInset,
        contentHeight: contentHeightRef.current,
      });
    });
  };

  const removeContribution = (index: number): void => {
    setContributions((rows) => rows.filter((_, i) => i !== index));
  };

  const updateContributionAmount = (index: number, next: string): void => {
    setContributions((rows) =>
      rows.map((row, i) => {
        return i === index ? { ...row, amount: next } : row;
      }),
    );
  };

  const updateContributionDate = (index: number, next: number): void => {
    setContributions((rows) =>
      rows.map((row, i) => {
        return i === index ? { ...row, date: next } : row;
      }),
    );
  };

  // Drop blank/partial rows: keep only a positive amount paired with a picked date.
  const parsedContributions = (): { amountMinorUnits: number; date: number }[] =>
    contributions.flatMap(({ amount, date }) => {
      const amountValue = parseAmount(amount);
      if (!(amountValue > 0) || date === null) {
        return [];
      }

      return [{ amountMinorUnits: Money.fromMajor(currency, amountValue).minorUnits, date }];
    });

  // A single contribution ROW's own validity: a positive amount paired with a
  // picked date, the same pair `parsedContributions` requires to keep a row.
  // Used to catch a row `parsedContributions` would otherwise silently DROP —
  // a blank or partially-filled row (most often a fresh `addContribution`
  // left unfilled) — while at least one OTHER row is already valid, so the
  // overall `contributionsRequiredError` (below) never fires (round-4 device
  // feedback item 10: saving used to drop that row without any indication it
  // was ignored).
  const isContributionRowValid = (contribution: Contribution): boolean =>
    parseAmount(contribution.amount) > 0 && contribution.date !== null;

  const buildDepositMetadata = (): Record<string, unknown> | undefined => {
    const rows = parsedContributions();
    if (rows.length === 0) {
      return undefined;
    }
    return {
      contributions: rows,
      annualRatePct: parseAmount(annualRate) || 0,
      termMonths: parseAmount(termMonths) || 0,
      recapitalization,
      compounding,
    };
  };

  const buildBondMetadata = (): Record<string, unknown> => {
    const quantityValue = parseAmount(quantity) || 0;
    const faceValueMinorUnits = Money.fromMajor(currency, parseAmount(faceValue) || 0).minorUnits;
    const priceValue = parseAmount(purchasePrice);
    return {
      quantity: quantityValue,
      faceValueMinorUnits,
      couponPct: parseAmount(couponPct) || 0,
      // The total actually paid. If left blank, fall back to nominal (par), so
      // the purchase entry and expected profit read as break-even.
      purchasePriceMinorUnits:
        priceValue > 0
          ? Money.fromMajor(currency, priceValue).minorUnits
          : quantityValue * faceValueMinorUnits,
      purchaseDate: purchaseDate ?? Date.now(),
      maturityDate: maturityDate ?? Date.now(),
      bondKind,
      couponFrequency,
      // Stored as a record of how the holding was added (spec 6.4 #6); the
      // save is blocked by `isinReasonKey` while Manual mode's own ISIN is
      // non-empty but invalid, so a saved value is always well-formed. Left
      // out entirely for a blank Manual-mode ISIN, rather than an empty
      // string, so `asBondMeta`'s optional field round-trips as `undefined`.
      // `isin` itself is already normalized (`useBondIsinMode`'s own
      // `setIsin` wrapper) — a second `normalizeIsin` call here was a
      // redundant third normalization (T25 review round 2, Minor 9).
      ...(isin.trim() === '' ? {} : { isin }),
    };
  };

  const buildMetadata = (): Record<string, unknown> | undefined => {
    if (type === 'term_deposit') {
      return buildDepositMetadata();
    }
    if (type === 'bond') {
      return buildBondMetadata();
    }
    // A property's CREATE metadata is built separately (see `save`'s create
    // branch, `buildPropertyCreatePayload`) — this branch covers EDIT mode
    // only: category is user-editable, but the ORIGINAL (hydrated) lots are
    // carried through unchanged, since cost/quantity history is fixed at
    // creation (a later revaluation goes through the "Update value" form
    // instead, never through this metadata patch).
    if (type === 'property_item' && isEdit) {
      return { category: propertyCategory, lots: propertyLots };
    }
    // A metal's CREATE metadata is built separately (see `save`'s create
    // branch, `buildMetalCreatePayload`) — this branch covers EDIT mode only:
    // metal/form/unit/purity stay user-editable, but the ORIGINAL (hydrated)
    // lots are carried through unchanged, since quantity/cost history is
    // fixed at creation (a later buy/sell goes through the dedicated Lot form
    // instead, never through this metadata patch).
    if (type === 'metal' && isEdit) {
      return {
        metal: metalMetal,
        form: metalForm,
        unit: metalUnit,
        purity: normalizedPurityOrThrow(metalPurity),
        lots: metalLots,
      };
    }
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

  // The contributions group's OWN reason: at least one contribution with a
  // positive amount and a picked date (`parsedContributions` already drops
  // blank/partial rows), and EVERY row present either fully filled in or
  // removed (never silently dropped — round-4 device feedback item 10).
  const contributionsFieldReasonKey = ():
    | 'forms.holding.contributionsRequiredError'
    | 'forms.holding.contributionIncompleteError'
    | null => {
    if (parsedContributions().length === 0) {
      return 'forms.holding.contributionsRequiredError';
    }

    if (contributions.some((contribution) => !isContributionRowValid(contribution))) {
      return 'forms.holding.contributionIncompleteError';
    }

    return null;
  };

  // The annual-rate field's OWN reason, independent of the contributions/term
  // fields around it.
  const annualRateFieldReasonKey = (): 'forms.holding.annualRateError' | null => {
    const rate = parseAmount(annualRate);

    return annualRate.trim() === '' || !(rate >= 0) ? 'forms.holding.annualRateError' : null;
  };

  // The term-months field's OWN reason, independent of the fields above it.
  const termMonthsFieldReasonKey = (): 'forms.holding.termMonthsError' | null => {
    const months = parseAmount(termMonths);

    return Number.isInteger(months) && months > 0 ? null : 'forms.holding.termMonthsError';
  };

  // A term deposit needs a valid contributions group, a non-negative annual
  // rate that was actually entered, and a whole-month term greater than
  // zero. Recapitalization and compounding always carry defaults. Not gated
  // on whether the name is filled: the name's own required asterisk covers
  // that separately. Derived from the three field functions above, in the
  // SAME priority order, so this can never drift from what each field
  // itself displays.
  const termDepositReasonKey = (): TermDepositReasonKey | null =>
    contributionsFieldReasonKey() ?? annualRateFieldReasonKey() ?? termMonthsFieldReasonKey();

  // Valid exactly when there is no reason to reject.
  const isTermDepositValid = (): boolean => termDepositReasonKey() === null;

  // The bond quantity field's OWN reason, independent of the fields below it.
  const bondQuantityFieldReasonKey = (): 'forms.holding.quantityError' | null =>
    parseAmount(quantity) > 0 ? null : 'forms.holding.quantityError';

  // The face-value field's OWN reason, independent of quantity/coupon/dates.
  const faceValueFieldReasonKey = (): 'forms.holding.faceValueError' | null =>
    parseAmount(faceValue) > 0 ? null : 'forms.holding.faceValueError';

  // The coupon field's OWN reason, independent of the other bond fields.
  const couponPctFieldReasonKey = (): 'forms.holding.couponPctError' | null =>
    couponPct.trim() === '' || !(parseAmount(couponPct) >= 0)
      ? 'forms.holding.couponPctError'
      : null;

  // The purchase-date field's OWN reason: missing entirely, independent of
  // the fields around it. This is the ONE bond field rendered in BOTH modes
  // (see `purchaseDateErrorMessage`'s own doc comment for how ISIN mode ALSO
  // redirects the maturity-date reason here, since ISIN mode never mounts
  // its own maturity DateField). `useBondIsinMode`'s own effect already
  // defaults this field to today the instant the bond section opens, in
  // EITHER mode, so this stays defensive against a silent, unreadable Save
  // block if that default ever stops applying before Save is reachable.
  const purchaseDateFieldReasonKey = (): 'forms.holding.purchaseDateRequiredError' | null =>
    purchaseDate === null ? 'forms.holding.purchaseDateRequiredError' : null;

  // The maturity-date field's OWN reason: missing (Manual mode only — ISIN
  // mode's date is register-sourced and applied automatically once an ISIN
  // matches) or, once both dates are picked, out of order — independent of
  // quantity/faceValue/coupon.
  const maturityDateFieldReasonKey = ():
    | 'forms.holding.maturityDateRequiredError'
    | 'forms.holding.maturityDateError'
    | null => {
    if (maturityDate === null) {
      return 'forms.holding.maturityDateRequiredError';
    }

    if (purchaseDate !== null && maturityDate <= purchaseDate) {
      return 'forms.holding.maturityDateError';
    }

    return null;
  };

  // The bond's own reason, derived from the five field functions above, in
  // the SAME priority order each field itself displays — this can never
  // drift from what any one field shows, unlike a hand-duplicated chain.
  const bondReasonKey = (): BondReasonKey | null =>
    bondQuantityFieldReasonKey() ??
    faceValueFieldReasonKey() ??
    couponPctFieldReasonKey() ??
    purchaseDateFieldReasonKey() ??
    maturityDateFieldReasonKey();

  // A bond ALSO needs a valid ISIN (`isinReasonKey`, from `useBondIsinMode`)
  // and, while `needsCouponFrequencyPick` (an unmapped-frequency ISIN-mode
  // match), a picked coupon frequency — spec 6.2 forbids guessing one, so
  // Save stays blocked until `pickedCouponFrequency` is set. Everything
  // else is `bondReasonKey` alone, so the two can never disagree.
  const isBondValid = (): boolean =>
    isinReasonKey === null &&
    !(needsCouponFrequencyPick && pickedCouponFrequency === null) &&
    bondReasonKey() === null;

  // The cost field only applies at CREATE time (PropertySection hides it in
  // edit mode: cost/quantity history is fixed at creation, a later
  // revaluation goes through the dedicated "Update value" form instead), so
  // this only rejects on create — an edit always passes.
  const propertyReasonKey = (): PropertyReasonKey | null =>
    !isEdit && !(parseAmount(propertyCost) > 0) ? 'forms.holding.propertyCostError' : null;

  // Derived from `propertyReasonKey` so the two can never disagree: valid
  // exactly when there is no reason to reject.
  const isPropertyValid = (): boolean => propertyReasonKey() === null;

  // Purity applies in BOTH create and edit mode — MetalSection always renders
  // the field (unlike the create-only Quantity/Total cost pair below), and a
  // fineness ratio is meaningful whenever it's shown. A garbled or
  // out-of-range value BLOCKS Save rather than reaching either metadata
  // builder at all. Validates with `normalizeDecimal` + `compareDecimal`,
  // the SAME parser `normalizedPurityOrThrow` (the writer) uses (mirroring
  // the metal-quantity check below), so a value this check accepts is
  // guaranteed to parse when the writer runs.
  const metalPurityReasonKey = (): 'forms.holding.purityError' | null => {
    const normalizedPurity = normalizeDecimal(metalPurity);

    return normalizedPurity !== null &&
      compareDecimal(normalizedPurity, '0') > 0 &&
      compareDecimal(normalizedPurity, '1') <= 0
      ? null
      : 'forms.holding.purityError';
  };

  // The metal quantity field's OWN reason (the first-lot Quantity/Total cost
  // fields only apply at CREATE time — MetalSection hides them in edit mode:
  // quantity/cost history is fixed at creation, a later buy/sell goes
  // through the dedicated Lot form instead), independent of purity/cost.
  const metalQuantityFieldReasonKey = (): 'forms.holding.quantityError' | null => {
    if (isEdit) {
      return null;
    }

    const normalizedQuantity = normalizeDecimal(metalQuantity);

    return normalizedQuantity === null || compareDecimal(normalizedQuantity, '0') <= 0
      ? 'forms.holding.quantityError'
      : null;
  };

  // The metal total-cost field's OWN reason (CREATE time only, see
  // `metalQuantityFieldReasonKey`'s own doc comment), independent of
  // purity/quantity.
  const metalCostFieldReasonKey = (): 'forms.lot.totalCostError' | null =>
    isEdit || parseAmount(metalCost) > 0 ? null : 'forms.lot.totalCostError';

  // The metal's own reason, derived from the three field functions above, in
  // the SAME priority order each field itself displays.
  const metalReasonKey = (): MetalReasonKey | null =>
    metalPurityReasonKey() ?? metalQuantityFieldReasonKey() ?? metalCostFieldReasonKey();

  // Valid exactly when there is no reason to reject.
  const isMetalValid = (): boolean => metalReasonKey() === null;

  const isValid =
    name.trim().length > 0 &&
    match(type)
      .with('term_deposit', isTermDepositValid)
      .with('bond', isBondValid)
      .with('property_item', isPropertyValid)
      .with('metal', isMetalValid)
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
        bondMode,
        termDepositReasonKey: termDepositReasonKey(),
        bondReasonKey: bondReasonKey(),
        isinReasonKey,
        needsCouponFrequencyPick,
        pickedCouponFrequency,
        propertyReasonKey: propertyReasonKey(),
        metalReasonKey: metalReasonKey(),
        loanReasonKey: loanFields.reasonKey,
        refs: {
          nameFieldRef,
          contributionsFieldRef,
          annualRateFieldRef,
          termMonthsFieldRef,
          isinFieldRef,
          quantityFieldRef,
          faceValueFieldRef,
          couponPctFieldRef,
          purchaseDateFieldRef,
          maturityDateFieldRef,
          propertyCostFieldRef,
          metalPurityFieldRef,
          metalQuantityFieldRef,
          metalCostFieldRef,
          loanPrincipalFieldRef,
          loanStartDateFieldRef,
        },
        focus: {
          name: () => nameInputRef.current?.focus(),
          annualRate: () => annualRateInputRef.current?.focus(),
          termMonths: () => termMonthsInputRef.current?.focus(),
          isin: () => isinInputRef.current?.focus(),
          quantity: () => quantityInputRef.current?.focus(),
          faceValue: () => faceValueInputRef.current?.focus(),
          couponPct: () => couponPctInputRef.current?.focus(),
          propertyCost: () => propertyCostInputRef.current?.focus(),
          metalPurity: () => metalPurityInputRef.current?.focus(),
          metalQuantity: () => metalQuantityInputRef.current?.focus(),
          metalCost: () => metalCostInputRef.current?.focus(),
          loanPrincipal: () => loanPrincipalInputRef.current?.focus(),
        },
      });

      if (target) {
        scrollToField(
          scrollableRef,
          target.ref,
          {
            currentOffset: scrollOffset.value,
            headerInset,
            contentHeight: contentHeightRef.current,
          },
          target.focus,
        );
      }

      return;
    }

    const metadata = buildMetadata();

    try {
      if (isEdit && holdingId !== undefined) {
        // Update the editable fields (see buildHoldingPatch: deposit/bond write
        // metadata, every other type writes its balance) plus the icon, all via
        // `saveEdit` (extracted purely to keep THIS function's own branch count
        // under the cognitive-complexity budget). Type/currency are read-only.
        await saveEdit({
          holdingId,
          patch: buildHoldingPatch({
            name,
            color,
            type,
            currency,
            openingBalance,
            metadata,
            isSynced: isSyncedEdit,
          }),
          editingHolding,
          loanFields,
          type,
          currency,
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
          propertyCategory,
          propertyCost,
          metal: metalMetal,
          metalForm,
          metalUnit,
          metalPurity,
          metalQuantity,
          metalCost,
          loanFields,
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

  // Computed once here (rather than inline at each render site below) so the
  // group `<FieldError>`'s own `message` prop reuses this exact string
  // instead of calling `t()` a second time for the same key.
  const contributionsFieldReason = contributionsFieldReasonKey();
  const contributionsRequiredMessage = contributionsSubReasonMessage(
    t,
    attemptedSave,
    contributionsFieldReason,
    'forms.holding.contributionsRequiredError',
  );
  const contributionIncompleteMessage = contributionsSubReasonMessage(
    t,
    attemptedSave,
    contributionsFieldReason,
    'forms.holding.contributionIncompleteError',
  );
  const maturityDateErrorMessage = fieldErrorMessage(
    t,
    attemptedSave,
    maturityDateFieldReasonKey(),
  );
  const purchaseDateOwnErrorMessage = fieldErrorMessage(
    t,
    attemptedSave,
    purchaseDateFieldReasonKey(),
  );
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
          <Box gap={4}>
            <Divider testID="form-divider" />

            <Text variant="heading">{t('forms.holding.contributions')}</Text>

            {/* The mapped contributions and the inline Add button form ONE
                group under a tighter inner gap (spacing(2) = 8pt), so the small
                Add button hugs the list — ~8pt below the last contribution —
                rather than sitting the section's full spacing(4) = 16pt below
                it. That 16pt is the uniform outer-section gap between
                full-height rows (headings, dividers, the balance group); above
                a short `size="small"` button, and right after each
                contribution's own tight 8pt internal rhythm, it read as a
                disproportionate top gap (the Add button is NOT the shared
                Screen footer, so last round's footer-padding fix never touched
                it). The contributions keep their own spacing(4) = 16pt
                separation from each other via the inner list Box, so distinct
                contributions stay visually distinct. */}
            <Box gap={2} testID="contributions-group">
              <Box gap={4}>
                {contributions.map((contribution, index) => (
                  <View
                    key={contribution.id}
                    // Row 0 anchors `contributionsFieldRef` (the Save-invalid
                    // scroll target, unchanged); the LAST row additionally
                    // anchors `lastContributionFieldRef` (round-6 item 3's
                    // add-row scroll target) — a callback ref, since a single
                    // native element can only take one `ref` prop, and a
                    // one-row list satisfies both conditions on the SAME node.
                    ref={(node) => {
                      if (index === 0) {
                        contributionsFieldRef.current = node;
                      }
                      if (index === contributions.length - 1) {
                        lastContributionFieldRef.current = node;
                      }
                    }}
                  >
                    <Box gap={2}>
                      <TextField
                        label={t('forms.holding.contributionAmount', { index: index + 1 })}
                        value={contribution.amount}
                        onChangeText={(next) => updateContributionAmount(index, groupAmount(next))}
                        keyboardType="decimal-pad"
                        placeholder={t('forms.holding.contributionPlaceholder')}
                        suffix={currencySymbol[currency]}
                        required
                      />

                      <DateField
                        label={t('forms.holding.contributionDate', { index: index + 1 })}
                        value={contribution.date}
                        onChange={(next) => updateContributionDate(index, next)}
                        placeholder={t('forms.fields.selectDatePlaceholder')}
                        required
                      />

                      {index === 0 && contributionsRequiredMessage !== undefined && (
                        <FieldError message={contributionsRequiredMessage} />
                      )}

                      {/* A row left blank or half-filled once at least one
                        OTHER row is already valid — `contributionsRequiredMessage`
                        above only fires when EVERY row is empty, so this
                        catches the row `parsedContributions` would otherwise
                        silently drop (round-4 device feedback item 10). */}
                      {contributionIncompleteMessage !== undefined &&
                        !isContributionRowValid(contribution) && (
                          <FieldError message={contributionIncompleteMessage} />
                        )}

                      {contributions.length > 1 && (
                        <Button
                          variant="destructiveTonal"
                          size="small"
                          fullWidth={false}
                          icon="trash"
                          disabled={contribution.saved}
                          accessibilityLabel={t('forms.holding.removeContribution', {
                            index: index + 1,
                          })}
                          onPress={() => removeContribution(index)}
                        >
                          {t('forms.holding.remove')}
                        </Button>
                      )}
                    </Box>
                  </View>
                ))}
              </Box>

              <Button
                variant="secondaryTonal"
                size="small"
                fullWidth={false}
                icon="plus"
                onPress={addContribution}
              >
                {t('forms.holding.addContribution')}
              </Button>
            </Box>

            <Divider testID="form-divider" />

            <Text variant="heading">{t('forms.holding.terms')}</Text>

            <View ref={annualRateFieldRef}>
              <TextField
                label={t('forms.holding.annualRatePct')}
                value={annualRate}
                onChangeText={setAnnualRate}
                keyboardType="decimal-pad"
                placeholder={t('forms.holding.annualRatePlaceholder')}
                required
                error={fieldErrorMessage(t, attemptedSave, annualRateFieldReasonKey())}
                inputRef={annualRateInputRef}
              />
            </View>

            <View ref={termMonthsFieldRef}>
              <TextField
                label={t('forms.holding.termMonths')}
                value={termMonths}
                onChangeText={setTermMonths}
                keyboardType="number-pad"
                placeholder={t('forms.holding.termMonthsPlaceholder')}
                required
                error={fieldErrorMessage(t, attemptedSave, termMonthsFieldReasonKey())}
                inputRef={termMonthsInputRef}
              />
            </View>

            <Switch
              label={t('forms.holding.recapitalization')}
              value={recapitalization}
              onValueChange={setRecap}
            />

            <ChipRow
              label={t('forms.holding.compounding')}
              options={compoundingOptions}
              selected={compounding}
              onSelect={setCompounding}
              labels={compoundingLabels}
            />
          </Box>
        )}

        {type === 'bond' && (
          <Box gap={4}>
            <Divider testID="form-divider" />

            <Text variant="heading">{t('forms.holding.details')}</Text>

            <BondIsinSection
              mode={bondMode}
              onSelectMode={setBondMode}
              isin={isin}
              onChangeIsin={setIsin}
              isinError={isinFieldErrorMessage(t, attemptedSave, isinReasonKey)}
              isinFieldRef={isinFieldRef}
              isinInputRef={isinInputRef}
              foundTerms={registerTerms}
              registerLoaded={registerLoaded}
              onSwitchToManual={() => setBondMode('manual')}
              needsCouponFrequencyPick={needsCouponFrequencyPick}
              pickedCouponFrequency={pickedCouponFrequency}
              onPickCouponFrequency={setPickedCouponFrequency}
              couponFrequencyError={couponFrequencyErrorMessage(
                t,
                attemptedSave,
                needsCouponFrequencyPick,
                pickedCouponFrequency,
              )}
            />

            <View ref={quantityFieldRef}>
              <TextField
                label={t('forms.holding.quantity')}
                value={quantity}
                onChangeText={(text) => setQuantity(groupAmount(text))}
                keyboardType="number-pad"
                placeholder={t('forms.holding.quantityPlaceholder')}
                required
                error={fieldErrorMessage(t, attemptedSave, bondQuantityFieldReasonKey())}
                inputRef={quantityInputRef}
              />
            </View>

            <TextField
              label={t('forms.holding.purchasePrice')}
              value={purchasePrice}
              onChangeText={(text) => setPurchasePrice(groupAmount(text))}
              keyboardType="decimal-pad"
              placeholder={t('forms.holding.purchasePricePlaceholder')}
              suffix={currencySymbol[currency]}
            />

            {/* See `purchaseDateErrorMessage`'s own doc comment (I2). */}
            <View ref={purchaseDateFieldRef}>
              <DateField
                label={t('forms.holding.purchaseDate')}
                value={purchaseDate}
                onChange={setPurchaseDate}
                placeholder={t('forms.fields.selectDatePlaceholder')}
                required
                error={purchaseDateErrorMessage(
                  bondMode,
                  purchaseDateOwnErrorMessage,
                  maturityDateErrorMessage,
                )}
              />
            </View>

            <ManualBondFields
              bondMode={bondMode}
              faceValue={faceValue}
              onChangeFaceValue={(text) => setFaceValue(groupAmount(text))}
              faceValueError={fieldErrorMessage(t, attemptedSave, faceValueFieldReasonKey())}
              faceValueFieldRef={faceValueFieldRef}
              faceValueInputRef={faceValueInputRef}
              couponPct={couponPct}
              onChangeCouponPct={setCouponPct}
              couponPctError={fieldErrorMessage(t, attemptedSave, couponPctFieldReasonKey())}
              couponPctFieldRef={couponPctFieldRef}
              couponPctInputRef={couponPctInputRef}
              maturityDate={maturityDate}
              onChangeMaturityDate={setMaturityDate}
              maturityDateError={maturityDateErrorMessage}
              maturityDateFieldRef={maturityDateFieldRef}
              bondKind={bondKind}
              onSelectBondKind={setBondKind}
              couponFrequency={couponFrequency}
              onSelectCouponFrequency={setCouponFrequency}
              currencySuffix={currencySymbol[currency]}
            />
          </Box>
        )}

        {type === 'property_item' && (
          <Box gap={4}>
            <Divider testID="form-divider" />

            <Text variant="heading">{t('forms.holding.details')}</Text>

            <PropertySection
              category={propertyCategory}
              onSelectCategory={setPropertyCategory}
              showCost={!isEdit}
              cost={propertyCost}
              onChangeCost={(text) => setPropertyCost(groupAmount(text))}
              currencySuffix={currencySymbol[currency]}
              costError={fieldErrorMessage(t, attemptedSave, propertyReasonKey())}
              costFieldRef={propertyCostFieldRef}
              costInputRef={propertyCostInputRef}
            />
          </Box>
        )}

        {type === 'metal' && (
          <Box gap={4}>
            <Divider testID="form-divider" />

            <Text variant="heading">{t('forms.holding.details')}</Text>

            <MetalSection
              metal={metalMetal}
              onSelectMetal={setMetalMetal}
              form={metalForm}
              onSelectForm={setMetalForm}
              unit={metalUnit}
              onSelectUnit={setMetalUnit}
              purity={metalPurity}
              onChangePurity={setMetalPurity}
              purityError={fieldErrorMessage(t, attemptedSave, metalPurityReasonKey())}
              purityFieldRef={metalPurityFieldRef}
              purityInputRef={metalPurityInputRef}
              showFirstLot={!isEdit}
              quantity={metalQuantity}
              onChangeQuantity={(text) => setMetalQuantity(groupAmount(text))}
              cost={metalCost}
              onChangeCost={(text) => setMetalCost(groupAmount(text))}
              currencySuffix={currencySymbol.UAH}
              quantityError={fieldErrorMessage(t, attemptedSave, metalQuantityFieldReasonKey())}
              costError={fieldErrorMessage(t, attemptedSave, metalCostFieldReasonKey())}
              quantityFieldRef={metalQuantityFieldRef}
              quantityInputRef={metalQuantityInputRef}
              costFieldRef={metalCostFieldRef}
              costInputRef={metalCostInputRef}
            />
          </Box>
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
