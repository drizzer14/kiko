import { formatMoney } from './format';
import { Money } from './money';

describe('formatMoney', () => {
  it('formats fiat with two decimals and code', () => {
    expect(formatMoney(Money.of('USD', 123456))).toContain('1,234.56');
  });

  it('formats BTC with eight decimals', () => {
    expect(formatMoney(Money.of('BTC', 100_000_000))).toContain('1.00000000');
  });

  it('shows a negative sign', () => {
    expect(formatMoney(Money.of('UAH', -500))).toContain('-');
  });
});

describe('formatMoney symbols', () => {
  it('puts $ / € / ₿ before the number', () => {
    expect(formatMoney(Money.fromMajor('USD', 1234.5))).toBe('$1,234.50');
    expect(formatMoney(Money.fromMajor('EUR', 10))).toBe('€10.00');
    expect(formatMoney(Money.fromMajor('BTC', 0.5))).toBe('₿0.50000000');
  });

  it('puts ₴ after the number (Ukrainian convention)', () => {
    expect(formatMoney(Money.fromMajor('UAH', 2500))).toBe('2,500.00 ₴');
  });
});
