import type { TFunction } from 'i18next';

import type { ValuableHolding } from '../holding-value';
import { holdingDescriptorOrUndefined } from '../holding-descriptor';

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

const entriesForType = (
  holding: ValuableHolding,
  now: number,
  t: TFunction,
): readonly DerivedEntry[] => {
  const descriptor = holdingDescriptorOrUndefined(holding.type);

  // A malformed or absent `type` derives no lifecycle entries, the same
  // tolerance the original if-chain's trailing, unconditional `return []`
  // gave.
  if (descriptor === undefined) {
    return [];
  }

  return descriptor.entries(holding, now, t);
};

// The derived lifecycle entries for a holding, sorted oldest-first. Entries that
// share an instant (an accrual and its two withholding lines and any
// capitalization on the same date) keep their emitted order under the stable
// sort. Not a React component (a plain render-time helper the caller's own
// `useTranslation()` feeds `t` into), so every label re-resolves against the
// active language on every call rather than freezing to a module-load-time
// language.
export const derivedEntries = (
  holding: ValuableHolding,
  now: number,
  t: TFunction,
): DerivedEntry[] => [...entriesForType(holding, now, t)].sort((a, b) => a.time - b.time);
