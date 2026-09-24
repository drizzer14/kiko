import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import { Alert, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import type { ScrollViewInstance, TextInputInstance } from 'react-native';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { accountsRepo } from '@kiko/accounts/accounts.repo';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  creatableHoldingTypesForAccount,
  type HoldingType,
  holdingTypes,
  isLedgerlessHoldingType,
  holdingTypesForAccountKind,
} from '../../../holdings/holding-type';
import {
  asBondMeta,
  asMetalMeta,
  asPropertyMeta,
  asTermDepositMeta,
  type BondKind,
  type BondMeta,
  type Metal,
  type MetalForm,
  type MetalUnit,
  type PropertyCategory,
  type CompoundingFrequency,
  type TermDepositMeta,
} from '../../../holdings/holding-metadata';
import type { Lot } from '../../../holdings/lots';
import { Money } from '../../../currency/money';
import type { HoldingRow, BondRegisterRow } from '../../../db/schema';
import { dayKeyOf } from '../../../prices/price-book';
import { startOfLocalDay } from '../../../dates/local-day';
import { parseAmount } from '../../../currency/parse';
import { compareDecimal, normalizeDecimal, shiftDecimal } from '../../../currency/decimal';
import Box from '../../../design-system/components/box';
import { useLiveQuery } from '../../../db/use-live-query';
import Text from '../../../design-system/components/text';
import Button from '../../../design-system/components/button';
import Screen from '../../../design-system/components/screen';
import Switch from '../../../design-system/components/switch';
import { isSyncedAccount, isSyncedHolding } from '../../../holdings/deletable';
import Divider from '../../../design-system/components/divider';
import TextField from '../../../design-system/components/text-field';
import { holdingTypeSymbol } from '../../../holdings/entity-symbols';
import { defaultHoldingColor } from '../../../holdings/entity-colors';
import FieldError from '../../../design-system/components/field-error';
import { resolveEntityColor } from '../../../design-system/entity-tint';
import type { AccountsStackParamList } from '../../../navigation/types';
import CurrencyField from '../../../design-system/components/currency-field';
import { type Currency, currencyScale, currencySymbol } from '../../../currency/currency';
import { KIKO_ENTITIES_ICONS } from '../../../design-system/components/icon-picker-modal/icon-pools';
import type { BondTerms } from '../../../bonds/nbu-register';
import { normalizeIsin, validateIsin } from '../../../bonds/isin';
import { bondRegisterRepo, refreshBondRegisterIfStale } from '../../../bonds/bond-register-repo';

import ChipRow from '../chip-row';
import DateField from '../date-field';
import ColorPicker from '../color-picker';
import HoldingIdentityField from '../holding-identity-field';
import MetalSection from './metal-section';
import PropertySection from './property-section';
import BondIsinSection from './bond-isin-section';
import { useSubmitOnce } from '../use-submit-once/use-submit-once';
import { groupAmount, majorAmountText } from '../amount-format/amount-format';
import type { BondEntryMode } from './bond-isin-section/bond-isin-section.props';
import {
  useHeaderInset,
  scrollToField,
  type FieldInstance,
} from '../scroll-to-field/scroll-to-field';

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
  | 'forms.holding.maturityDateError';

// The literal i18n keys `isinReasonKey` may return (T25, spec 6.4). Required
// in ISIN mode, optional-but-must-be-valid-if-typed in Manual mode (spec 6.4
// #6 keeps the ISIN editable there) — see `isinReasonKey`'s own doc comment.
type IsinReasonKey =
  | 'forms.holding.isinRequiredError'
  | 'forms.holding.isinFormatError'
  | 'forms.holding.isinCheckDigitError'
  | 'forms.holding.isinNotInRegister';

// The literal i18n key `propertyReasonKey` may return, so `t()` (typed from
// src/i18n/locales/en.ts) accepts it.
type PropertyReasonKey = 'forms.holding.propertyCostError';

