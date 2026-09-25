import type { TFunction } from 'i18next';

import { quantityAt } from '../../lots';
import { makeEntry } from '../entry-parts';
import { pricedBreakdown } from '../priced-parts';
import { asMetalMeta } from '../../holding-metadata';
import type { HoldingRow } from '../../../db/schema';
import type { PricedHolding } from '../../priced-value';
import type { DerivedEntry } from '../../derived-entries';
import type { Currency } from '../../../currency/currency';
import { metalInstrument } from '../../../prices/instrument';
import { entityColorsDark } from '../../../design-system/palette';
import { priceAt, type PriceBook } from '../../../prices/price-book';
import { compareDecimal, multiplyToMinorUnits } from '../../../currency/decimal';
import type { HoldingDescriptor, IdentifiedHolding, PricedSpec } from '../holding-descriptor.d';

// NBU quotes precious metals in UAH, so a metal holding's priced value is
// always a UAH amount regardless of `holding.currency`.
const METAL_FIXED_CURRENCY: Currency = 'UAH';

// One troy ounce in grams (NBU quotes precious metals per troy ounce). A
// 'g'-unit lot's quantity is converted to ounces by dividing by this constant
// inside `multiplyToMinorUnits`'s BigInt-backed division, never a float
// multiply; an 'oz'-unit lot needs no conversion.
const TROY_OUNCE_GRAMS = '31.1034768';

// A metal holding's value: `quantityAt(lots, instant)` times `purity` times
// the price point for the metal's SHARED `metal:<XAU|XAG|XPT|XPD>` instrument
// (not a per-holding one — every holding of the same metal reads the same
// NBU-sourced points). Returns `null` for invalid metadata or a missing
// price point.
const metalValueMinor = (
  holding: PricedHolding & { id: string },
  book: PriceBook,
  instant: number,
): number | null => {
  const meta = asMetalMeta(holding.metadata);
  if (meta === null) {
    return null;
  }
  const point = priceAt(book, metalInstrument(meta.metal), instant);
  if (point === undefined) {
    return null;
  }
  const quantity = quantityAt(meta.lots, instant);
  return multiplyToMinorUnits(
    [quantity, meta.purity, point.price],
    METAL_FIXED_CURRENCY,
    meta.unit === 'g' ? TROY_OUNCE_GRAMS : undefined,
  );
};

const metalCaptionInstrument = (holding: HoldingRow): string | null => {
  const meta = asMetalMeta(holding.metadata);
  if (meta === null) {
    return null;
  }
  return metalInstrument(meta.metal);
};

export const metalPricedSpec: PricedSpec = {
  lots: (metadata) => asMetalMeta(metadata)?.lots,
  valueMinor: metalValueMinor,
  captionInstrument: metalCaptionInstrument,
  captionKey: 'holdingDetail.priceAsOf',
};

// A metal holding's buy/sell history as ledger rows: one per stored lot,
// oldest first with the rest of the list re-sorted by `derivedEntries`
// (`src/holdings/derived-entries/`). A buy lot (positive `quantityDelta`)
// reads as a 'purchase' entry, a sell lot (negative `quantityDelta`) as a
// 'sale' entry — `compareDecimal` reads the SIGNED decimal string rather
// than trusting a bare string comparison. Both entries' `amountMinorUnits`
// is the NEGATION of the lot's own stored `costMinorUnits`: `lots.ts`'s
// contract stores a buy's `costMinorUnits` positive (money paid) and a
// sell's negative (cost basis removed), so negating it once here yields the
// money-out/money-in sign the bond purchase/redemption entries already use,
// with no separate branch per direction needed.
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

export const metalDescriptor: HoldingDescriptor = {
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
  priced: metalPricedSpec,
  breakdown: (holding, now, book) => pricedBreakdown(metalPricedSpec, holding, now, book),
  entries: metalEntries,
};
