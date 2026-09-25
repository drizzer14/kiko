import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';

import type { ValuableHolding } from '../holding-value';
import { bondDescriptor } from '../holding-descriptor/bond';
import { metalDescriptor } from '../holding-descriptor/metal';
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

const entriesForType = (
  holding: IdentifiedHolding,
  now: number,
  t: TFunction,
): readonly DerivedEntry[] =>
  match(holding)
    .with({ type: 'term_deposit' }, (deposit) => termDepositDescriptor.entries(deposit, now, t))
    .with({ type: 'bond' }, (bond) => bondDescriptor.entries(bond, now, t))
    .with({ type: 'metal' }, (metal) => metalDescriptor.entries(metal, now, t))
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
