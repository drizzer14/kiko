import type { RefObject } from 'react';
import {
  asMetalMeta,
  type Metal,
  type MetalForm,
  type MetalUnit,
} from '@kiko/holdings/holding-metadata';
import type { HoldingRow } from '@kiko/db';
import { Money } from '@kiko/currency/money';
import type { Lot } from '@kiko/holdings/lots';
import { parseAmount } from '@kiko/currency/parse';
import { dayKeyOf } from '@kiko/prices/price-book';
import { useCallback, useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import { normalizeDecimal, shiftDecimal, trimDecimal } from '@kiko/currency/decimal';

import { saveMetadataEdit } from '../../save-metadata-edit';
import type { CreatePayload, EditContext, HoldingTypeForm } from '../../holding-type-form';

import {
  metalFieldErrors,
  metalReasonKey,
  type MetalFieldErrors,
  type MetalReasonKey,
} from './metal-reasons';

// The pre-filled purity — the standard bar/coin fineness, per mille — shown
// before the user types anything of their own.
const DEFAULT_METAL_PURITY = '999.9';

// The field shows a fineness per mille; `MetalMeta.purity` stores the 0..1
// ratio. Both directions shift the decimal point exactly (never a float).
const PER_MILLE_PLACES = 3;

const finenessOf = (purity: string): string => trimDecimal(shiftDecimal(purity, PER_MILLE_PLACES));

// Both metal-metadata builders below only ever run once `metalReasonKey`
// has already confirmed `normalizeDecimal(value)` parses — a `null` result
// here can only mean that validation gate itself has a bug, never a value
// the user actually typed, so this throws instead of silently substituting
// `DEFAULT_METAL_PURITY` for whatever the user entered.
const normalizedPurityOrThrow = (fineness: string): string => {
  const normalized = normalizeDecimal(fineness);

  if (normalized === null) {
    throw new Error('Metal purity failed to parse after passing Save validation');
  }

  return trimDecimal(shiftDecimal(normalized, -PER_MILLE_PLACES));
};

type MetalFields = {
  metal: Metal;
  form: MetalForm;
  unit: MetalUnit;
  purity: string;
  quantity: string;
  cost: string;
};

// The metal CREATE payload: a `metal` holding writes a zero stored
// balance (its value lives entirely in `metadata.lots` / the SHARED
// `metal:<XAU|XAG|XPT|XPD>` price series — kiko-pricing) and one lot dated
// today for the entered quantity/cost. Unlike a property's create payload,
// no `firstPricePoint` is written: a metal's price comes from the metal-wide
// instrument (backfilled by `refreshMetalPrices`), never a per-holding one —
// see `asMetalMeta`'s own contract for why `quantityDelta`/`purity` are kept
// as the exact decimal STRINGS the user typed (`normalizeDecimal`), never
// round-tripped through a parsed `number`.
const buildMetalCreatePayload = (fields: MetalFields): CreatePayload => {
  const { metal, form, unit, purity, quantity, cost } = fields;
  const day = dayKeyOf(Date.now());
  const lot: Lot = {
    day,
    quantityDelta: normalizeDecimal(quantity) ?? '0',
    costMinorUnits: Money.fromMajor('UAH', parseAmount(cost) || 0).minorUnits,
  };

  return {
    metadata: {
      metal,
      form,
      unit,
      purity: normalizedPurityOrThrow(purity),
      lots: [lot],
    },
  };
};

type UseMetalFieldsParams = {
  isEdit: boolean;
};

export type UseMetalFieldsResult = HoldingTypeForm & {
  metal: Metal;
  setMetal: (value: Metal) => void;
  form: MetalForm;
  setForm: (value: MetalForm) => void;
  unit: MetalUnit;
  setUnit: (value: MetalUnit) => void;
  purity: string;
  setPurity: (value: string) => void;
  quantity: string;
  setQuantity: (value: string) => void;
  cost: string;
  setCost: (value: string) => void;
  fieldErrors: MetalFieldErrors;
  reasonKey: MetalReasonKey | null;
  refs: {
    purityFieldRef: RefObject<FieldInstance | null>;
    quantityFieldRef: RefObject<FieldInstance | null>;
    costFieldRef: RefObject<FieldInstance | null>;
    purityInputRef: RefObject<TextInputInstance | null>;
    quantityInputRef: RefObject<TextInputInstance | null>;
    costInputRef: RefObject<TextInputInstance | null>;
  };
};

/**
 * Owns every metal form field: the element/form/unit/purity/first-lot
 * state, the ORIGINAL (hydrated) lots carried unchanged through an edit,
 * the per-field validation reason, the edit-mode seed, and the create/edit
 * payload builders — extracted out of `HoldingFormScreen` the same way
 * `usePropertyFields` did for the property form. Unlike bond/property/
 * deposit, a metal holding's value is hard-fixed to UAH (NBU quotes
 * precious metals only in UAH — kiko-pricing), so this hook takes no
 * `currency` param.
 */
export const useMetalFields = (params: UseMetalFieldsParams): UseMetalFieldsResult => {
  const { isEdit } = params;

  const [metal, setMetal] = useState<Metal>('XAU');
  const [form, setForm] = useState<MetalForm>('bar');
  const [unit, setUnit] = useState<MetalUnit>('oz');
  const [purity, setPurity] = useState(DEFAULT_METAL_PURITY);
  // `quantity`/`cost` are CREATE-only (`MetalSection` hides its first-lot
  // fields in edit mode — quantity/cost history is fixed at creation; a
  // later buy/sell goes through the dedicated Lot form instead). `lots`
  // holds the ORIGINAL (hydrated) lots in edit mode, carried through
  // unchanged on save.
  const [quantity, setQuantity] = useState('');
  const [cost, setCost] = useState('');
  const [lots, setLots] = useState<Lot[]>([]);

  const purityFieldRef = useRef<FieldInstance>(null);
  const quantityFieldRef = useRef<FieldInstance>(null);
  const costFieldRef = useRef<FieldInstance>(null);
  const purityInputRef = useRef<TextInputInstance>(null);
  const quantityInputRef = useRef<TextInputInstance>(null);
  const costInputRef = useRef<TextInputInstance>(null);

  const fieldErrors = metalFieldErrors({ isEdit, purity, quantity, cost });
  const reasonKey = metalReasonKey({ isEdit, purity, quantity, cost });

  const seed = useCallback((holding: HoldingRow): void => {
    const meta = asMetalMeta(holding.metadata);

    if (meta === null) {
      return;
    }

    setMetal(meta.metal);
    setForm(meta.form);
    setUnit(meta.unit);
    setPurity(finenessOf(meta.purity));
    setLots(meta.lots);
  }, []);

  const createPayload = (): CreatePayload =>
    buildMetalCreatePayload({ metal, form, unit, purity, quantity, cost });

  const saveEdit = (context: EditContext): Promise<void> =>
    saveMetadataEdit(context, {
      metal,
      form,
      unit,
      purity: normalizedPurityOrThrow(purity),
      lots,
    });

  return {
    metal,
    setMetal,
    form,
    setForm,
    unit,
    setUnit,
    purity,
    setPurity,
    quantity,
    setQuantity,
    cost,
    setCost,
    fieldErrors,
    reasonKey,
    isValid: reasonKey === null,
    scrollTargets: [
      {
        invalid: fieldErrors.purityError !== null,
        ref: purityFieldRef,
        focus: () => purityInputRef.current?.focus(),
      },
      {
        invalid: fieldErrors.quantityError !== null,
        ref: quantityFieldRef,
        focus: () => quantityInputRef.current?.focus(),
      },
      {
        invalid: fieldErrors.costError !== null,
        ref: costFieldRef,
        focus: () => costInputRef.current?.focus(),
      },
    ],
    createPayload,
    saveEdit,
    seed,
    refs: {
      purityFieldRef,
      quantityFieldRef,
      costFieldRef,
      purityInputRef,
      quantityInputRef,
      costInputRef,
    },
  };
};
