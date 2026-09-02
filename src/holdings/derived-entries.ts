import { asBondMeta, asTermDepositMeta } from './holding-metadata';
import { holdingValueBreakdown, type ValuableHolding } from './holding-value';

export type DerivedEntryKind = 'contribution' | 'interest' | 'tax' | 'purchase' | 'coupon';

export type DerivedEntry = {
  id: string;
  time: number;
  amountMinorUnits: number;
  label: string;
  kind: DerivedEntryKind;
  derived: true;
};

type IdentifiedHolding = ValuableHolding & { id: string };

const entry = (
  holdingId: string,
  kind: DerivedEntryKind,
  index: number,
  time: number,
  amountMinorUnits: number,
): DerivedEntry => ({
  id: `derived:${holdingId}:${kind}:${index}`,
  time,
  amountMinorUnits,
  label: `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`,
  kind,
  derived: true,
});

const depositEntries = (holding: IdentifiedHolding, now: number): DerivedEntry[] => {
  const meta = asTermDepositMeta(holding.metadata);
  if (meta === null) {
    return [];
  }
  const breakdown = holdingValueBreakdown(holding, now);
  const entries = meta.contributions.map((contribution, index) =>
    entry(holding.id, 'contribution', index, contribution.date, contribution.amountMinorUnits),
  );
  if (breakdown.interest.minorUnits > 0) {
    entries.push(entry(holding.id, 'interest', 0, now, breakdown.interest.minorUnits));
  }
  if (breakdown.tax.minorUnits > 0) {
    entries.push(entry(holding.id, 'tax', 0, now, -breakdown.tax.minorUnits));
  }
  return entries;
};

const bondEntries = (holding: IdentifiedHolding, now: number): DerivedEntry[] => {
  const meta = asBondMeta(holding.metadata);
  if (meta === null) {
    return [];
  }
  const breakdown = holdingValueBreakdown(holding, now);
  const nominalMinorUnits = meta.quantity * meta.faceValueMinorUnits;
  const entries = [entry(holding.id, 'purchase', 0, meta.purchaseDate, nominalMinorUnits)];
  if (breakdown.interest.minorUnits > 0) {
    entries.push(entry(holding.id, 'coupon', 0, now, breakdown.interest.minorUnits));
  }
  if (breakdown.tax.minorUnits > 0) {
    entries.push(entry(holding.id, 'tax', 0, now, -breakdown.tax.minorUnits));
  }
  return entries;
};

export const derivedEntries = (holding: IdentifiedHolding, now: number): DerivedEntry[] => {
  const entries =
    holding.type === 'term_deposit'
      ? depositEntries(holding, now)
      : holding.type === 'bond'
        ? bondEntries(holding, now)
        : [];
  return [...entries].sort((a, b) => a.time - b.time);
};
