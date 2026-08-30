import { Money } from './money';

describe('Money', () => {
  it('adds two amounts of the same currency', () => {
    const total = Money.of('USD', 150).add(Money.of('USD', 350));
    expect(total.minorUnits).toBe(500);
    expect(total.currency).toBe('USD');
  });

  it('throws when adding different currencies', () => {
    expect(() => Money.of('USD', 100).add(Money.of('EUR', 100))).toThrow();
  });

  it('builds BTC from major units at 8-decimal scale', () => {
    expect(Money.fromMajor('BTC', 1).minorUnits).toBe(100_000_000);
  });

  it('builds fiat from major units at 2-decimal scale', () => {
    expect(Money.fromMajor('UAH', 12.34).minorUnits).toBe(1234);
  });

  it('negates and detects zero', () => {
    expect(Money.of('EUR', 500).negate().minorUnits).toBe(-500);
    expect(Money.of('EUR', 0).isZero()).toBe(true);
  });
});
