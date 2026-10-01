import { i18n } from '@kiko/i18n/init';
import { holdingInstrument, shareInstrument } from '@kiko/prices/instrument';
import { buildPriceBook, dayKeyOf, EMPTY_PRICE_BOOK } from '@kiko/prices/price-book';
import { holdingValueBreakdown, type ValuableHolding } from '@kiko/holdings/holding-value';

import { shareDescriptor } from './share.descriptor';

const buyDay = new Date(2026, 8, 1).getTime();
const sellDay = new Date(2026, 8, 10).getTime();
const NOW = new Date(2026, 8, 20).getTime();

const share = (metadata: Record<string, unknown>): ValuableHolding => ({
  id: 'share-1',
  type: 'share',
  currency: 'USD',
  balanceMinorUnits: 0,
  metadata: {
    lots: [{ day: buyDay, quantityDelta: '3', costMinorUnits: 90_000 }],
    ...metadata,
  },
});

const eodhdShare = (metadata: Record<string, unknown> = {}) =>
  share({ quoteSource: 'eodhd', symbol: 'AAPL.US', ...metadata });

const manualShare = (metadata: Record<string, unknown> = {}) =>
  share({ quoteSource: 'manual', ...metadata });

const point = (instrument: string, price: string, currency: 'USD' | 'UAH' = 'USD') => ({
  instrument,
  day: buyDay,
  price,
  currency,
  source: 'manual' as const,
});

describe('shareDescriptor value', () => {
  it("values an EODHD share from its symbol's shared price series", () => {
    const book = buildPriceBook([point(shareInstrument('AAPL.US'), '325.13')]);

    const breakdown = holdingValueBreakdown(eodhdShare(), NOW, book);

    expect(breakdown.gross.currency).toBe('USD');
    expect(breakdown.gross.minorUnits).toBe(97_539);
    expect(breakdown.principalOrCost.minorUnits).toBe(90_000);
  });

  it("values a manual share from the holding's own price series", () => {
    const book = buildPriceBook([point(holdingInstrument('share-1'), '310.50')]);

    expect(holdingValueBreakdown(manualShare(), NOW, book).gross.minorUnits).toBe(93_150);
  });

  it("never reads the other price source's series", () => {
    const book = buildPriceBook([
      point(holdingInstrument('share-1'), '1000'),
      point(shareInstrument('AAPL.US'), '2000'),
    ]);

    expect(holdingValueBreakdown(eodhdShare(), NOW, book).gross.minorUnits).toBe(600_000);
    expect(
      holdingValueBreakdown(manualShare({ symbol: 'AAPL.US' }), NOW, book).gross.minorUnits,
    ).toBe(300_000);
  });

  it('values a share with no price yet at its cost basis', () => {
    const breakdown = holdingValueBreakdown(eodhdShare(), NOW, EMPTY_PRICE_BOOK);

    expect(breakdown.gross.minorUnits).toBe(90_000);
    expect(breakdown.principalOrCost.minorUnits).toBe(90_000);
  });

  it("values a share at its cost basis when the price is in another currency than the holding's", () => {
    const book = buildPriceBook([point(shareInstrument('AAPL.US'), '325.13', 'UAH')]);

    const breakdown = holdingValueBreakdown(eodhdShare(), NOW, book);

    expect(breakdown.gross.currency).toBe('USD');
    expect(breakdown.gross.minorUnits).toBe(90_000);
  });

  it('never values a share below zero when its sells exceed its buys', () => {
    const book = buildPriceBook([point(shareInstrument('AAPL.US'), '100')]);
    const oversold = eodhdShare({
      lots: [
        { day: buyDay, quantityDelta: '3', costMinorUnits: 90_000 },
        { day: sellDay, quantityDelta: '-5', costMinorUnits: -90_000 },
      ],
    });

    expect(holdingValueBreakdown(oversold, NOW, book).gross.minorUnits).toBe(0);
  });

  it('falls back to the stored balance for unparsable metadata', () => {
    const broken = { ...eodhdShare({ quoteSource: 'yahoo' }), balanceMinorUnits: 1_234 };

    expect(holdingValueBreakdown(broken, NOW, EMPTY_PRICE_BOOK).gross.minorUnits).toBe(1_234);
  });
});

describe('shareDescriptor entries', () => {
  it('lists a buy lot as a purchase and a sell lot as a sale, each naming its lot', () => {
    const holding = manualShare({
      lots: [
        { day: dayKeyOf(buyDay), quantityDelta: '3', costMinorUnits: 90_000 },
        { day: dayKeyOf(sellDay), quantityDelta: '-1', costMinorUnits: -30_000 },
      ],
    });

    const entries = shareDescriptor.entries(holding, NOW, i18n.t, []);

    expect(entries).toEqual([
      expect.objectContaining({
        kind: 'purchase',
        time: buyDay,
        amountMinorUnits: -90_000,
        label: 'Purchase',
        lotIndex: 0,
      }),
      expect.objectContaining({
        kind: 'sale',
        time: sellDay,
        amountMinorUnits: 30_000,
        label: 'Sale',
        lotIndex: 1,
      }),
    ]);
  });

  it('lists a buy at no cost as a split, and a buy at any cost as a purchase', () => {
    const holding = manualShare({
      lots: [
        { day: dayKeyOf(buyDay), quantityDelta: '3', costMinorUnits: 1 },
        { day: dayKeyOf(sellDay), quantityDelta: '9', costMinorUnits: 0 },
      ],
    });

    const entries = shareDescriptor.entries(holding, NOW, i18n.t, []);

    expect(entries.map(({ kind, label }) => ({ kind, label }))).toEqual([
      { kind: 'purchase', label: 'Purchase' },
      { kind: 'purchase', label: 'Split' },
    ]);
  });

  // A lot's day is a UTC-midnight key of a local date, so the row reads that
  // local date in every zone, west of UTC too.
  it('dates a lot row at the local midnight of its day', () => {
    const day = dayKeyOf(new Date(2026, 8, 1).getTime());
    const holding = manualShare({
      lots: [{ day, quantityDelta: '3', costMinorUnits: 90_000 }],
    });

    expect(shareDescriptor.entries(holding, NOW, i18n.t, [])[0].time).toBe(
      new Date(2026, 8, 1).getTime(),
    );
  });

  it('lists nothing for unparsable metadata', () => {
    expect(shareDescriptor.entries(share({ lots: 'x' }), NOW, i18n.t, [])).toEqual([]);
  });
});
