import type { RefObject } from 'react';
import {
  asBondMeta,
  type BondKind,
  type BondMeta,
  type BondCouponFrequency,
} from '@kiko/holdings/holding-metadata';
import { Money } from '@kiko/currency/money';
import type { HoldingRow } from '@kiko/db/schema';
import { parseAmount } from '@kiko/currency/parse';
import { useCallback, useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import type { Currency } from '@kiko/currency/currency';
import type { BondTerms } from '@kiko/bonds/nbu-register';
import type { HoldingType } from '@kiko/holdings/holding-type';

import { saveMetadataEdit } from '../../save-metadata-edit';
import { useBondIsinMode, type IsinReasonKey } from '../use-bond-isin-mode';
import type { FieldInstance } from '../../../scroll-to-field/scroll-to-field';
import type { BondEntryMode } from '../bond-isin-section/bond-isin-section.props';
import { groupAmount, majorAmountText } from '../../../amount-format/amount-format';
import type { CreatePayload, EditContext, HoldingTypeForm } from '../../holding-type-form';

import {
  bondFieldErrors,
  bondReasonKey,
  type BondFieldErrors,
  type BondReasonKey,
} from './bond-reasons';

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
  // Edit mode always opens Manual, with the stored ISIN (or ''
  // for a bond saved before this field existed) shown and still editable.
  isin: meta.isin ?? '',
});

type UseBondFieldsParams = {
  type: HoldingType;
  isEdit: boolean;
  currency: Currency;
  setCurrency: (value: Currency) => void;
  setName: (value: string) => void;
};

export type UseBondFieldsResult = HoldingTypeForm & {
  currency: Currency;
  quantity: string;
  setQuantity: (value: string) => void;
  faceValue: string;
  setFaceValue: (value: string) => void;
  couponPct: string;
  setCouponPct: (value: string) => void;
  purchasePrice: string;
  setPurchasePrice: (value: string) => void;
  purchaseDate: number | null;
  setPurchaseDate: (value: number) => void;
  maturityDate: number | null;
  setMaturityDate: (value: number) => void;
  bondKind: BondKind;
  setBondKind: (value: BondKind) => void;
  couponFrequency: BondCouponFrequency;
  setCouponFrequency: (value: BondCouponFrequency) => void;
  bondMode: BondEntryMode;
  setBondMode: (value: BondEntryMode) => void;
  isin: string;
  setIsin: (value: string) => void;
  registerTerms: BondTerms | null;
  registerLoaded: boolean;
  isinReasonKey: IsinReasonKey | null;
  needsCouponFrequencyPick: boolean;
  pickedCouponFrequency: BondCouponFrequency | null;
  setPickedCouponFrequency: (frequency: BondCouponFrequency) => void;
  fieldErrors: BondFieldErrors;
  reasonKey: BondReasonKey | null;
  refs: {
    isinFieldRef: RefObject<FieldInstance | null>;
    quantityFieldRef: RefObject<FieldInstance | null>;
    faceValueFieldRef: RefObject<FieldInstance | null>;
    couponPctFieldRef: RefObject<FieldInstance | null>;
    purchaseDateFieldRef: RefObject<FieldInstance | null>;
    maturityDateFieldRef: RefObject<FieldInstance | null>;
    isinInputRef: RefObject<TextInputInstance | null>;
    quantityInputRef: RefObject<TextInputInstance | null>;
    faceValueInputRef: RefObject<TextInputInstance | null>;
    couponPctInputRef: RefObject<TextInputInstance | null>;
  };
};

/**
 * Owns every bond form field: the numeric/date state, the ISIN/Manual mode
 * (via `useBondIsinMode`), the per-field validation reasons, the edit-mode
 * seed, and the create/edit payload builders — extracted out of
 * `HoldingFormScreen` the same way `useTermDepositFields` did for the
 * term-deposit form.
 */