// The literal i18n keys `metalReasonKey` may return — reusing the SAME
// generic quantity error the bond form already carries, and the Lot form's
// own total-cost error, rather than minting a metal-specific duplicate of
// either message.
type MetalReasonKey = 'forms.holding.quantityError' | 'forms.lot.totalCostError';

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

// The register-sourced field set a found ISIN fills (spec 6.2/6.3): face
// value, coupon, maturity, bond kind (always 'government' — the register is
// Minfin-only), currency, and name. `couponFrequency` only applies when the
// register's `pay_period` maps onto a known band; an unmapped period (spec
// 6.2's own fallback) instead switches the form to Manual, leaving every
// OTHER known field pre-filled, so the user only has to pick the frequency
// by hand rather than the form guessing one. Extracted to a module-level
// pure function (mirrors `seedBondMetaFields` above) so the effect that
// calls it stays out of `HoldingFormScreen`'s own cognitive-complexity
// budget.
const applyFoundBondTerms = (
  terms: BondTerms,
  setters: {
    setFaceValue: (value: string) => void;
    setCouponPct: (value: string) => void;
    setMaturityDate: (value: number) => void;
    setBondKind: (value: BondKind) => void;
    setCouponFrequency: (value: BondMeta['couponFrequency']) => void;
    setCurrency: (value: Currency) => void;
    setName: (value: string) => void;
    setBondMode: (value: BondEntryMode) => void;
  },
): void => {
  setters.setFaceValue(groupAmount(majorAmountText(terms.currency, terms.faceValueMinorUnits)));
  setters.setCouponPct(String(terms.couponPct));
  setters.setMaturityDate(terms.maturityDate);
  setters.setBondKind('government');
  setters.setCurrency(terms.currency);
  setters.setName(terms.name);

  if (terms.couponFrequency === null) {
    setters.setBondMode('manual');
  } else {
    setters.setCouponFrequency(terms.couponFrequency);
  }
};

// The ISIN `bondRegisterRepo.findByIsinQuery` looks up this render: the
// normalized candidate once it is shaped/check-digit valid, else an empty
// string (matches no row) — so an incomplete/malformed candidate never
// probes the cache. Extracted (rather than an inline ternary in the
// component) so this stays out of `HoldingFormScreen`'s own
// cognitive-complexity budget.
const isinForRegisterLookup = (isin: string): string => {
  const result = validateIsin(isin);

  return result.ok ? result.isin : '';
};

// The first matched register row's own `terms`, or `null` when the lookup
// found nothing — extracted for the same reason as `isinForRegisterLookup`
// above.
const firstRegisterTerms = (rows: BondRegisterRow[]): BondTerms | null => rows.at(0)?.terms ?? null;

// Whether `registerTerms` is a genuine match for the CURRENT mode — a type
// predicate so the effect that guards on it (`save`'s own auto-fill effect
// below) narrows `registerTerms` to `BondTerms` on its early-return branch,
// keeping that effect's own body to a single flat `if`.
const isFoundBondMatch = (bondMode: BondEntryMode, terms: BondTerms | null): terms is BondTerms =>
  bondMode === 'isin' && terms !== null;

// Whether the register cache should be refreshed this render (spec 6.4 #4)
// — extracted so the effect that calls it stays a single flat `if`, the
// same reason `isFoundBondMatch` above is its own function.
const shouldRefreshBondRegister = (type: HoldingType, alreadyTriggered: boolean): boolean =>
  type === 'bond' && !alreadyTriggered;

// Whether ISIN mode's `purchaseDate` default (spec 6.3) should apply this
// render — extracted for the same reason as the two helpers above.
const shouldDefaultBondPurchaseDate = (params: {
  type: HoldingType;
  bondMode: BondEntryMode;
  purchaseDate: number | null;
}): boolean => params.type === 'bond' && params.bondMode === 'isin' && params.purchaseDate === null;

