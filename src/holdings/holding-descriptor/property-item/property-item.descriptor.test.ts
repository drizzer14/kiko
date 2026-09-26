import { buildPriceBook } from '@kiko/prices/price-book';
import { holdingInstrument } from '@kiko/prices/instrument';

import { holdingValue } from '../../holding-value';

import { propertyShareChanges, propertyOwnershipView } from './property-item.descriptor';

const DAY = 86_400_000;
const firstDay = Date.UTC(2024, 0, 1);
const changeDay = Date.UTC(2025, 5, 1);
const NOW = Date.UTC(2026, 0, 1);

const property = (metadata: Record<string, unknown> = {}) => ({
  id: 'prop-1',
  type: 'property_item' as const,
  currency: 'UAH' as const,
  balanceMinorUnits: 0,
  metadata: {
    category: 'real_estate',
    lots: [{ day: firstDay, quantityDelta: '1', costMinorUnits: 1_800_000 }],
    ...metadata,
  },
});

const book = buildPriceBook([
  {
    instrument: holdingInstrument('prop-1'),
    day: firstDay,
    price: '30000.01',
    currency: 'UAH',
    source: 'manual',
  },
]);

describe('propertyOwnershipView', () => {
  it('shows the whole and the owned value of a shared property', () => {
    const holding = property({
      ownership: [
        { day: firstDay, numerator: 1, denominator: 2 },
        { day: changeDay, numerator: 1, denominator: 3 },
      ],
      ownershipInput: 'fraction',
    });

    const view = propertyOwnershipView(holding, NOW, book);

    expect(view).toEqual({
      share: { numerator: 1, denominator: 3 },
      input: 'fraction',
      since: changeDay,
      whole: expect.objectContaining({ currency: 'UAH', minorUnits: 3_000_001 }),
      owned: expect.objectContaining({ currency: 'UAH', minorUnits: 1_000_000 }),
    });
    expect(view?.owned.minorUnits).toBe(holdingValue(holding, NOW, book).minorUnits);
  });

  it('reads the share of the requested day', () => {
    const holding = property({
      ownership: [
        { day: firstDay, numerator: 1, denominator: 2 },
        { day: changeDay, numerator: 1, denominator: 3 },
      ],
    });

    const view = propertyOwnershipView(holding, changeDay - DAY, book);

    expect(view?.share).toEqual({ numerator: 1, denominator: 2 });
    expect(view?.since).toBe(firstDay);
    expect(view?.input).toBe('percent');
  });

  it('is null for a property owned whole', () => {
    expect(propertyOwnershipView(property(), NOW, book)).toBeNull();
    expect(
      propertyOwnershipView(
        property({ ownership: [{ day: firstDay, numerator: 1, denominator: 1 }] }),
        NOW,
        book,
      ),
    ).toBeNull();
  });

  it('is null for a loan given, even with a stored share', () => {
    const holding = property({
      category: 'loan_given',
      ownership: [{ day: firstDay, numerator: 1, denominator: 3 }],
    });

    expect(propertyOwnershipView(holding, NOW, book)).toBeNull();
  });

  it('is null before a share change with a future effective day', () => {
    const holding = property({ ownership: [{ day: NOW + DAY, numerator: 1, denominator: 2 }] });

    expect(propertyOwnershipView(holding, NOW, book)).toBeNull();
    expect(holdingValue(holding, NOW, book).minorUnits).toBe(3_000_001);
    expect(propertyOwnershipView(holding, NOW + DAY, book)?.since).toBe(NOW + DAY);
  });

  it('is null for a holding that is not a property', () => {
    const holding = {
      ...property({ ownership: [{ day: firstDay, numerator: 1, denominator: 3 }] }),
      type: 'metal' as const,
    };

    expect(propertyOwnershipView(holding, NOW, book)).toBeNull();
  });
});

describe('propertyShareChanges', () => {
  it('lists every stored change newest first, with the typed input form', () => {
    const holding = property({
      ownership: [
        { day: firstDay, numerator: 1, denominator: 2 },
        { day: changeDay, numerator: 1, denominator: 3 },
      ],
      ownershipInput: 'fraction',
    });

    expect(propertyShareChanges(holding)).toEqual({
      changes: [
        { day: changeDay, numerator: 1, denominator: 3 },
        { day: firstDay, numerator: 1, denominator: 2 },
      ],
      input: 'fraction',
    });
  });

  it('lists nothing for a property with no stored change', () => {
    expect(propertyShareChanges(property()).changes).toEqual([]);
  });

  it('lists nothing for a loan given, even with a stored share', () => {
    const holding = property({
      category: 'loan_given',
      ownership: [{ day: firstDay, numerator: 1, denominator: 3 }],
    });

    expect(propertyShareChanges(holding).changes).toEqual([]);
  });

  it('lists nothing for a holding that is not a property', () => {
    const holding = {
      ...property({ ownership: [{ day: firstDay, numerator: 1, denominator: 3 }] }),
      type: 'metal' as const,
    };

    expect(propertyShareChanges(holding).changes).toEqual([]);
  });
});
