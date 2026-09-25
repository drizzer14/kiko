import type { Money } from '../../currency/money';
import type { HoldingRow } from '../../db/schema';
import { holdingDescriptorOrUndefined } from '../holding-descriptor';
import { EMPTY_PRICE_BOOK, type PriceBook } from '../../prices/price-book';
import { flat, type HoldingValueBreakdown } from '../holding-descriptor/breakdown-parts';

/**
 * `id` is optional — mirroring `PricedHolding` (`src/holdings/priced-value/`)
 * — so every existing test fixture across the app's holding-value suites
 * (a synthetic cash/deposit/bond literal with no real row) keeps compiling
 * unchanged. A PRICED holding (`isPricedHoldingType`) needs its own `id` to
 * resolve its `holding:<id>` instrument key; one with no `id` simply reads as
 * having no stored price point (falls back to its lots' cost basis).
 */
export type ValuableHolding = Pick<
  HoldingRow,
  'type' | 'currency' | 'balanceMinorUnits' | 'metadata'
> & { id?: HoldingRow['id'] };

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
    return flat(holding.currency, holding.balanceMinorUnits);
  }

  return descriptor.breakdown(holding, now, book);
};

export const holdingValue = (
  holding: ValuableHolding,
  now: number,
  book: PriceBook = EMPTY_PRICE_BOOK,
): Money => holdingValueBreakdown(holding, now, book).net;