// The ISIN field's own blocking reason (T25, spec 6.4): required while in
// ISIN mode, optional-but-still-validated when non-empty in Manual mode
// (spec 6.4 #6 keeps it shown and editable there). `isinNotInRegister` only
// applies in ISIN mode, once the shape/check-digit both pass but the cache
// has no match (spec 6.4 #3 — covers a genuine "not found" and an "offline
// with no cache" the same way, since both leave `registerTerms` null).
// Module-level and pure (given the already-computed `registerTerms`), the
// same extraction reason as the helpers above.
const isinReasonKey = (
  bondMode: BondEntryMode,
  isin: string,
  registerTerms: BondTerms | null,
): IsinReasonKey | null => {
  if (bondMode !== 'isin' && isin.trim() === '') {
    return null;
  }

  if (isin.trim() === '') {
    return 'forms.holding.isinRequiredError';
  }

  const validation = validateIsin(isin);

  if (!validation.ok) {
    return validation.reason === 'format'
      ? 'forms.holding.isinFormatError'
      : 'forms.holding.isinCheckDigitError';
  }

  return bondMode === 'isin' && registerTerms === null ? 'forms.holding.isinNotInRegister' : null;
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

// The pre-filled purity — the standard bar/coin fineness (T20's own default).
// Shared by the initial form state and the create-payload's fallback below,
// so an emptied/garbled purity field never reaches `asMetalMeta` broken.
const DEFAULT_METAL_PURITY = '0.9999';

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
      purity: normalizeDecimal(purity) ?? DEFAULT_METAL_PURITY,
      lots: [lot],
    },
  };
};

// The type-specific CREATE payload: `property_item` and `metal` (T20) each
// seed their own first lot (`buildPropertyCreatePayload`/
// `buildMetalCreatePayload` above) instead of a plain opening balance +
// generic metadata. Grouped here — rather than a nested ternary in `save`'s
// create call, which the project's `noNestedTernary` lint rule forbids — so
// `save` keeps a single flat spread.
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

  return {
    balanceMinorUnits: Money.fromMajor(params.currency, parseAmount(params.openingBalance) || 0)
      .minorUnits,
    metadata: params.metadata,
  };
};

const bondKinds: readonly BondKind[] = ['government', 'corporate'];

const compoundingOptions: readonly CompoundingFrequency[] = [
  'bi-weekly',
  'monthly',
  'quarterly',
  'annually',
];

const couponFrequencies = ['monthly', 'quarterly', 'semiannually', 'annually'] as const;
type CouponFrequency = (typeof couponFrequencies)[number];

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

// The active error message for one of `termDepositReasonKey`'s /
// `bondReasonKey`'s own returned keys, or `undefined` while that field's own
// check still passes (or before the first failed Save press) — shared by
// every per-field `TextField`/`HoldingIdentityField` `error` prop and the two
// relocated group `<FieldError>`s below, so each render site is a single call
// rather than repeating the `attemptedSave &&` comparison inline at all seven
// fields. Kept module-level and pure so its branch stays out of
// HoldingFormScreen's own cognitive-complexity budget (the same reason
// transaction-form's `resolveDescriptionPlaceholder` is a module-level
// helper).
const fieldErrorMessage = (
  t: TFunction,
  attemptedSave: boolean,
  reasonKey:
    | TermDepositReasonKey
    | BondReasonKey
    | IsinReasonKey
    | PropertyReasonKey
    | MetalReasonKey
    | null,
  expectedKey:
    | TermDepositReasonKey
    | BondReasonKey
    | IsinReasonKey
    | PropertyReasonKey
    | MetalReasonKey,
): string | undefined => (attemptedSave && reasonKey === expectedKey ? t(expectedKey) : undefined);

// The ISIN field's OWN inline error text — every `isinReasonKey` EXCEPT
// `isinNotInRegister`, which `BondIsinSection` already surfaces as its own
// always-visible hint block (not gated on `attemptedSave`), so showing it a
// second time here would duplicate that message. Unlike `fieldErrorMessage`
// above (one specific expected key per call site), the ISIN field is the
// ONLY consumer of `IsinReasonKey`, so this checks membership directly
// instead of three chained `fieldErrorMessage` calls — kept as its own
// module-level function (rather than inline in the component) for the same
// cognitive-complexity reason `fieldErrorMessage` itself is one.
const ISIN_FIELD_ERROR_KEYS: readonly IsinReasonKey[] = [
  'forms.holding.isinRequiredError',
  'forms.holding.isinFormatError',
  'forms.holding.isinCheckDigitError',
];

