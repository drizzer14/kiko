import {
  ownershipAt,
  WHOLE_SHARE,
  ownershipApplies,
  ownershipMetadata,
  withOwnershipChange,
  type OwnershipChange,
  type OwnershipShare,
} from '@kiko/holdings/ownership';
import type { RefObject } from 'react';
import {
  asPropertyMeta,
  propertyCategoryOf,
  type OwnershipInput,
  type PropertyCategory,
} from '@kiko/holdings/holding-metadata';
import { Money } from '@kiko/currency/money';
import type { Lot } from '@kiko/holdings/lots';
import type { HoldingRow } from '@kiko/db/schema';
import { parseAmount } from '@kiko/currency/parse';
import { dayKeyOf } from '@kiko/prices/price-book';
import { useCallback, useRef, useState } from 'react';
import { shiftDecimal } from '@kiko/currency/decimal';
import type { TextInputInstance } from 'react-native';
import { startOfLocalDay } from '@kiko/dates/local-day';
import { currencyScale, type Currency } from '@kiko/currency/currency';

import { saveMetadataEdit } from '../../save-metadata-edit';
import type { CreatePayload, EditContext, HoldingTypeForm } from '../../holding-type-form';
import type { FieldInstance } from '../../../../../design-system/scroll-to-field/scroll-to-field';

import {
  propertyFieldErrors,
  propertyReasonKey,
  type PropertyFieldErrors,
  type PropertyReasonKey,
} from './property-reasons';
import {
  enteredShare,
  shareChanged,
  ownershipEntryOf,
  type OwnershipEntry,
} from './property-ownership';

// The property CREATE payload: a `property_item` writes a zero stored
// balance (its value lives entirely in `metadata.lots` / `price_points` —
// kiko-domain), one lot dated today for a quantity of "1" at the entered
// cost, and a first `manual` price point equal to that same cost, so the
// holding never reads as "no price yet" before the user records a real
// revaluation. The lot's day and the price point's day share the SAME
// `dayKeyOf` normalization `PriceBook` itself reads price points by, and the
// point's `price` is derived from the SAME minor-units cost the lot carries
// (never re-parsed from the raw text field), so the two can never disagree.
// A share other than the whole is one ownership change on that same day.
const buildPropertyCreatePayload = (params: {
  category: PropertyCategory;
  currency: Currency;
  cost: string;
  share: OwnershipShare;
  ownershipInput: OwnershipInput;
}): CreatePayload => {
  const { category, currency, cost, share, ownershipInput } = params;
  const costMinorUnits = Money.fromMajor(currency, parseAmount(cost) || 0).minorUnits;
  const day = dayKeyOf(Date.now());
  const lot: Lot = { day, quantityDelta: '1', costMinorUnits };
  const ownership = withOwnershipChange([], { day, ...share });

  return {
    metadata: { category, lots: [lot], ...ownershipMetadata(ownership, ownershipInput) },
    firstPricePoint: {
      day,
      price: shiftDecimal(String(costMinorUnits), -currencyScale[currency]),
    },
  };
};

// An edit records the typed share as a change from the picked day only when
// it differs from the share in effect today; otherwise the stored list is
// written back unchanged.
const ownershipAfterEdit = (params: {
  stored: readonly OwnershipChange[];
  current: OwnershipShare;
  entered: OwnershipShare | null;
  effectiveDate: number;
}): OwnershipChange[] => {
  const { stored, current, entered, effectiveDate } = params;

  if (entered === null || !shareChanged(entered, current)) {
    return [...stored];
  }

  return withOwnershipChange(stored, { day: dayKeyOf(effectiveDate), ...entered });
};

type UsePropertyFieldsParams = {
  isEdit: boolean;
  currency: Currency;
};

export type PropertyOwnershipFields = {
  applies: boolean;
  mode: OwnershipInput;
  setMode: (mode: OwnershipInput) => void;
  percent: string;
  setPercent: (value: string) => void;
  numerator: string;
  setNumerator: (value: string) => void;
  denominator: string;
  setDenominator: (value: string) => void;
  showsEffectiveDate: boolean;
  effectiveDate: number;
  setEffectiveDate: (timestamp: number) => void;
};

export type UsePropertyFieldsResult = HoldingTypeForm & {
  currency: Currency;
  category: PropertyCategory;
  setCategory: (value: PropertyCategory) => void;
  cost: string;
  setCost: (value: string) => void;
  ownership: PropertyOwnershipFields;
  fieldErrors: PropertyFieldErrors;
  reasonKey: PropertyReasonKey | null;
  refs: {
    costFieldRef: RefObject<FieldInstance | null>;
    costInputRef: RefObject<TextInputInstance | null>;
    ownershipFieldRef: RefObject<FieldInstance | null>;
    ownershipInputRef: RefObject<TextInputInstance | null>;
  };
};

