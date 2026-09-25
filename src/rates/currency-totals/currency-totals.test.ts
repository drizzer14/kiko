import { Money } from '../../currency/money';
import { buildPriceBook } from '../../prices/price-book';
import { holdingInstrument } from '../../prices/instrument';
import { holdingValue, type ValuableHolding } from '../../holdings/holding-value';

import { sumByCurrency } from './currency-totals';

const card = (
  currency: ValuableHolding['currency'],
  balanceMinorUnits: number,
): ValuableHolding => ({
  id: 'card-1',
  type: 'card',
  currency,
  balanceMinorUnits,
  metadata: null,
});

const START = Date.UTC(2026, 0, 1);
const day = 86_400_000;

describe('sumByCurrency', () => {
  it('sums balances per currency, ordered by descending absolute value', () => {
    const result = sumByCurrency([card('UAH', 10000), card('USD', 5000), card('UAH', 2500)]);

    expect(result).toEqual([Money.of('UAH', 12500), Money.of('USD', 5000)]);
  });

  it('orders by absolute value, so a large negative total leads', () => {
    const result = sumByCurrency([card('USD', 3000), card('UAH', -9000)]);

    expect(result).toEqual([Money.of('UAH', -9000), Money.of('USD', 3000)]);
  });

  it('returns an empty array for empty input', () => {
    expect(sumByCurrency([])).toEqual([]);
  });

  it('values a term deposit at its net-of-tax computed value, not its raw balance', () => {
    const now = START + 365 * day;
    const deposit: ValuableHolding = {
      id: 'deposit-1',
      type: 'term_deposit',
      currency: 'UAH',
      // Deliberately different from the computed value to prove valuation is used.
      balanceMinorUnits: 0,
      metadata: {
        contributions: [{ amountMinorUnits: 100_000, date: START }],
        annualRatePct: 12,
        termMonths: 24,
        recapitalization: true,
        compounding: 'monthly',
      },
    };

    const expected = holdingValue(deposit, now).minorUnits;
    expect(expected).toBeGreaterThan(0);

    const result = sumByCurrency([deposit], now);
    expect(result).toEqual([Money.of('UAH', expected)]);
  });

  // With no `book` argument, a priced holding (property_item) falls back
  // to its lots cost basis rather than reading 0.
  it('values a property_item holding at its cost basis when no book is passed', () => {
    const property: ValuableHolding = {
      id: 'prop',
      type: 'property_item',
      currency: 'UAH',
      balanceMinorUnits: 0,
      metadata: {
        category: 'real_estate',
        lots: [{ day: START, quantityDelta: '1', costMinorUnits: 500_000 }],
      },
    };

    expect(sumByCurrency([property], START)).toEqual([Money.of('UAH', 500_000)]);
  });

  // Threading a real `PriceBook` overrides the cost-basis fallback.
  it('values a property_item holding at its priced value when a book is passed', () => {
    const property: ValuableHolding = {
      id: 'prop',
      type: 'property_item',
      currency: 'UAH',
      balanceMinorUnits: 0,
      metadata: {
        category: 'real_estate',
        lots: [{ day: START, quantityDelta: '1', costMinorUnits: 500_000 }],
      },
    };
    const book = buildPriceBook([
      {
        instrument: holdingInstrument('prop'),
        day: START,
        price: '7000',
        currency: 'UAH',
        source: 'manual',
      },
    ]);

    expect(sumByCurrency([property], START, book)).toEqual([Money.of('UAH', 700_000)]);
  });
});