const isinFieldErrorMessage = (
  t: TFunction,
  attemptedSave: boolean,
  reasonKey: IsinReasonKey | null,
): string | undefined => {
  if (!attemptedSave || reasonKey === null) {
    return undefined;
  }

  return ISIN_FIELD_ERROR_KEYS.includes(reasonKey) ? t(reasonKey) : undefined;
};

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
  maturityDateFieldRef: RefObject<FieldInstance | null>;
  propertyCostFieldRef: RefObject<FieldInstance | null>;
  metalQuantityFieldRef: RefObject<FieldInstance | null>;
  metalCostFieldRef: RefObject<FieldInstance | null>;
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
  metalQuantity: () => void;
  metalCost: () => void;
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
  termDepositReasonKey: TermDepositReasonKey | null;
  bondReasonKey: BondReasonKey | null;
  isinReasonKey: IsinReasonKey | null;
  propertyReasonKey: PropertyReasonKey | null;
  metalReasonKey: MetalReasonKey | null;
  refs: ValidatedFieldRefs;
  focus: ValidatedFieldFocus;
}): { ref: RefObject<FieldInstance | null>; focus?: () => void } | null => {
  const {
    name,
    type,
    termDepositReasonKey,
    bondReasonKey,
    isinReasonKey,
    propertyReasonKey,
    metalReasonKey,
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
            invalid: bondReasonKey === 'forms.holding.maturityDateError',
            ref: refs.maturityDateFieldRef,
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
  ];

  const entry = order.find((candidate) => candidate.invalid);

  return entry === undefined ? null : { ref: entry.ref, focus: entry.focus };
};

