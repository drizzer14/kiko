import { Money } from '../money';

import { formatMoney, splitMinorUnits } from './format';

describe('formatMoney', () => {
  it('formats fiat with two decimals and code', () => {
    expect(formatMoney(Money.of('USD', 123456))).toContain('1,234.56');
  });

  it('formats one BTC with two decimals', () => {
    const formatted = formatMoney(Money.of('BTC', 100_000_000));

    expect(formatted).toContain('1.00');
    expect(formatted).not.toContain('1.00000000');
  });

  it('shows a negative sign', () => {
    expect(formatMoney(Money.of('UAH', -500))).toContain('-');
  });
});

describe('splitMinorUnits', () => {
  it('splits above 2^53 / 10^scale without a float rounding step', () => {
    expect(splitMinorUnits(-9_007_199_254_000_000, 8)).toEqual({
      whole: 90_071_992,
      fraction: '54000000',
    });
  });

  it('keeps the leading zeros of a fraction and has none at scale 0', () => {
    expect(splitMinorUnits(5, 8)).toEqual({ whole: 0, fraction: '00000005' });
    expect(splitMinorUnits(1234, 0)).toEqual({ whole: 1234, fraction: '' });
  });
});

describe('formatMoney symbols', () => {
  it('puts $ / € / ₿ before the number', () => {
    expect(formatMoney(Money.fromMajor('USD', 1234.5))).toBe('$1,234.50');
    expect(formatMoney(Money.fromMajor('EUR', 10))).toBe('€10.00');
    expect(formatMoney(Money.fromMajor('BTC', 0.5))).toBe('₿0.50');
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

  it('puts the sign before a bare-code amount, outside the spaced code', () => {
    expect(formatMoney(Money.fromMajor('AED', -1234.5))).toBe('-AED 1,234.50');
  });
});

describe('formatMoney bare-code currencies', () => {
  it('spaces a bare ISO-code mark from the amount (no conventional symbol)', () => {
    // AED has no distinct Unicode currency symbol, so currencySymbol.AED is
    // the bare code itself — it must read as a unit, not run into the
    // digits, unlike a real glyph ($/€/₿), which stays tight.
    expect(formatMoney(Money.fromMajor('AED', 1234.5))).toBe('AED 1,234.50');
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

describe('formatMoney crypto amounts', () => {
  it('shows a crypto amount with trailing zeros trimmed to two decimals', () => {
    expect(formatMoney(Money.fromMajor('BTC', 0.05))).toBe('₿0.05');
  });

  it('keeps every significant crypto decimal', () => {
    expect(formatMoney(Money.of('BTC', 12345))).toBe('₿0.00012345');
  });

  it('keeps a fiat amount at its fixed scale', () => {
    expect(formatMoney(Money.of('UAH', 123450))).toBe('1,234.50 ₴');
  });

  it('shows the largest safe crypto amount with every digit', () => {
    expect(formatMoney(Money.of('BTC', Number.MAX_SAFE_INTEGER))).toBe('₿90,071,992.54740991');
  });

  it("uses the locale's decimal separator and grouping for crypto", () => {
    expect(formatMoney(Money.of('BTC', 123_456_700_000), 'uk-UA')).toContain('1 234,567');
  });

  it('puts the sign outside the symbol of a crypto amount', () => {
    expect(formatMoney(Money.of('BTC', -5_000_000))).toBe('-₿0.05');
  });

  it('rounds a stored non-integer to whole minor units instead of printing a fraction', () => {
    // Money.of truncates, so a stored real (a seeded bond value) reaches formatMoney as a cast.
    const stored = { currency: 'BTC', minorUnits: 12.5 } as unknown as Money;

    expect(formatMoney(stored)).toBe('₿0.00000013');
  });
});

describe('formatMoney USDT amounts', () => {
  it('shows a USDT amount with two decimals', () => {
    expect(formatMoney(Money.of('USDT', 12_345_000_000))).toBe('₮123.45');
  });

  it('shows a sub-cent USDT amount', () => {
    expect(formatMoney(Money.of('USDT', 12_345))).toBe('₮0.00012345');
  });

  it('shows one USDT with two decimals', () => {
    expect(formatMoney(Money.of('USDT', 100_000_000))).toBe('₮1.00');
  });

  it('shows the largest storable USDT amount exactly', () => {
    expect(formatMoney(Money.of('USDT', Number.MAX_SAFE_INTEGER))).toBe('₮90,071,992.54740991');
  });
});

describe('formatMoney whole units without a symbol', () => {
  const WHOLE_UNITS = { fractionDigits: 0, symbol: false };

  it('rounds to whole units and drops the symbol', () => {
    expect(formatMoney(Money.of('UAH', 123_456), 'en-US', WHOLE_UNITS)).toBe('1,235');
    expect(formatMoney(Money.of('USD', 123_449), 'en-US', WHOLE_UNITS)).toBe('1,234');
  });

  it("groups with the locale's separator", () => {
    expect(formatMoney(Money.of('UAH', 123_456), 'uk-UA', WHOLE_UNITS)).toBe('1 235');
  });

  it('puts the sign before a negative amount', () => {
    expect(formatMoney(Money.of('UAH', -123_456), 'en-US', WHOLE_UNITS)).toBe('-1,235');
  });

  it('rounds half away from zero on both signs', () => {
    expect(formatMoney(Money.of('UAH', 50), 'en-US', WHOLE_UNITS)).toBe('1');
    expect(formatMoney(Money.of('UAH', -50), 'en-US', WHOLE_UNITS)).toBe('-1');
  });

  describe('on an engine whose Intl rounds half to even', () => {
    const originalToLocaleString = Number.prototype.toLocaleString;

    const roundHalfToEven = (value: number, digits: number): number => {
      const scaled = value * 10 ** digits;
      const floor = Math.floor(scaled);
      const isHalf = scaled - floor === 0.5;
      const rounded = isHalf ? floor + (floor % 2) : Math.round(scaled);

      return rounded / 10 ** digits;
    };

    beforeEach(() => {
      jest.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function halfToEvenFormat(
        this: number,
        locales?: Intl.LocalesArgument,
        options?: Intl.NumberFormatOptions,
      ) {
        return originalToLocaleString.call(
          roundHalfToEven(this, options?.maximumFractionDigits ?? 0),
          locales,
          options,
        );
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('still rounds half away from zero on both signs', () => {
      expect(formatMoney(Money.of('UAH', 250), 'en-US', WHOLE_UNITS)).toBe('3');
      expect(formatMoney(Money.of('UAH', -250), 'en-US', WHOLE_UNITS)).toBe('-3');
      expect(formatMoney(Money.of('UAH', -150), 'en-US', WHOLE_UNITS)).toBe('-2');
      expect(formatMoney(Money.of('UAH', 50), 'en-US', WHOLE_UNITS)).toBe('1');
      expect(formatMoney(Money.of('UAH', -50), 'en-US', WHOLE_UNITS)).toBe('-1');
    });

    it('rounds half away from zero at one decimal too', () => {
      expect(formatMoney(Money.of('UAH', 1_025), 'en-US', { fractionDigits: 1 })).toBe('10.3 ₴');
      expect(formatMoney(Money.of('UAH', -1_025), 'en-US', { fractionDigits: 1 })).toBe('-10.3 ₴');
    });

    it('gives a value that rounds to zero no sign', () => {
      expect(formatMoney(Money.fromMajor('UAH', -0.4), 'en-US', WHOLE_UNITS)).toBe('0');
      expect(formatMoney(Money.of('UAH', -49), 'en-US', WHOLE_UNITS)).toBe('0');
    });
  });

  it('gives a rounded zero no sign', () => {
    expect(formatMoney(Money.of('UAH', -49), 'en-US', WHOLE_UNITS)).toBe('0');
    expect(formatMoney(Money.of('UAH', -1), 'uk-UA', WHOLE_UNITS)).toBe('0');
    expect(formatMoney(Money.of('UAH', 49), 'en-US', WHOLE_UNITS)).toBe('0');
    expect(formatMoney(Money.of('UAH', 0), 'en-US', WHOLE_UNITS)).toBe('0');
  });

  it('leaves a currency with no decimals as it is', () => {
    expect(formatMoney(Money.of('JPY', -1_234), 'en-US', WHOLE_UNITS)).toBe('-1,234');
    expect(formatMoney(Money.of('JPY', 1_234), 'en-US')).toBe('¥1,234');
  });

  it('rounds a crypto amount to whole units too, with no minimum of two decimals', () => {
    expect(formatMoney(Money.fromMajor('BTC', 1.5), 'en-US', WHOLE_UNITS)).toBe('2');
    expect(formatMoney(Money.fromMajor('BTC', -0.2), 'en-US', WHOLE_UNITS)).toBe('0');
  });

  it('drops the symbol alone and keeps the currency scale', () => {
    expect(formatMoney(Money.of('USD', 123_456), 'en-US', { symbol: false })).toBe('1,234.56');
    expect(formatMoney(Money.of('USD', -123_456), 'en-US', { symbol: false })).toBe('-1,234.56');
    expect(formatMoney(Money.fromMajor('BTC', 0.05), 'en-US', { symbol: false })).toBe('0.05');
  });

  it('keeps the symbol when only the digits change', () => {
    expect(formatMoney(Money.of('USD', -123_456), 'en-US', { fractionDigits: 0 })).toBe('-$1,235');
    expect(formatMoney(Money.of('UAH', 123_456), 'en-US', { fractionDigits: 0 })).toBe('1,235 ₴');
  });

  it('changes nothing for a call with no third argument or an empty one', () => {
    const money = Money.of('UAH', -123_456);

    expect(formatMoney(money, 'en-US', {})).toBe(formatMoney(money, 'en-US'));
    expect(formatMoney(money)).toBe('-1,234.56 ₴');
  });
});
