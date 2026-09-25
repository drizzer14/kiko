import { buildPriceBook, EMPTY_PRICE_BOOK } from '../../prices/price-book';
import { holdingInstrument, metalInstrument } from '../../prices/instrument';

import { isPricedHoldingType, pricedValue, type PricedHolding } from './priced-value';

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

const goldBar = (over: Record<string, unknown> = {}): PricedHolding => ({
  id: 'm1',
  type: 'metal',
  currency: 'UAH',
  metadata: {
    metal: 'XAU',
    form: 'bar',
    unit: 'g',
    purity: '1',
    lots: [{ day: day2024, quantityDelta: '31.1034768', costMinorUnits: 5_000_000 }],
    ...over,
  },
});

describe('isPricedHoldingType', () => {
  it('includes property_item and metal', () => {
    expect(isPricedHoldingType('property_item')).toBe(true);
    expect(isPricedHoldingType('metal')).toBe(true);
  });

  it('excludes an interest-based ledgerless type (bond)', () => {
    expect(isPricedHoldingType('bond')).toBe(false);
  });
});

describe('pricedValue', () => {
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
    expect(pricedValue(holding, book, day2024 + 200 * DAY)?.minorUnits).toBe(2_000_000);
    // On/after the 2026 point.
    expect(pricedValue(holding, book, day2026)?.minorUnits).toBe(1_600_000);
  });

  it('returns null when the instrument has no stored price point yet', () => {
    const holding = property();

    expect(pricedValue(holding, EMPTY_PRICE_BOOK, day2024)).toBeNull();
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

    expect(pricedValue(holding, book, day2024)).toBeNull();
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

    expect(pricedValue(withoutId, book, day2024)).toBeNull();
  });

  it('values a gram-denominated metal lot by converting to troy ounces (31.1034768g at purity 1 = 1oz x price)', () => {
    const book = buildPriceBook([
      {
        instrument: metalInstrument('XAU'),
        day: day2024,
        price: '90000',
        currency: 'UAH',
        source: 'nbu',
      },
    ]);
    const holding = goldBar();

    // 31.1034768g at purity 1 is exactly one troy ounce, so the value is
    // exactly one unit of the per-ounce NBU price.
    expect(pricedValue(holding, book, day2024)?.minorUnits).toBe(9_000_000);
  });

  it('values an ounce-denominated metal lot with no unit conversion', () => {
    const book = buildPriceBook([
      {
        instrument: metalInstrument('XAG'),
        day: day2024,
        price: '1000',
        currency: 'UAH',
        source: 'nbu',
      },
    ]);
    const holding = goldBar({
      metal: 'XAG',
      unit: 'oz',
      lots: [{ day: day2024, quantityDelta: '2', costMinorUnits: 200_000 }],
    });

    expect(pricedValue(holding, book, day2024)?.minorUnits).toBe(200_000);
  });

  it('scales a metal value by purity below 1', () => {
    const book = buildPriceBook([
      {
        instrument: metalInstrument('XAU'),
        day: day2024,
        price: '90000',
        currency: 'UAH',
        source: 'nbu',
      },
    ]);
    const holding = goldBar({ purity: '0.5' });

    expect(pricedValue(holding, book, day2024)?.minorUnits).toBe(4_500_000);
  });

  it('reads its currency off the price point row, fixed to UAH regardless of the holding currency field', () => {
    const book = buildPriceBook([
      {
        instrument: metalInstrument('XAU'),
        day: day2024,
        price: '90000',
        currency: 'UAH',
        source: 'nbu',
      },
    ]);
    const holding = goldBar();
    const usdHolding: PricedHolding = { ...holding, currency: 'USD' };

    const uahMoney = pricedValue(holding, book, day2024);
    const usdHoldingMoney = pricedValue(usdHolding, book, day2024);

    expect(usdHoldingMoney?.currency).toBe('UAH');
    expect(usdHoldingMoney?.minorUnits).toBe(uahMoney?.minorUnits);
  });

  it('returns null for a metal holding with no stored price point yet', () => {
    const holding = goldBar();

    expect(pricedValue(holding, EMPTY_PRICE_BOOK, day2024)).toBeNull();
  });

  it('returns null for a metal holding with no valid metal metadata', () => {
    const holding = goldBar({ metal: 'nonsense' });
    const book = buildPriceBook([
      {
        instrument: metalInstrument('XAU'),
        day: day2024,
        price: '90000',
        currency: 'UAH',
        source: 'nbu',
      },
    ]);

    expect(pricedValue(holding, book, day2024)).toBeNull();
  });

  it('values a metal holding with no id — it reads the SHARED metal instrument, not a per-holding one', () => {
    const holding = goldBar();
    const { id: _id, ...withoutId } = holding;
    const book = buildPriceBook([
      {
        instrument: metalInstrument('XAU'),
        day: day2024,
        price: '90000',
        currency: 'UAH',
        source: 'nbu',
      },
    ]);

    expect(pricedValue(withoutId, book, day2024)?.minorUnits).toBe(9_000_000);
  });
});