const HoldingFormScreen: FC<HoldingFormScreenProps> = ({ route, navigation }) => {
  const { accountId, holdingId, returnTo } = route.params;
  const { t } = useTranslation();
  // Human display text for the id-like holding types, the bond kind, and the
  // two frequency chip rows below; the chips still report the underlying
  // value on select. Built from the catalog inside the component (rather than
  // a module-level constant) so it always reflects the active language.
  const typeLabels: Record<HoldingType, string> = {
    card: t('forms.holding.card'),
    term_deposit: t('forms.holding.deposit'),
    bond: t('forms.holding.bond'),
    cash: t('forms.account.cash'),
    crypto_asset: t('forms.holding.cryptoAsset'),
    jar: t('forms.holding.jar'),
    property_item: t('forms.holding.propertyItem'),
    metal: t('forms.holding.metal'),
  };
  const bondKindLabels: Record<BondKind, string> = {
    government: t('forms.holding.government'),
    corporate: t('forms.holding.corporate'),
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
  const couponFrequencyLabels: Record<CouponFrequency, string> = {
    monthly: t('forms.holding.monthly'),
    quarterly: t('forms.holding.quarterly'),
    semiannually: t('forms.holding.semiannually'),
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
  const maturityDateFieldRef = useRef<FieldInstance>(null);
  const propertyCostFieldRef = useRef<FieldInstance>(null);
  const metalQuantityFieldRef = useRef<FieldInstance>(null);
  const metalCostFieldRef = useRef<FieldInstance>(null);
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
  const metalQuantityInputRef = useRef<TextInputInstance>(null);
  const metalCostInputRef = useRef<TextInputInstance>(null);

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
  const [couponFrequency, setCouponFrequency] = useState<CouponFrequency>('semiannually');
  // T25 — the "ISIN / Manual" mode (spec 6.3/6.4). A CREATE defaults to
  // 'isin'; edit mode's own seed effect below always forces 'manual' (spec
  // 6.4 #6 — the stored ISIN is shown there, still editable).
  const [bondMode, setBondMode] = useState<BondEntryMode>('isin');
  const [isin, setIsin] = useState('');

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

  // T25 — the ISIN-mode register lookup (spec 6.4 #3/#4): a validly-shaped
  // ISIN queries the cached `bond_register` (`useLiveQuery`, so an in-flight
  // `refreshBondRegisterIfStale` below reactively updates the result once it
  // lands); an incomplete/malformed candidate queries an empty string, which
  // matches no row. `BondIsinSection` stays presentational — this is the
  // SAME split `MetalSection`/`PropertySection` establish.
  const { data: bondRegisterRows } = useLiveQuery(
    bondRegisterRepo.findByIsinQuery(isinForRegisterLookup(isin)),
    ['bond_register'],
  );
  const registerTerms: BondTerms | null = firstRegisterTerms(bondRegisterRows);

  // Three independent bond-open side effects, combined into ONE effect
  // (each guarded by its own already-extracted predicate, so this body
  // stays three flat `if`s, no nesting) to keep this component's own
  // cognitive-complexity score down: refreshing the register cache at most
  // once per local day (spec 6.4 #4, fired once the bond section first
  // opens, create OR edit — never awaited/blocking, and fails quietly
  // offline; the caught rejection is deliberately dropped, a network
  // failure here must never surface as a form error, the register cache
  // simply stays stale until the next open); defaulting ISIN mode's
  // `purchaseDate` to today (spec 6.3) — unlike Manual mode, which requires
  // the user to pick one explicitly, defaulted to LOCAL MIDNIGHT
  // (`startOfLocalDay`), not a raw `Date.now()`: `DateField.handleDayPress`
  // carries over an existing value's own time-of-day onto a newly picked
  // day (so a paired TimeField pick is never clobbered — see its own doc
  // comment), so a raw `Date.now()` default would leave a LATER explicit
  // pick composed with today's current clock time instead of a clean local
  // midnight; and applying a found ISIN's terms
  // (spec 6.2/6.3 — see `applyFoundBondTerms`'s own doc comment for the
  // field list and the unmapped-`pay_period` fallback). The union of every
  // dependency covers all three guards; each is independently idempotent
  // (re-running a guard whose own predicate is already false is a no-op),
  // so sharing one dependency array never mis-fires any of the three.
  const bondRegisterRefreshTriggered = useRef(false);
  useEffect(() => {
    if (shouldRefreshBondRegister(type, bondRegisterRefreshTriggered.current)) {
      bondRegisterRefreshTriggered.current = true;
      refreshBondRegisterIfStale().catch(() => {});
    }
    if (shouldDefaultBondPurchaseDate({ type, bondMode, purchaseDate })) {
      setPurchaseDate(startOfLocalDay(Date.now()));
    }
    if (isFoundBondMatch(bondMode, registerTerms)) {
      applyFoundBondTerms(registerTerms, {
        setFaceValue,
        setCouponPct,
        setMaturityDate,
        setBondKind,
        setCouponFrequency,
        setCurrency,
        setName,
        setBondMode,
      });
    }
  }, [type, bondMode, purchaseDate, registerTerms]);

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

    setOpeningBalance(groupAmount(majorAmountText(holding.currency, holding.balanceMinorUnits)));
  }, [isEdit, editingHolding]);

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
      ...(isin.trim() === '' ? {} : { isin: normalizeIsin(isin) }),
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
        purity: normalizeDecimal(metalPurity) ?? DEFAULT_METAL_PURITY,
        lots: metalLots,
      };
    }
    return undefined;
  };

  // A term deposit needs at least one contribution with a positive amount and a
  // picked date (parsedContributions already drops blank/partial rows), EVERY
  // row present to be either fully filled in or removed (never silently
  // dropped — round-4 device feedback item 10), a non-negative annual rate
  // that was actually entered, and a whole-month term greater than zero.
  // Recapitalization and compounding always carry defaults. Not gated on
  // whether the name is filled: the name's own required asterisk covers that
  // separately.
  const termDepositReasonKey = (): TermDepositReasonKey | null => {
    if (parsedContributions().length === 0) {
      return 'forms.holding.contributionsRequiredError';
    }

    if (contributions.some((contribution) => !isContributionRowValid(contribution))) {
      return 'forms.holding.contributionIncompleteError';
    }

    const rate = parseAmount(annualRate);

    if (annualRate.trim() === '' || !(rate >= 0)) {
      return 'forms.holding.annualRateError';
    }

    const months = parseAmount(termMonths);

    if (!(Number.isInteger(months) && months > 0)) {
      return 'forms.holding.termMonthsError';
    }

    return null;
  };

  // Derived from `termDepositReasonKey` so the two can never disagree: valid
  // exactly when there is no reason to reject.
  const isTermDepositValid = (): boolean => termDepositReasonKey() === null;

  // A bond needs a valid ISIN (`isinReasonKey`, module-level below), a
  // positive quantity and face value, a non-negative coupon that was
  // actually entered, both dates picked, and a maturity strictly after the
  // purchase. Coupon frequency always carries a default, so it is always
  // valid. In ISIN mode, face value/coupon/maturity are register-sourced
  // (never directly edited) — see `applyFoundBondTerms` — so these same
  // checks apply unchanged in both modes.
  const isBondValid = (): boolean =>
    isinReasonKey(bondMode, isin, registerTerms) === null &&
    parseAmount(quantity) > 0 &&
    parseAmount(faceValue) > 0 &&
    couponPct.trim() !== '' &&
    parseAmount(couponPct) >= 0 &&
    purchaseDate !== null &&
    maturityDate !== null &&
    maturityDate > purchaseDate;

  // The reason `isBondValid` above is false, for the SAME checks in the
  // SAME priority order. A missing (not-yet-picked) date is already covered
  // by that field's own required asterisk, so this returns null rather than
  // a redundant "pick a date" line until BOTH dates are set — only then does
  // an invalid ORDER between them get its own reason.
  const bondReasonKey = (): BondReasonKey | null => {
    if (!(parseAmount(quantity) > 0)) {
      return 'forms.holding.quantityError';
    }

    if (!(parseAmount(faceValue) > 0)) {
      return 'forms.holding.faceValueError';
    }

    if (couponPct.trim() === '' || !(parseAmount(couponPct) >= 0)) {
      return 'forms.holding.couponPctError';
    }

    if (purchaseDate !== null && maturityDate !== null && maturityDate <= purchaseDate) {
      return 'forms.holding.maturityDateError';
    }

    return null;
  };

  // The cost field only applies at CREATE time (PropertySection hides it in
  // edit mode: cost/quantity history is fixed at creation, a later
  // revaluation goes through the dedicated "Update value" form instead), so
  // this only rejects on create — an edit always passes.
  const propertyReasonKey = (): PropertyReasonKey | null =>
    !isEdit && !(parseAmount(propertyCost) > 0) ? 'forms.holding.propertyCostError' : null;

  // Derived from `propertyReasonKey` so the two can never disagree: valid
  // exactly when there is no reason to reject.
  const isPropertyValid = (): boolean => propertyReasonKey() === null;

  // The first-lot Quantity/Total cost fields only apply at CREATE time
  // (MetalSection hides them in edit mode: quantity/cost history is fixed at
  // creation, a later buy/sell goes through the dedicated Lot form instead),
  // so this only rejects on create — an edit always passes. Purity carries a
  // valid default and is never itself a rejection reason (`buildMetalCreatePayload`/
  // `buildMetadata`'s edit branch both fall back to the default for a
  // cleared/garbled value, so a save can never write a broken MetalMeta).
  const metalReasonKey = (): MetalReasonKey | null => {
    if (isEdit) {
      return null;
    }

    const normalizedQuantity = normalizeDecimal(metalQuantity);

    if (normalizedQuantity === null || compareDecimal(normalizedQuantity, '0') <= 0) {
      return 'forms.holding.quantityError';
    }

    if (!(parseAmount(metalCost) > 0)) {
      return 'forms.lot.totalCostError';
    }

    return null;
  };

  // Derived from `metalReasonKey` so the two can never disagree: valid
  // exactly when there is no reason to reject.
  const isMetalValid = (): boolean => metalReasonKey() === null;

  const isValid =
    name.trim().length > 0 &&
    match(type)
      .with('term_deposit', isTermDepositValid)
      .with('bond', isBondValid)
      .with('property_item', isPropertyValid)
      .with('metal', isMetalValid)
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
        termDepositReasonKey: termDepositReasonKey(),
        bondReasonKey: bondReasonKey(),
        isinReasonKey: isinReasonKey(bondMode, isin, registerTerms),
        propertyReasonKey: propertyReasonKey(),
        metalReasonKey: metalReasonKey(),
        refs: {
          nameFieldRef,
          contributionsFieldRef,
          annualRateFieldRef,
          termMonthsFieldRef,
          isinFieldRef,
          quantityFieldRef,
          faceValueFieldRef,
          couponPctFieldRef,
          maturityDateFieldRef,
          propertyCostFieldRef,
          metalQuantityFieldRef,
          metalCostFieldRef,
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
          metalQuantity: () => metalQuantityInputRef.current?.focus(),
          metalCost: () => metalCostInputRef.current?.focus(),
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
        // Update the editable fields in one transaction (see buildHoldingPatch:
        // deposit/bond write metadata, every other type writes its balance). The
        // icon routes through setIcon (so a cleared icon persists an explicit
        // null), the same split the create path uses. Type/currency are read-only.
        //
        // `updateWithBalanceDelta`, not `update`: an edited balance also has to
        // land on the ledger as a `manual` transaction for the difference, or the
        // holding's history stops being derivable from its transactions and the
        // whole past net-worth series shifts under the edit (kiko-domain). A patch
        // with no balance in it (a deposit/bond, or a synced holding) writes no
        // ledger row, so this is the right call for every edit.
        await holdingsRepo.updateWithBalanceDelta(
          holdingId,
          buildHoldingPatch({
            name,
            color,
            type,
            currency,
            openingBalance,
            metadata,
            isSynced: isSyncedEdit,
          }),
          Date.now(),
        );

        // Write the icon unconditionally in edit mode so clearing a custom icon
        // (icon === null) persists the removal rather than leaving the old glyph.
        await holdingsRepo.setIcon(holdingId, icon);

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
  const contributionsRequiredMessage = fieldErrorMessage(
    t,
    attemptedSave,
    termDepositReasonKey(),
    'forms.holding.contributionsRequiredError',
  );
  const contributionIncompleteMessage = fieldErrorMessage(
    t,
    attemptedSave,
    termDepositReasonKey(),
    'forms.holding.contributionIncompleteError',
  );
  const maturityDateErrorMessage = fieldErrorMessage(
    t,
    attemptedSave,
    bondReasonKey(),
    'forms.holding.maturityDateError',
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
        <ChipRow
          label={t('forms.holding.type')}
          options={typeOptions}
          selected={type}
          onSelect={setType}
          labels={typeLabels}
          icons={holdingTypeSymbol}
          disabled={isEdit}
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
                        placeholder={t('forms.holding.selectDatePlaceholder')}
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
                error={fieldErrorMessage(
                  t,
                  attemptedSave,
                  termDepositReasonKey(),
                  'forms.holding.annualRateError',
                )}
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
                error={fieldErrorMessage(
                  t,
                  attemptedSave,
                  termDepositReasonKey(),
                  'forms.holding.termMonthsError',
                )}
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
              isinError={isinFieldErrorMessage(
                t,
                attemptedSave,
                isinReasonKey(bondMode, isin, registerTerms),
              )}
              isinFieldRef={isinFieldRef}
              isinInputRef={isinInputRef}
              foundTerms={registerTerms}
              onSwitchToManual={() => setBondMode('manual')}
            />

            <View ref={quantityFieldRef}>
              <TextField
                label={t('forms.holding.quantity')}
                value={quantity}
                onChangeText={(text) => setQuantity(groupAmount(text))}
                keyboardType="number-pad"
                placeholder={t('forms.holding.quantityPlaceholder')}
                required
                error={fieldErrorMessage(
                  t,
                  attemptedSave,
                  bondReasonKey(),
                  'forms.holding.quantityError',
                )}
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

            <DateField
              label={t('forms.holding.purchaseDate')}
              value={purchaseDate}
              onChange={setPurchaseDate}
              placeholder={t('forms.holding.selectDatePlaceholder')}
              required
            />

            {/* Manual-only: face value, coupon, maturity, kind, and frequency
                are all register-sourced in ISIN mode (spec 6.3). `match`
                (not a raw `&&`) mirrors the `isValid` `match(type)` chain
                above — ts-pattern's own exhaustive check keeps this in sync
                if `BondEntryMode` ever grows a third mode. */}
            {match(bondMode)
              .with('isin', () => null)
              .with('manual', () => (
                <>
                  <View ref={faceValueFieldRef}>
                    <TextField
                      label={t('forms.holding.faceValue')}
                      value={faceValue}
                      onChangeText={(text) => setFaceValue(groupAmount(text))}
                      keyboardType="decimal-pad"
                      placeholder={t('forms.holding.faceValuePlaceholder')}
                      suffix={currencySymbol[currency]}
                      required
                      error={fieldErrorMessage(
                        t,
                        attemptedSave,
                        bondReasonKey(),
                        'forms.holding.faceValueError',
                      )}
                      inputRef={faceValueInputRef}
                    />
                  </View>

                  <View ref={couponPctFieldRef}>
                    <TextField
                      label={t('forms.holding.couponPct')}
                      value={couponPct}
                      onChangeText={setCouponPct}
                      keyboardType="decimal-pad"
                      placeholder={t('forms.holding.couponPlaceholder')}
                      required
                      error={fieldErrorMessage(
                        t,
                        attemptedSave,
                        bondReasonKey(),
                        'forms.holding.couponPctError',
                      )}
                      inputRef={couponPctInputRef}
                    />
                  </View>

                  <View ref={maturityDateFieldRef} testID="maturity-date-field">
                    <DateField
                      label={t('forms.holding.maturityDate')}
                      value={maturityDate}
                      onChange={setMaturityDate}
                      placeholder={t('forms.holding.selectDatePlaceholder')}
                      required
                      error={maturityDateErrorMessage}
                    />
                  </View>

                  <ChipRow
                    label={t('forms.holding.bondKind')}
                    options={bondKinds}
                    selected={bondKind}
                    onSelect={setBondKind}
                    labels={bondKindLabels}
                  />

                  <ChipRow
                    label={t('forms.holding.couponFrequency')}
                    options={couponFrequencies}
                    selected={couponFrequency}
                    onSelect={setCouponFrequency}
                    labels={couponFrequencyLabels}
                  />
                </>
              ))
              .exhaustive()}
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
              costError={fieldErrorMessage(
                t,
                attemptedSave,
                propertyReasonKey(),
                'forms.holding.propertyCostError',
              )}
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
              showFirstLot={!isEdit}
              quantity={metalQuantity}
              onChangeQuantity={(text) => setMetalQuantity(groupAmount(text))}
              cost={metalCost}
              onChangeCost={(text) => setMetalCost(groupAmount(text))}
              currencySuffix={currencySymbol.UAH}
              quantityError={fieldErrorMessage(
                t,
                attemptedSave,
                metalReasonKey(),
                'forms.holding.quantityError',
              )}
              costError={fieldErrorMessage(
                t,
                attemptedSave,
                metalReasonKey(),
                'forms.lot.totalCostError',
              )}
              quantityFieldRef={metalQuantityFieldRef}
              quantityInputRef={metalQuantityInputRef}
              costFieldRef={metalCostFieldRef}
              costInputRef={metalCostInputRef}
            />
          </Box>
        )}
      </Box>
    </Screen>
  );
};

export default HoldingFormScreen;
