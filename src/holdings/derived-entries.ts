import { Money, toMajor } from '../currency/money';
import { asBondMeta, asTermDepositMeta } from './holding-metadata';
import { holdingValueBreakdown, type ValuableHolding } from './holding-value';
import { bondCouponDates, bondCouponMajor } from './interest';
import { taxOnInterestMinor } from './tax';

export type DerivedEntryKind =
  | 'contribution'
  | 'interest'
  | 'tax'
  | 'purchase'
  | 'coupon'
  | 'redemption';

export type DerivedEntry = {
  id: string;
  time: number;
  amountMinorUnits: number;
  label: string;
  kind: DerivedEntryKind;
  // A projected entry dated after `now` — a future coupon or redemption, or a
  // scheduled future contribution. The ledger renders these dimmed/disabled.
  isFuture: boolean;
  derived: true;
};

type IdentifiedHolding = ValuableHolding & { id: string };

const LABELS: Record<DerivedEntryKind, string> = {
  contribution: 'Contribution',
  interest: 'Interest',
  tax: 'Tax',
  purchase: 'Purchase',
  coupon: 'Coupon',
  redemption: 'Redemption',
};

const entry = (
  holdingId: string,
  kind: DerivedEntryKind,
  index: number,
  time: number,
  amountMinorUnits: number,
  now: number,
): DerivedEntry => ({
  id: `derived:${holdingId}:${kind}:${index}`,
  time,
  amountMinorUnits,
  label: LABELS[kind],
  kind,
  isFuture: time > now,
  derived: true,
});

const depositEntries = (holding: IdentifiedHolding, now: number): DerivedEntry[] => {
  const meta = asTermDepositMeta(holding.metadata);
  if (meta === null) {
    return [];
  }
  const breakdown = holdingValueBreakdown(holding, now);
  const entries = meta.contributions.map((contribution, index) =>
    entry(holding.id, 'contribution', index, contribution.date, contribution.amountMinorUnits, now),
  );
  if (breakdown.interest.minorUnits > 0) {
    entries.push(entry(holding.id, 'interest', 0, now, breakdown.interest.minorUnits, now));
  }
  if (breakdown.tax.minorUnits > 0) {
    entries.push(entry(holding.id, 'tax', 0, now, -breakdown.tax.minorUnits, now));
  }
  return entries;
};

const bondEntries = (holding: IdentifiedHolding, now: number): DerivedEntry[] => {
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
  // entries dated after `now` render dimmed/disabled.
  return [
    entry(holding.id, 'purchase', 0, meta.purchaseDate, -meta.purchasePriceMinorUnits, now),
    ...couponDates.map((couponDate, index) =>
      entry(holding.id, 'coupon', index, couponDate, netCouponMinor, now),
    ),
    entry(holding.id, 'redemption', 0, meta.maturityDate, nominalMinorUnits, now),
  ];
};

const entriesForType = (holding: IdentifiedHolding, now: number): DerivedEntry[] => {
  if (holding.type === 'term_deposit') {
    return depositEntries(holding, now);
  }
  if (holding.type === 'bond') {
    return bondEntries(holding, now);
  }
  return [];
};

export const derivedEntries = (holding: IdentifiedHolding, now: number): DerivedEntry[] =>
  [...entriesForType(holding, now)].sort((a, b) => a.time - b.time);
