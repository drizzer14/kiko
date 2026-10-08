import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { quantityAt } from '@kiko/holdings/lots';
import type { Currency } from '@kiko/currency/currency';
import { metalInstrument } from '@kiko/prices/instrument';
import { asMetalMeta } from '@kiko/holdings/holding-metadata';
import { multiplyToMinorUnits } from '@kiko/currency/decimal';
import { entityColorsDark } from '@kiko/design-system/palette';
import type { PricedHolding } from '@kiko/holdings/priced-value';
import { priceAt, type PriceBook } from '@kiko/prices/price-book';
import type { DerivedEntry } from '@kiko/holdings/derived-entries';
import type { ValuableHolding } from '@kiko/holdings/holding-value';

import { lotEntries } from '../entry-parts';
import { pricedDescriptor } from '../priced-parts';
import type { HoldingDescriptor, PricedSpec } from '../holding-descriptor.d';

// The create form's fixed currency for a metal holding — UAH, matching NBU's
// own metal quotes.
const METAL_FIXED_CURRENCY: Currency = 'UAH';

// One troy ounce in grams (NBU quotes precious metals per troy ounce). A
// 'g'-unit lot's quantity is converted to ounces by dividing by this constant
// inside `multiplyToMinorUnits`'s BigInt-backed division, never a float
// multiply; an 'oz'-unit lot needs no conversion.
const TROY_OUNCE_GRAMS = '31.1034768';

// A metal holding's value: `quantityAt(lots, instant)` times `purity` times
// the price point for the metal's SHARED `metal:<XAU|XAG|XPT|XPD>` instrument
// (not a per-holding one — every holding of the same metal reads the same
// NBU-sourced points, so this needs no `id` at all, unlike `property_item`).
// The Money carries the PRICE POINT's own stored `currency` (always UAH in
// practice, since NBU quotes precious metals only in UAH) rather than
// `holding.currency` — the two can disagree for an invalid/restore-only row,
// and `pricedBreakdown` (`../priced-parts`) is the one place that decides
// whether a mismatch is safe to surface. Returns `null` for invalid metadata
// or a missing price point.
const metalValue = (holding: PricedHolding, book: PriceBook, instant: number): Money | null => {
  const meta = asMetalMeta(holding.metadata);

  if (meta === null) {
    return null;
  }
  const point = priceAt(book, metalInstrument(meta.metal), instant);

  if (point === undefined) {
    return null;
  }
  const quantity = quantityAt(meta.lots, instant);
  const minorUnits = multiplyToMinorUnits(
    [quantity, meta.purity, point.price],
    point.currency,
    meta.unit === 'g' ? TROY_OUNCE_GRAMS : undefined,
  );

  return Money.of(point.currency, minorUnits);
};

const metalPricedSpec: PricedSpec = {
  lots: (metadata) => asMetalMeta(metadata)?.lots,
  value: metalValue,
};

const metalEntries = (holding: ValuableHolding, now: number, t: TFunction): DerivedEntry[] =>
  foldMap(maybe(asMetalMeta(holding.metadata)), (meta) =>
    lotEntries(meta.lots, holding.id, now, t),
  ) ?? [];

export const metalDescriptor: HoldingDescriptor = pricedDescriptor(metalPricedSpec, {
  symbol: 'cube.fill',
  defaultColor: entityColorsDark.gray,
  side: 'asset',
  ledgerless: true,
  timeExempt: false,
  fixedCurrency: METAL_FIXED_CURRENCY,
  exchange: {
    receivePath: 'excluded',
    source: false,
    createSource: false,
    createDestination: false,
  },
  entries: metalEntries,
});
