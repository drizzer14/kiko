import { quantityAt } from '../../lots';
import { Money } from '../../../currency/money';
import { pricedDescriptor } from '../priced-parts';
import { asPropertyMeta } from '../../holding-metadata';
import type { PricedHolding } from '../../priced-value';
import { holdingInstrument } from '../../../prices/instrument';
import { multiplyToMinorUnits } from '../../../currency/decimal';
import { entityColorsDark } from '../../../design-system/palette';
import { priceAt, type PriceBook } from '../../../prices/price-book';
import type { HoldingDescriptor, PricedSpec } from '../holding-descriptor.d';

// `quantityAt(lots, instant)` times the price point for the holding's own
// `holding:<id>` instrument at or before that day (`priceAt` — the local-day
// convention), as Money in the holding's OWN currency (a per-holding manual
// revaluation, always entered in that currency). Returns `null` for invalid
// metadata or a missing price point.
const propertyItemValue = (
  holding: PricedHolding,
  book: PriceBook,
  instant: number,
): Money | null => {
  const meta = asPropertyMeta(holding.metadata);

  if (meta === null) {
    return null;
  }
  const point = priceAt(book, holdingInstrument(holding.id), instant);

  if (point === undefined) {
    return null;
  }
  const quantity = quantityAt(meta.lots, instant);
  const minorUnits = multiplyToMinorUnits([quantity, point.price], holding.currency);

  return Money.of(holding.currency, minorUnits);
};

const propertyItemPricedSpec: PricedSpec = {
  lots: (metadata) => asPropertyMeta(metadata)?.lots,
  value: propertyItemValue,
};

export const propertyItemDescriptor: HoldingDescriptor = pricedDescriptor(propertyItemPricedSpec, {
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
  entries: () => [],
});
