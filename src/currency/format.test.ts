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
