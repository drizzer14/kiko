import { Money } from '../currency/money';
import { sumByCurrency } from './currency-totals';

describe('sumByCurrency', () => {
  it('sums balances per currency, ordered by descending absolute value', () => {
    const result = sumByCurrency([
      { currency: 'UAH', balanceMinorUnits: 10000 },
      { currency: 'USD', balanceMinorUnits: 5000 },
      { currency: 'UAH', balanceMinorUnits: 2500 },
    ]);

    expect(result).toEqual([Money.of('UAH', 12500), Money.of('USD', 5000)]);
  });

  it('orders by absolute value, so a large negative total leads', () => {
    const result = sumByCurrency([
      { currency: 'USD', balanceMinorUnits: 3000 },
      { currency: 'UAH', balanceMinorUnits: -9000 },
    ]);

    expect(result).toEqual([Money.of('UAH', -9000), Money.of('USD', 3000)]);
  });

  it('returns an empty array for empty input', () => {
    expect(sumByCurrency([])).toEqual([]);
  });
});
