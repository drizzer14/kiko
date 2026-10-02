import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { quantityAt } from '@kiko/holdings/lots';
import { multiplyToMinorUnits } from '@kiko/currency/decimal';
import { entityColorsDark } from '@kiko/design-system/palette';
import type { PricedHolding } from '@kiko/holdings/priced-value';
import { priceAt, type PriceBook } from '@kiko/prices/price-book';
import type { DerivedEntry } from '@kiko/holdings/derived-entries';
import type { ValuableHolding } from '@kiko/holdings/holding-value';
import { holdingInstrument, shareInstrument } from '@kiko/prices/instrument';
import { asShareMeta, type ShareMeta } from '@kiko/holdings/holding-metadata';

import { lotEntries } from '../entry-parts';
import { pricedDescriptor } from '../priced-parts';
import type { HoldingDescriptor, PricedSpec } from '../holding-descriptor.d';

// An EODHD share reads the symbol's series every holding of that symbol
// shares; a manual share reads only the prices entered on this holding.
const shareSeries = (meta: ShareMeta, holdingId: string): string =>
  match(meta)
    .with({ quoteSource: 'eodhd' }, ({ symbol }) => shareInstrument(symbol))
    .with({ quoteSource: 'manual' }, () => holdingInstrument(holdingId))
    .exhaustive();

// The Money carries the price point's own currency, so `pricedBreakdown`
// (`../priced-parts`) can fall back to cost basis when it disagrees with the
// holding currency, the same guard a metal relies on.
const shareValue = (holding: PricedHolding, book: PriceBook, instant: number): Money | null => {
  const meta = asShareMeta(holding.metadata);

  if (meta === null) {
    return null;
  }

  const point = priceAt(book, shareSeries(meta, holding.id), instant);

  if (point === undefined) {
    return null;
  }

  const minorUnits = multiplyToMinorUnits(
    [quantityAt(meta.lots, instant), point.price],
    point.currency,
  );

  return Money.of(point.currency, minorUnits);
};

const sharePricedSpec: PricedSpec = {
  lots: (metadata) => asShareMeta(metadata)?.lots,
  value: shareValue,
};

const shareEntries = (holding: ValuableHolding, now: number, t: TFunction): DerivedEntry[] =>
  foldMap(maybe(asShareMeta(holding.metadata)), (meta) =>
    lotEntries(meta.lots, holding.id, now, t, true),
  ) ?? [];

// The broker kind's glyph and color: a share lives only under a broker, the
// same kind-and-type reuse `property_item` and `metal` follow.
export const shareDescriptor: HoldingDescriptor = pricedDescriptor(sharePricedSpec, {
  symbol: 'chart.line.uptrend.xyaxis',
  defaultColor: entityColorsDark.teal,
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
  entries: shareEntries,
});