export const useBondFields = (params: UseBondFieldsParams): UseBondFieldsResult => {
  const { type, isEdit, currency, setCurrency, setName } = params;

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

  const isinFieldRef = useRef<FieldInstance>(null);
  const quantityFieldRef = useRef<FieldInstance>(null);
  const faceValueFieldRef = useRef<FieldInstance>(null);
  const couponPctFieldRef = useRef<FieldInstance>(null);
  const purchaseDateFieldRef = useRef<FieldInstance>(null);
  const maturityDateFieldRef = useRef<FieldInstance>(null);
  const isinInputRef = useRef<TextInputInstance>(null);
  const quantityInputRef = useRef<TextInputInstance>(null);
  const faceValueInputRef = useRef<TextInputInstance>(null);
  const couponPctInputRef = useRef<TextInputInstance>(null);

  // The Bond form's "ISIN / Manual" mode — its own state,
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
      // Stored as a record of how the holding was added; the
      // save is blocked by `isinReasonKey` while Manual mode's own ISIN is
      // non-empty but invalid, so a saved value is always well-formed. Left
      // out entirely for a blank Manual-mode ISIN, rather than an empty
      // string, so `asBondMeta`'s optional field round-trips as `undefined`.
      // `isin` itself is already normalized (`useBondIsinMode`'s own
      // `setIsin` wrapper) — a second `normalizeIsin` call here was a
      // redundant third normalization.
      ...(isin.trim() === '' ? {} : { isin }),
    };
  };

  const fieldErrors = bondFieldErrors({
    quantity,
    faceValue,
    couponPct,
    purchaseDate,
    maturityDate,
  });
  const reasonKey = bondReasonKey({ quantity, faceValue, couponPct, purchaseDate, maturityDate });

  // A bond ALSO needs a valid ISIN and, while `needsCouponFrequencyPick` (an
  // unmapped-frequency ISIN-mode match), a picked coupon frequency — never
  // guess one, so Save stays blocked until `pickedCouponFrequency`
  // is set. Everything else is `reasonKey` alone, so the two can never
  // disagree.
  const isValid =
    isinReasonKey === null &&
    !(needsCouponFrequencyPick && pickedCouponFrequency === null) &&
    reasonKey === null;

  const seed = useCallback(
    (holding: HoldingRow): void => {
      const meta = asBondMeta(holding.metadata);

      if (meta === null) {
        return;
      }

      const fields = seedBondFields(meta, holding.currency);
      setQuantity(fields.quantity);
      setFaceValue(fields.faceValue);
      setCouponPct(fields.couponPct);
      setPurchasePrice(fields.purchasePrice);
      setPurchaseDate(fields.purchaseDate);
      setMaturityDate(fields.maturityDate);
      setBondKind(fields.bondKind);
      setCouponFrequency(fields.couponFrequency);
      setIsin(fields.isin);
      // Edit always opens Manual — the register is never
      // consulted again once a holding is saved.
      setBondMode('manual');
    },
    [setIsin, setBondMode],
  );

  // Ledgerless: a bond's value derives entirely from its lots/schedule, never
  // a typed opening balance — the stored balance is always 0, the same as
  // property/metal/loan.
  const createPayload = (): CreatePayload => ({
    metadata: buildBondMetadata(),
  });

  const saveEdit = (context: EditContext): Promise<void> =>
    saveMetadataEdit(context, buildBondMetadata());

  return {
    currency,
    quantity,
    setQuantity,
    faceValue,
    setFaceValue,
    couponPct,
    setCouponPct,
    purchasePrice,
    setPurchasePrice,
    purchaseDate,
    setPurchaseDate,
    maturityDate,
    setMaturityDate,
    bondKind,
    setBondKind,
    couponFrequency,
    setCouponFrequency,
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
    fieldErrors,
    reasonKey,
    isValid,
    scrollTargets: [
      {
        invalid: isinReasonKey !== null,
        ref: isinFieldRef,
        focus: () => isinInputRef.current?.focus(),
      },
      {
        // The ISIN-mode-only coupon-frequency picker renders inside
        // `BondIsinSection`, just below the ISIN field — reusing its ref
        // lands the scroll close enough with no separate wrapper needed.
        invalid: needsCouponFrequencyPick && pickedCouponFrequency === null,
        ref: isinFieldRef,
      },
      {
        invalid: fieldErrors.quantityError !== null,
        ref: quantityFieldRef,
        focus: () => quantityInputRef.current?.focus(),
      },
      {
        invalid: fieldErrors.faceValueError !== null,
        ref: faceValueFieldRef,
        focus: () => faceValueInputRef.current?.focus(),
      },
      {
        invalid: fieldErrors.couponPctError !== null,
        ref: couponPctFieldRef,
        focus: () => couponPctInputRef.current?.focus(),
      },
      { invalid: fieldErrors.purchaseDateError !== null, ref: purchaseDateFieldRef },
      {
        // See `purchaseDateErrorMessage`'s own doc comment (`bond-form-block`)
        // for why ISIN mode's scroll target is the purchase date, not
        // maturity.
        invalid: fieldErrors.maturityDateError !== null,
        ref: bondMode === 'isin' ? purchaseDateFieldRef : maturityDateFieldRef,
      },
    ],
    createPayload,
    saveEdit,
    seed,
    refs: {
      isinFieldRef,
      quantityFieldRef,
      faceValueFieldRef,
      couponPctFieldRef,
      purchaseDateFieldRef,
      maturityDateFieldRef,
      isinInputRef,
      quantityInputRef,
      faceValueInputRef,
      couponPctInputRef,
    },
  };
};
