import { match } from 'ts-pattern';

import type { DerivedEntry, DerivedEntryKind, EntryTone } from '../../derived-entries';

// The ledger tone a derived entry reads in: withholding lines are `negative`
// (red), interest/coupon accruals are `positive` (green), and the principal
// movements (a deposit contribution, a bond purchase/redemption) stay `neutral`
// so only genuine gains and taxes carry color. Classified by KIND, not by the
// sign of the amount, so an entry always reads the same regardless of sign.
const toneForKind = (kind: DerivedEntryKind): EntryTone =>
  match(kind)
    .with('income-tax', 'military-levy', 'tax', (): EntryTone => 'negative')
    .with('accrual', 'interest', 'capitalization', 'coupon', (): EntryTone => 'positive')
    .with('contribution', 'purchase', 'redemption', 'sale', (): EntryTone => 'neutral')
    .exhaustive();

export const makeEntry = (
  holdingId: string,
  kind: DerivedEntryKind,
  index: number,
  time: number,
  amountMinorUnits: number,
  label: string,
  now: number,
): DerivedEntry => ({
  id: `derived:${holdingId}:${kind}:${index}`,
  time,
  amountMinorUnits,
  label,
  kind,
  tone: toneForKind(kind),
  isFuture: time > now,
  derived: true,
});
