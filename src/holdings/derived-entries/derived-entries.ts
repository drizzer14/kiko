import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';

import { taxOnInterestMinor } from '../tax';
import { Money, toMajor } from '../../currency/money';
import { compareDecimal } from '../../currency/decimal';
import type { ValuableHolding } from '../holding-value';
import { asBondMeta, asMetalMeta } from '../holding-metadata';
import { makeEntry } from '../holding-descriptor/entry-parts';
import { bondCouponDates, bondCouponMajor } from '../interest';
import { termDepositDescriptor } from '../holding-descriptor/term-deposit';

export type DerivedEntryKind =
  | 'contribution'
  | 'accrual'
  | 'income-tax'
  | 'military-levy'
  | 'capitalization'
  | 'interest'
  | 'tax'
  | 'purchase'
  | 'coupon'
  | 'redemption'
  | 'sale';

export type EntryTone = 'positive' | 'negative' | 'neutral';

export type DerivedEntry = {
  id: string;
  time: number;
  amountMinorUnits: number;
  label: string;
  kind: DerivedEntryKind;
  tone: EntryTone;
  // A projected entry dated after `now` — a future accrual/coupon/capitalization
  // or a scheduled future contribution. The ledger renders these dimmed as
  // "Projected".
  isFuture: boolean;
  derived: true;
};

type IdentifiedHolding = ValuableHolding & { id: string };

const bondEntries = (holding: IdentifiedHolding, now: number, t: TFunction): DerivedEntry[] => {
  const meta = asBondMeta(holding.metadata);
  if (meta === null) {
    return [];
  }
  const { currency } = holding;
  const nominalMinorUnits = meta.quantity * meta.faceValueMinorUnits;
  const nominalMajor = toMajor(nominalMinorUnits, currency);
  const grossCouponMinor = Money.fromMajor(
    currency,
    bondCouponMajor(nominalMajor, meta.couponPct, meta.couponFrequency),
  ).minorUnits;
  // Each coupon pays out net of the corporate 23% withholding (government bonds
  // are untaxed). The bank credits the net amount, so that is the ledger entry.
  const netCouponMinor =
    grossCouponMinor - (meta.bondKind === 'corporate' ? taxOnInterestMinor(grossCouponMinor) : 0);
  const couponDates = bondCouponDates(meta.purchaseDate, meta.maturityDate, meta.couponFrequency);

  // Purchase (money out), each coupon (money in, net), and redemption of the
  // nominal at maturity (money in). Past entries render as real ledger rows;
  // entries dated after `now` render dimmed as projected.
  return [
    makeEntry(
      holding.id,
      'purchase',
      0,
      meta.purchaseDate,
      -meta.purchasePriceMinorUnits,
      t('holdingDetail.purchase'),
      now,
    ),
    ...couponDates.map((couponDate, index) =>
      makeEntry(
        holding.id,
        'coupon',
        index,
        couponDate,
        netCouponMinor,
        t('holdingDetail.coupon'),
        now,
      ),
    ),
    makeEntry(
      holding.id,
      'redemption',
      0,
      meta.maturityDate,
      nominalMinorUnits,
      t('holdingDetail.redemption'),
      now,
    ),
  ];
};

// A metal holding's buy/sell history (T18's Lot form) as ledger rows: one per
// stored lot, oldest first with the rest of the list re-sorted by
// `derivedEntries` below. A buy lot (positive `quantityDelta`) reads as a
// 'purchase' entry, a sell lot (negative `quantityDelta`) as a 'sale' entry —
// `compareDecimal` reads the SIGNED decimal string rather than trusting a
// bare string comparison. Both entries' `amountMinorUnits` is the NEGATION of
// the lot's own stored `costMinorUnits`: `lots.ts`'s contract stores a buy's
// `costMinorUnits` positive (money paid) and a sell's negative (cost basis
// removed), so negating it once here yields the money-out/money-in sign the
// bond purchase/redemption entries already use, with no separate branch per
// direction needed.
const metalEntries = (holding: IdentifiedHolding, now: number, t: TFunction): DerivedEntry[] => {
  const meta = asMetalMeta(holding.metadata);
  if (meta === null) {
    return [];
  }

  return meta.lots.map((lot, index) => {
    const isSale = compareDecimal(lot.quantityDelta, '0') < 0;

    return makeEntry(
      holding.id,
      isSale ? 'sale' : 'purchase',
      index,
      lot.day,
      -lot.costMinorUnits,
      isSale ? t('holdingDetail.sale') : t('holdingDetail.purchase'),
      now,
    );
  });
};

const entriesForType = (
  holding: IdentifiedHolding,
  now: number,
  t: TFunction,
): readonly DerivedEntry[] =>
  match(holding)
    .with({ type: 'term_deposit' }, (deposit) => termDepositDescriptor.entries(deposit, now, t))
    .with({ type: 'bond' }, (bond) => bondEntries(bond, now, t))
    .with({ type: 'metal' }, (metal) => metalEntries(metal, now, t))
    // Not `.exhaustive()`: the original if-chain's trailing, unconditional
    // `return []` tolerated any unmatched `type`, not only the other 6
    // literal types — a malformed or absent `type` derives no lifecycle
    // entries instead of throwing.
    .otherwise(() => []);

// The derived lifecycle entries for a holding, sorted oldest-first. Entries that
// share an instant (an accrual and its two withholding lines and any
// capitalization on the same date) keep their emitted order under the stable
// sort. Not a React component (a plain render-time helper the caller's own
// `useTranslation()` feeds `t` into), so every label re-resolves against the
// active language on every call rather than freezing to a module-load-time
// language.
export const derivedEntries = (
  holding: IdentifiedHolding,
  now: number,
  t: TFunction,
): DerivedEntry[] => [...entriesForType(holding, now, t)].sort((a, b) => a.time - b.time);
