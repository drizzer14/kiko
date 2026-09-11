import { formatMoney } from './format';
import { Money } from '../money';

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

describe('formatMoney negative amounts', () => {
  it('puts the sign outside a prefix symbol', () => {
    expect(formatMoney(Money.fromMajor('USD', -1234.5))).toBe('-$1,234.50');
  });

  it('puts the sign before a suffix-symbol amount', () => {
    expect(formatMoney(Money.fromMajor('UAH', -2500))).toBe('-2,500.00 ₴');
  });
});

describe('formatMoney locale grouping', () => {
  it('groups with a non-ASCII space (U+00A0) and comma decimal for uk-UA', () => {
    // 1 234,56 ₴ — uk-UA groups thousands with U+00A0 NO-BREAK SPACE, the
    // exact code point this project's Jest/Node ICU build emits for uk-UA
    // grouping (verified by running this test before pinning it; a
    // different ICU build could emit U+202F NARROW NO-BREAK SPACE instead —
    // if this ever regresses to a plain ASCII space, that is the bug this
    // guards against), comma decimal, UAH symbol suffixed.
    const money = Money.of('UAH', 123_456);
    const formatted = formatMoney(money, 'uk-UA');

    expect(formatted).toBe('1\u00A0234,56 ₴');
  });
});
