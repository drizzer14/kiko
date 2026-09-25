import { P, match } from 'ts-pattern';

import type { Money } from '../../currency/money';
import type { HoldingRow } from '../../db/schema';
import { isPricedHoldingType } from '../priced-value';
import { loanDescriptor } from '../holding-descriptor/loan';
import { bondDescriptor } from '../holding-descriptor/bond';
import { metalPricedSpec } from '../holding-descriptor/metal';
import { pricedBreakdown } from '../holding-descriptor/priced-parts';
import { termDepositDescriptor } from '../holding-descriptor/term-deposit';
import { EMPTY_PRICE_BOOK, type PriceBook } from '../../prices/price-book';
import { propertyItemPricedSpec } from '../holding-descriptor/property-item';
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

// A priced type's own spec, keyed off `holding.type` directly rather than a
// registry (B7 adds one): `metal` reads the shared `metal:<XAU|...>`
// instrument; every OTHER priced type (today only `property_item`) reads its
// own `holding:<id>` instrument, mirroring `pricedLotsOf`'s old fallback.
const pricedSpecFor = (type: ValuableHolding['type']) =>
  type === 'metal' ? metalPricedSpec : propertyItemPricedSpec;

export const holdingValueBreakdown = (
  holding: ValuableHolding,
  now: number,
  book: PriceBook = EMPTY_PRICE_BOOK,
): HoldingValueBreakdown =>
  match(holding.type)
    .with(P.when(isPricedHoldingType), () =>
      pricedBreakdown(pricedSpecFor(holding.type), holding, now, book),
    )
    .with('term_deposit', () => termDepositDescriptor.breakdown(holding, now, book))
    .with('bond', () => bondDescriptor.breakdown(holding, now, book))
    .with('loan', () => loanDescriptor.breakdown(holding, now, book))
    // Not `.exhaustive()`: the original `switch`'s `default` branch tolerated
    // any unmatched value, not only the 3 other named literal types — a
    // malformed or absent `type` falls back to the flat stored balance
    // instead of throwing.
    .otherwise(() => flat(holding.currency, holding.balanceMinorUnits));

export const holdingValue = (
  holding: ValuableHolding,
  now: number,
  book: PriceBook = EMPTY_PRICE_BOOK,
): Money => holdingValueBreakdown(holding, now, book).net;
