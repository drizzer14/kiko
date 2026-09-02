import { Money } from '../currency/money';
import { holdingValue, type ValuableHolding } from '../holdings/holding-value';
import { sumByCurrency } from './currency-totals';

const card = (
  currency: ValuableHolding['currency'],
  balanceMinorUnits: number,
): ValuableHolding => ({
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
});