/**
 * Owns every property_item form field: the category/cost state, the ORIGINAL
 * (hydrated) lots carried unchanged through an edit, the ownership share, the
 * per-field validation reason, the edit-mode seed, and the create/edit
 * payload builders — extracted out of `HoldingFormScreen` the same way
 * `useBondFields` did for the bond form.
 */
export const usePropertyFields = (params: UsePropertyFieldsParams): UsePropertyFieldsResult => {
  const { isEdit, currency } = params;

  const [category, setCategory] = useState<PropertyCategory>('real_estate');
  // `cost` is CREATE-only (`PropertySection` hides its field in edit mode —
  // cost/quantity history is fixed at creation; a later revaluation goes
  // through the dedicated "Update value" form instead). `lots` holds the
  // ORIGINAL (hydrated) lots in edit mode, carried through unchanged on save
  // so an edit never rewrites cost/quantity history.
  const [cost, setCost] = useState('');
  const [lots, setLots] = useState<Lot[]>([]);
  // The stored share changes and the share they put in effect today; an
  // edit that hides the field (a loan given) still writes the list back.
  const [storedOwnership, setStoredOwnership] = useState<OwnershipChange[]>([]);
  const [currentShare, setCurrentShare] = useState<OwnershipShare>(WHOLE_SHARE);
  const [entry, setEntry] = useState<OwnershipEntry>(() =>
    ownershipEntryOf('percent', WHOLE_SHARE),
  );
  const [effectiveDate, setEffectiveDate] = useState(() => startOfLocalDay(Date.now()));

  const costFieldRef = useRef<FieldInstance>(null);
  const costInputRef = useRef<TextInputInstance>(null);
  const ownershipFieldRef = useRef<FieldInstance>(null);
  const ownershipInputRef = useRef<TextInputInstance>(null);

  const applies = ownershipApplies(category);
  const entered = enteredShare(entry, currentShare);
  const validation = { isEdit, cost, ownershipApplies: applies, ownership: entered };
  const fieldErrors = propertyFieldErrors(validation);
  const reasonKey = propertyReasonKey(validation);
  const appliedShare = applies ? entered : null;

  const updateEntry = (patch: Partial<OwnershipEntry>): void =>
    setEntry((previous) => ({ ...previous, ...patch }));

  const seed = useCallback((holding: HoldingRow): void => {
    // The Type-as-category field must pre-select SOMETHING sensible even
    // when the metadata's `lots` are otherwise unparseable — read leniently
    // (falls back to 'other'), independent of the strict all-or-nothing
    // `asPropertyMeta` parse below.
    setCategory(propertyCategoryOf(holding.metadata));

    const meta = asPropertyMeta(holding.metadata);

    if (meta === null) {
      return;
    }

    const stored = meta.ownership ?? [];
    const current = ownershipAt(stored, Date.now());

    setLots(meta.lots);
    setStoredOwnership(stored);
    setCurrentShare(current);
    setEntry(ownershipEntryOf(meta.ownershipInput ?? 'percent', current));
  }, []);

  const createPayload = (): CreatePayload =>
    buildPropertyCreatePayload({
      category,
      currency,
      cost,
      share: appliedShare ?? WHOLE_SHARE,
      ownershipInput: entry.mode,
    });

  const saveEdit = (context: EditContext): Promise<void> => {
    const ownership = ownershipAfterEdit({
      stored: storedOwnership,
      current: currentShare,
      entered: appliedShare,
      effectiveDate,
    });

    return saveMetadataEdit(context, {
      category,
      lots,
      ...ownershipMetadata(ownership, entry.mode),
    });
  };

  return {
    currency,
    category,
    setCategory,
    cost,
    setCost,
    ownership: {
      applies,
      mode: entry.mode,
      setMode: (mode) => updateEntry({ mode }),
      percent: entry.percent,
      setPercent: (percent) => updateEntry({ percent }),
      numerator: entry.numerator,
      setNumerator: (numerator) => updateEntry({ numerator }),
      denominator: entry.denominator,
      setDenominator: (denominator) => updateEntry({ denominator }),
      showsEffectiveDate: isEdit && shareChanged(appliedShare, currentShare),
      effectiveDate,
      setEffectiveDate,
    },
    fieldErrors,
    reasonKey,
    isValid: reasonKey === null,
    scrollTargets: [
      {
        invalid: fieldErrors.costError !== null,
        ref: costFieldRef,
        focus: () => costInputRef.current?.focus(),
      },
      {
        invalid: fieldErrors.ownershipError !== null,
        ref: ownershipFieldRef,
        focus: () => ownershipInputRef.current?.focus(),
      },
    ],
    createPayload,
    saveEdit,
    seed,
    refs: { costFieldRef, costInputRef, ownershipFieldRef, ownershipInputRef },
  };
};
