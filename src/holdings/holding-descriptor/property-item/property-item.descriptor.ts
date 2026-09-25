import { quantityAt } from '../../lots';
import { pricedBreakdown } from '../priced-parts';
import type { HoldingRow } from '../../../db/schema';
import { asPropertyMeta } from '../../holding-metadata';
import type { PricedHolding } from '../../priced-value';
import { holdingInstrument } from '../../../prices/instrument';
import { multiplyToMinorUnits } from '../../../currency/decimal';
import { entityColorsDark } from '../../../design-system/palette';
import { priceAt, type PriceBook } from '../../../prices/price-book';
import type { HoldingDescriptor, PricedSpec } from '../holding-descriptor.d';

// `quantityAt(lots, instant)` times the price point for the holding's own
// `holding:<id>` instrument at or before that day (`priceAt` — the local-day
// convention). Returns `null` for invalid metadata or a missing price point.
const propertyItemValueMinor = (
  holding: PricedHolding & { id: string },
  book: PriceBook,
  instant: number,
): number | null => {
  const meta = asPropertyMeta(holding.metadata);
  if (meta === null) {
    return null;
  }
  const point = priceAt(book, holdingInstrument(holding.id), instant);
  if (point === undefined) {
    return null;
  }
  const quantity = quantityAt(meta.lots, instant);
  return multiplyToMinorUnits([quantity, point.price], holding.currency);
};

export const propertyItemPricedSpec: PricedSpec = {
  lots: (metadata) => asPropertyMeta(metadata)?.lots,
  valueMinor: propertyItemValueMinor,
  captionInstrument: (holding: HoldingRow) => holdingInstrument(holding.id),
  captionKey: 'holdingDetail.valueAsOf',
};

export const propertyItemDescriptor: HoldingDescriptor = {
  symbol: 'house.fill',
  defaultColor: entityColorsDark.brown,
  side: 'asset',
  ledgerless: true,
  timeExempt: false,
  fixedCurrency: null,
  exchange: {
    receivePath: 'excluded',
    source: false,
    createSource: false,
    createDestination: false,
  },
  priced: propertyItemPricedSpec,
  breakdown: (holding, now, book) => pricedBreakdown(propertyItemPricedSpec, holding, now, book),
  entries: () => [],
};
