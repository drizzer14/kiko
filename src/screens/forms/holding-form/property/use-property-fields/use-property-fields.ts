import type { RefObject } from 'react';
import {
  asPropertyMeta,
  propertyCategoryOf,
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
import { currencyScale, type Currency } from '@kiko/currency/currency';

import { saveMetadataEdit } from '../../save-metadata-edit';
import type { FieldInstance } from '../../../scroll-to-field/scroll-to-field';
import type { CreatePayload, EditContext, HoldingTypeForm } from '../../holding-type-form';

import {
  propertyFieldErrors,
  propertyReasonKey,
  type PropertyFieldErrors,
  type PropertyReasonKey,
} from './property-reasons';

// The property CREATE payload: a `property_item` writes a zero stored
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
}): CreatePayload => {
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

type UsePropertyFieldsParams = {
  isEdit: boolean;
  currency: Currency;
};

export type UsePropertyFieldsResult = HoldingTypeForm & {
  currency: Currency;
  category: PropertyCategory;
  setCategory: (value: PropertyCategory) => void;
  cost: string;
  setCost: (value: string) => void;
  fieldErrors: PropertyFieldErrors;
  reasonKey: PropertyReasonKey | null;
  refs: {
    costFieldRef: RefObject<FieldInstance | null>;
    costInputRef: RefObject<TextInputInstance | null>;
  };
};

/**
 * Owns every property_item form field: the category/cost state, the ORIGINAL
 * (hydrated) lots carried unchanged through an edit, the per-field
 * validation reason, the edit-mode seed, and the create/edit payload
 * builders — extracted out of `HoldingFormScreen` the same way
 * `useBondFields` did for the bond form.
 */
export const usePropertyFields = (params: UsePropertyFieldsParams): UsePropertyFieldsResult => {
  const { isEdit, currency } = params;

  const [category, setCategory] = useState<PropertyCategory>('real_estate');
  // `cost` is CREATE-only (`PropertySection` hides its field in edit mode —
  // cost/quantity history is fixed at creation; a later revaluation goes
  // through the dedicated "Update value" form instead). `lots` holds the
  // ORIGINAL (hydrated) lots in edit mode, carried through unchanged on save
  // so an edit never rewrites cost/quantity history — only `category` is
  // user-editable there.
  const [cost, setCost] = useState('');
  const [lots, setLots] = useState<Lot[]>([]);

  const costFieldRef = useRef<FieldInstance>(null);
  const costInputRef = useRef<TextInputInstance>(null);

  const fieldErrors = propertyFieldErrors({ isEdit, cost });
  const reasonKey = propertyReasonKey({ isEdit, cost });

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

    setLots(meta.lots);
  }, []);

  const createPayload = (): CreatePayload =>
    buildPropertyCreatePayload({ category, currency, cost });

  const saveEdit = (context: EditContext): Promise<void> =>
    saveMetadataEdit(context, { category, lots });

  return {
    currency,
    category,
    setCategory,
    cost,
    setCost,
    fieldErrors,
    reasonKey,
    isValid: reasonKey === null,
    scrollTargets: [
      {
        invalid: fieldErrors.costError !== null,
        ref: costFieldRef,
        focus: () => costInputRef.current?.focus(),
      },
    ],
    createPayload,
    saveEdit,
    seed,
    refs: { costFieldRef, costInputRef },
  };
};
