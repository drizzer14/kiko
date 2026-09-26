import type { HoldingRow } from '@kiko/db';

import type { Money } from '../../currency/money';
import { holdingsRepo } from '../repo/holdings.repo';
import { holdingDescriptorOrUndefined } from '../holding-descriptor';
import { EMPTY_PRICE_BOOK, type PriceBook } from '../../prices/price-book';
import { flat, type HoldingValueBreakdown } from '../holding-descriptor/breakdown-parts';

/** Every real holding row has an `id`; this `Pick` requires it too. */
export type ValuableHolding = Pick<
  HoldingRow,
  'type' | 'currency' | 'balanceMinorUnits' | 'metadata' | 'id'
>;

export type { HoldingValueBreakdown };

export const holdingValueBreakdown = (
  holding: ValuableHolding,
  now: number,
  book: PriceBook = EMPTY_PRICE_BOOK,
): HoldingValueBreakdown => {
  const descriptor = holdingDescriptorOrUndefined(holding.type);

  // A malformed or absent `type` (the schema's enum column is a TypeScript-only
  // guarantee — SQLite enforces no such constraint) falls back to the flat
  // stored balance instead of throwing, the same tolerance the old `ts-pattern`
  // dispatch's `.otherwise()` gave.
  if (descriptor === undefined) {
    return flat(holding.currency, holdingsRepo.balanceOf(holding).minorUnits);
  }

  return descriptor.breakdown(holding, now, book);
};

export const holdingValue = (
  holding: ValuableHolding,
  now: number,
  book: PriceBook = EMPTY_PRICE_BOOK,
): Money => holdingValueBreakdown(holding, now, book).net;
