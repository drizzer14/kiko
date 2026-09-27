import type { RefObject } from 'react';
import {
  asBondMeta,
  type BondKind,
  type BondMeta,
  type BondEntryMode,
  type BondCouponFrequency,
  hasStoredBondPurchasePrice,
} from '@kiko/holdings/holding-metadata';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { parseAmount } from '@kiko/currency/parse';
import { holdingsRepo } from '@kiko/holdings/repo';
import { useCallback, useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import type { Currency } from '@kiko/currency/currency';
import type { BondTerms } from '@kiko/bonds/nbu-register';
import type { HoldingType } from '@kiko/holdings/holding-type';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import { groupAmount, majorAmountText } from '@kiko/screens/forms/amount-format';

import { useBondIsinMode, type IsinReasonKey } from '../use-bond-isin-mode';
import type { CreatePayload, EditContext, HoldingTypeForm } from '../../holding-type-form';

import {
  bondFieldErrors,
  bondReasonKey,
  type BondFieldErrors,
  type BondReasonKey,
} from './bond-reasons';
import {
  bondPurchaseTotal,
  pricePerBondText,
  type SeededPurchasePrice,
} from './bond-purchase-price';
import { bondPaymentsOnSave, type SavedBond } from './bond-payments-on-save';

// A bond saved before `entryMode` was stored does not say which mode it came
// from. An ISIN with a kept register schedule is the best sign of an
// ISIN-mode save; every other such bond opens Manual.
const legacyEntryMode = (meta: BondMeta): BondEntryMode =>
  meta.isin !== undefined && (meta.payments?.length ?? 0) > 0 ? 'isin' : 'manual';

// Seed the bond number/date fields from stored metadata. Minor-unit money
// fields (face value, price per bond) convert back to grouped major strings;
// plain-number fields (quantity, coupon %) render verbatim. A bond stored
// without a price seeds a blank one, not `asBondMeta`'s nominal default, so
// re-saving it unchanged never invents a price.
const seedBondFields = (meta: BondMeta, currency: Currency, hasStoredPrice: boolean) => ({
  quantity: groupAmount(String(meta.quantity)),
  faceValue: groupAmount(majorAmountText(currency, meta.faceValueMinorUnits)),
  couponPct: String(meta.couponPct),
  purchasePrice: hasStoredPrice
    ? pricePerBondText(meta.purchasePriceMinorUnits, meta.quantity, currency)
    : '',
  purchaseDate: meta.purchaseDate,
  maturityDate: meta.maturityDate,
  bondKind: meta.bondKind,
  couponFrequency: meta.couponFrequency,
  // Shown and still editable in either mode; '' for a bond saved without one.
  isin: meta.isin ?? '',
  bondMode: meta.entryMode ?? legacyEntryMode(meta),
});

type UseBondFieldsParams = {
  type: HoldingType;
  isEdit: boolean;
  currency: Currency;
  setCurrency: (value: Currency) => void;
  name: string;
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
    purchasePriceFieldRef: RefObject<FieldInstance | null>;
    faceValueFieldRef: RefObject<FieldInstance | null>;
    couponPctFieldRef: RefObject<FieldInstance | null>;
    purchaseDateFieldRef: RefObject<FieldInstance | null>;
    maturityDateFieldRef: RefObject<FieldInstance | null>;
    isinInputRef: RefObject<TextInputInstance | null>;
    quantityInputRef: RefObject<TextInputInstance | null>;
    purchasePriceInputRef: RefObject<TextInputInstance | null>;
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
  const { type, isEdit, currency, setCurrency, name, setName } = params;

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
  const purchasePriceFieldRef = useRef<FieldInstance>(null);
  const faceValueFieldRef = useRef<FieldInstance>(null);
  const couponPctFieldRef = useRef<FieldInstance>(null);
  const purchaseDateFieldRef = useRef<FieldInstance>(null);
  const maturityDateFieldRef = useRef<FieldInstance>(null);
  const isinInputRef = useRef<TextInputInstance>(null);
  const quantityInputRef = useRef<TextInputInstance>(null);
  const purchasePriceInputRef = useRef<TextInputInstance>(null);
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
    seedStoredIsin,
  } = useBondIsinMode({
    type,
    isEdit,
    currency,
    name,
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

  // The bond as stored when the edit form seeded, to tell which fields the
  // user changed; null on create.
  const savedBondRef = useRef<SavedBond | null>(null);
  const seededPurchasePriceRef = useRef<SeededPurchasePrice | null>(null);

  const buildBondMetadata = (saved: SavedBond | null): Record<string, unknown> => {
    const quantityValue = parseAmount(quantity) || 0;
    const faceValueMinorUnits = Money.fromMajor(currency, parseAmount(faceValue) || 0).minorUnits;
    const purchasePriceMinorUnits = bondPurchaseTotal({
      quantity,
      pricePerBond: purchasePrice,
      currency,
      seeded: seededPurchasePriceRef.current,
    });
    const couponValue = parseAmount(couponPct) || 0;
    const payments = bondPaymentsOnSave({
      bondMode,
      registerTerms,
      saved,
      next: {
        isin: isin.trim() === '' ? undefined : isin,
        currency,
        faceValueMinorUnits,
        couponPct: couponValue,
        couponFrequency,
      },
    });

    return {
      quantity: quantityValue,
      faceValueMinorUnits,
      couponPct: couponValue,
      // The total actually paid, while the form takes the price of one bond. A
      // blank one is left out, not stored as the nominal: `asBondMeta` still
      // reads it as nominal (par), so the purchase entry and expected profit
      // read as break-even, while the yield to maturity, which needs the real
      // price, shows none.
      ...foldMap(maybe(purchasePriceMinorUnits), (total) => ({ purchasePriceMinorUnits: total })),
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
      entryMode: bondMode,
      ...foldMap(maybe(payments), (schedule) => ({ payments: schedule })),
    };
  };

  const validationParams = {
    quantity,
    purchasePrice,
    purchasePriceRequired: bondMode === 'isin',
    faceValue,
    couponPct,
    purchaseDate,
    maturityDate,
  };
  const fieldErrors = bondFieldErrors(validationParams);
  const reasonKey = bondReasonKey(validationParams);

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

      savedBondRef.current = { meta, currency: holding.currency };
      const hasStoredPrice = hasStoredBondPurchasePrice(holding.metadata);
      const fields = seedBondFields(meta, holding.currency, hasStoredPrice);
      seededPurchasePriceRef.current = hasStoredPrice
        ? {
            quantity: fields.quantity,
            pricePerBond: fields.purchasePrice,
            totalMinorUnits: meta.purchasePriceMinorUnits,
          }
        : null;
      setQuantity(fields.quantity);
      setFaceValue(fields.faceValue);
      setCouponPct(fields.couponPct);
      setPurchasePrice(fields.purchasePrice);
      setPurchaseDate(fields.purchaseDate);
      setMaturityDate(fields.maturityDate);
      setBondKind(fields.bondKind);
      setCouponFrequency(fields.couponFrequency);
      seedStoredIsin({ isin: fields.isin, couponFrequency: fields.couponFrequency });
      setBondMode(fields.bondMode);
    },
    [seedStoredIsin, setBondMode],
  );

  // Ledgerless: a bond's value derives entirely from its lots/schedule, never
  // a typed opening balance — the stored balance is always 0, the same as
  // property/metal/loan.
  const createPayload = (): CreatePayload => ({
    metadata: buildBondMetadata(null),
  });

  // The schedule comes from the row as stored at the time of the write, not
  // the seed: this form's own register refresh can keep one in the row after
  // the seed, and Save must not write the seed back over it.
  const saveEdit = (context: EditContext): Promise<void> =>
    holdingsRepo.updateMetadataFromStored(
      context.holdingId,
      { name: context.name, color: context.color },
      (storedMetadata) =>
        buildBondMetadata(
          foldMap(maybe(savedBondRef.current), (seeded) => ({
            ...seeded,
            meta: { ...seeded.meta, payments: asBondMeta(storedMetadata)?.payments },
          })) ?? null,
        ),
    );

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
        invalid: fieldErrors.purchasePriceError !== null,
        ref: purchasePriceFieldRef,
        focus: () => purchasePriceInputRef.current?.focus(),
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
      purchasePriceFieldRef,
      faceValueFieldRef,
      couponPctFieldRef,
      purchaseDateFieldRef,
      maturityDateFieldRef,
      isinInputRef,
      quantityInputRef,
      purchasePriceInputRef,
      faceValueInputRef,
      couponPctInputRef,
    },
  };
};
