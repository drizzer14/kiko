import { buildPriceBook, EMPTY_PRICE_BOOK } from '../../prices/price-book';
import { holdingInstrument } from '../../prices/instrument';

import {
  isPricedHoldingType,
  pricedHoldingTypes,
  pricedValueMinor,
  type PricedHolding,
} from './priced-value';

const DAY = 24 * 60 * 60 * 1000;
const day2024 = Date.UTC(2024, 0, 1);
const day2026 = Date.UTC(2026, 0, 1);

const property = (over: Record<string, unknown> = {}): PricedHolding => ({
  id: 'p1',
  type: 'property_item',
  currency: 'UAH',
  metadata: {
    category: 'real_estate',
    lots: [{ day: day2024, quantityDelta: '1', costMinorUnits: 18_000_00 }],
    ...over,
  },
});

describe('pricedHoldingTypes / isPricedHoldingType', () => {
  it('includes property_item', () => {
    expect(pricedHoldingTypes).toContain('property_item');
    expect(isPricedHoldingType('property_item')).toBe(true);
  });

  it('excludes an interest-based ledgerless type (bond)', () => {
    expect(isPricedHoldingType('bond')).toBe(false);
  });
});

describe('pricedValueMinor', () => {
  it('values a property at its earlier price point, then the later one once its day arrives', () => {
    const book = buildPriceBook([
      {
        instrument: holdingInstrument('p1'),
        day: day2024,
        price: '20000',
        currency: 'UAH',
        source: 'manual',
      },
      {
        instrument: holdingInstrument('p1'),
        day: day2026,
        price: '16000',
        currency: 'UAH',
        source: 'manual',
      },
    ]);
    const holding = property();

    // Between the two points (mid-2025): the 2024 point carries forward.
    expect(pricedValueMinor(holding, book, day2024 + 200 * DAY)).toBe(2_000_000);
    // On/after the 2026 point.
    expect(pricedValueMinor(holding, book, day2026)).toBe(1_600_000);
  });

  it('returns null when the instrument has no stored price point yet (Review Focus 5)', () => {
    const holding = property();

    expect(pricedValueMinor(holding, EMPTY_PRICE_BOOK, day2024)).toBeNull();
  });

  it('returns null for a holding with no valid lots metadata', () => {
    const holding = property({ lots: 'not-an-array' });
    const book = buildPriceBook([
      {
        instrument: holdingInstrument('p1'),
        day: day2024,
        price: '20000',
        currency: 'UAH',
        source: 'manual',
      },
    ]);

    expect(pricedValueMinor(holding, book, day2024)).toBeNull();
  });

  it('returns null for a holding with no id — it cannot resolve its own instrument key', () => {
    const holding = property({});
    const { id: _id, ...withoutId } = holding;
    const book = buildPriceBook([
      {
        instrument: holdingInstrument('p1'),
        day: day2024,
        price: '20000',
        currency: 'UAH',
        source: 'manual',
      },
    ]);

    expect(pricedValueMinor(withoutId, book, day2024)).toBeNull();
  });
});
