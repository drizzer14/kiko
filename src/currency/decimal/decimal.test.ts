import { bifoldMap } from 'fnts/either';

import {
  type DecimalAmountError,
  addDecimal,
  trimDecimal,
  shiftDecimal,
  scaleMinorUnits,
  compareDecimal,
  normalizeDecimal,
  multiplyToDecimal,
  multiplyToMinorUnits,
  decimalToMinorUnits,
  decimalFromJsonNumber,
} from './decimal';

describe('normalizeDecimal', () => {
  it('trims, swaps a comma decimal mark for a dot, and strips grouping spaces', () => {
    expect(normalizeDecimal('1 234,56')).toBe('1234.56');
  });

  it('trims surrounding whitespace and a non-breaking space', () => {
    expect(normalizeDecimal('  12.5  ')).toBe('12.5');
    expect(normalizeDecimal('1 234.5')).toBe('1234.5');
  });

  it('rejects non-numeric input', () => {
    expect(normalizeDecimal('abc')).toBeNull();
  });

  it('rejects exponent notation', () => {
    expect(normalizeDecimal('1e5')).toBeNull();
  });

  it('rejects a signed value', () => {
    expect(normalizeDecimal('-1.5')).toBeNull();
    expect(normalizeDecimal('+1.5')).toBeNull();
  });

  it('accepts a plain integer', () => {
    expect(normalizeDecimal('42')).toBe('42');
  });
});

describe('addDecimal', () => {
  it('adds two decimals at the wider operand scale', () => {
    expect(addDecimal('1.5', '2.25')).toBe('3.75');
  });
});

describe('compareDecimal', () => {
  it('orders two decimals at different scales', () => {
    expect(compareDecimal('1.50', '1.5')).toBe(0);
    expect(compareDecimal('1.49', '1.5')).toBe(-1);
    expect(compareDecimal('2', '1.999')).toBe(1);
  });
});

describe('trimDecimal', () => {
  it('drops trailing fraction zeros and a bare point', () => {
    expect(trimDecimal('1.000')).toBe('1');
    expect(trimDecimal('0.750')).toBe('0.75');
    expect(trimDecimal('999.9')).toBe('999.9');
  });

  it('leaves integer zeros alone', () => {
    expect(trimDecimal('1000')).toBe('1000');
    expect(trimDecimal('0')).toBe('0');
  });
});

describe('shiftDecimal', () => {
  it('shifts the decimal point left (divides) for negative places', () => {
    expect(shiftDecimal('12345', -2)).toBe('123.45');
  });

  it('shifts the decimal point right (multiplies) for positive places', () => {
    expect(shiftDecimal('1.5', 2)).toBe('150');
  });
});

describe('decimalFromJsonNumber', () => {
  it('expands a tiny exponential value to its plain decimal form', () => {
    expect(decimalFromJsonNumber(1e-7)).toBe('0.0000001');
  });

  it('expands a large exponential value to its plain decimal form', () => {
    expect(decimalFromJsonNumber(1.5e21)).toBe('1500000000000000000000');
  });

  it('passes through a plain (non-exponential) number', () => {
    expect(decimalFromJsonNumber(123.45)).toBe('123.45');
    expect(decimalFromJsonNumber(-2.5)).toBe('-2.5');
  });

  it('rejects non-finite values', () => {
    expect(decimalFromJsonNumber(Number.NaN)).toBeNull();
    expect(decimalFromJsonNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('multiplyToMinorUnits', () => {
  it('matches the hand-computed minor units for a quantity/price/rate chain', () => {
    // 31.1 * 0.9999 * 193295.79 / 31.1034768 = 193254.855646... UAH
    // -> half-away-from-zero at the cent -> 19_325_486 minor units.
    expect(multiplyToMinorUnits(['31.1', '0.9999', '193295.79'], 'UAH', '31.1034768')).toBe(
      19_325_486,
    );
  });

  it('rounds half away from zero exactly at the .005 boundary', () => {
    expect(multiplyToMinorUnits(['1.005'], 'USD')).toBe(101);
  });

  it('keeps full precision at the BTC 8-decimal scale (a single satoshi)', () => {
    expect(multiplyToMinorUnits(['0.00000001'], 'BTC')).toBe(1);
  });

  it('needs no divisor for a plain quantity * price', () => {
    expect(multiplyToMinorUnits(['3', '19.99'], 'USD')).toBe(5997);
  });
});

describe('multiplyToDecimal', () => {
  it('divides exactly where float math drifts (77 * 2 / 1000 * 100)', () => {
    expect(multiplyToDecimal(['77', '2', '100'], 4, '1000')).toBe('15.4000');
  });

  it('rounds half away from zero at the requested scale', () => {
    expect(multiplyToDecimal(['2'], 2, '3')).toBe('0.67');
    expect(multiplyToDecimal(['1'], 2, '3')).toBe('0.33');
  });

  it('needs no divisor for a plain product', () => {
    expect(multiplyToDecimal(['0.0225', '2', '100'], 4)).toBe('4.5000');
  });
});

describe('scaleMinorUnits', () => {
  it('rounds a third of a minor-units amount once, half away from zero', () => {
    expect(scaleMinorUnits(100, 1, 3)).toBe(33);
    expect(scaleMinorUnits(200, 1, 3)).toBe(67);
  });

  it('rounds a negative amount away from zero', () => {
    expect(scaleMinorUnits(-200, 1, 3)).toBe(-67);
    expect(scaleMinorUnits(-1, 1, 2)).toBe(-1);
  });

  it('keeps the amount unchanged at a whole share', () => {
    expect(scaleMinorUnits(3_000_000_01, 1, 1)).toBe(3_000_000_01);
  });

  it('stays exact beyond float precision', () => {
    expect(scaleMinorUnits(9_007_199_254_740_991, 2, 3)).toBe(6_004_799_503_160_661);
  });
});

describe('decimalToMinorUnits', () => {
  const MAXIMUM_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
  const SCALES = [0, 1, 2, 3, 4, 5, 6, 7, 8];

  // A fixed linear congruential walk over [0, 2^53), so the sweep is the same on every run.
  const safeIntegerSweep = (): bigint[] => {
    const modulus = 2n ** 53n;
    const powersOfTen = Array.from({ length: 16 }, (_, power) => 10n ** BigInt(power));
    const edges = [
      ...powersOfTen.flatMap((value) => [value - 1n, value, value + 1n]),
      MAXIMUM_SAFE - 1n,
      MAXIMUM_SAFE,
    ];
    const walked: bigint[] = [];
    let state = 12345n;

    for (let step = 0; step < 400; step += 1) {
      state = (state * 6364136223846793005n + 1442695040888963407n) % modulus;
      walked.push(state);
    }

    return [...edges, ...walked];
  };

  // An Either built by `right`/`left` carries a fresh `toString` closure, so two equal results
  // never compare deep-equal; fold each to a plain object first.
  const outcome = (text: string, scale: number, rounding: 'exact' | 'half-away-from-zero') =>
    bifoldMap<DecimalAmountError, number, { error: DecimalAmountError } | { value: number }>(
      decimalToMinorUnits(text, scale, rounding),
      (error) => ({ error }),
      (value) => ({ value }),
    );

  it('parses an exact decimal at the scale', () => {
    expect(outcome('0.00012345', 8, 'exact')).toEqual({ value: 12345 });
  });

  it('pads missing decimals', () => {
    expect(outcome('4150', 2, 'exact')).toEqual({ value: 415000 });
  });

  it('drops trailing zeros past the scale', () => {
    expect(outcome('4150.000', 2, 'exact')).toEqual({ value: 415000 });
  });

  it('refuses a non-zero digit past the scale', () => {
    expect(outcome('4150.001', 2, 'exact')).toEqual({ error: 'amount-precision' });
    expect(outcome('-4150.001', 2, 'exact')).toEqual({ error: 'amount-precision' });
  });

  it('rounds half away from zero when asked', () => {
    expect(outcome('1.23456789', 3, 'half-away-from-zero')).toEqual({ value: 1235 });
    expect(outcome('-1.2345', 3, 'half-away-from-zero')).toEqual({ value: -1235 });
    expect(outcome('1.2344', 3, 'half-away-from-zero')).toEqual({ value: 1234 });
  });

  it('refuses a malformed amount', () => {
    for (const text of ['1e-8', '', ' 1', '1 ', '+1', '1.', '.5', '1,5', '--1', '1.2.3', 'abc']) {
      expect(outcome(text, 8, 'exact')).toEqual({ error: 'amount-malformed' });
    }
  });

  it('reads leading zeros as part of the number', () => {
    expect(outcome('007.50', 2, 'exact')).toEqual({ value: 750 });
  });

  it('rounds a small negative amount to zero, not negative zero', () => {
    expect(outcome('-0.0004', 3, 'half-away-from-zero')).toEqual({ value: 0 });
  });

  it('keeps a negative amount and reads negative zero as zero', () => {
    expect(outcome('-0.5', 2, 'exact')).toEqual({ value: -50 });
    expect(outcome('-0', 2, 'exact')).toEqual({ value: 0 });
  });

  it('refuses a value above the safe integer and accepts the exact limit', () => {
    expect(outcome('90071992.54740992', 8, 'exact')).toEqual({ error: 'amount-too-large' });
    expect(outcome('90071992.54740991', 8, 'exact')).toEqual({ value: Number.MAX_SAFE_INTEGER });
    expect(outcome('-90071992.54740991', 8, 'exact')).toEqual({ value: -Number.MAX_SAFE_INTEGER });
    expect(outcome('-90071992.54740992', 8, 'exact')).toEqual({ error: 'amount-too-large' });
  });

  it('refuses a rounded value that lands above the safe integer', () => {
    expect(outcome('90071992.547409915', 8, 'half-away-from-zero')).toEqual({
      error: 'amount-too-large',
    });
  });

  it.each(SCALES)('round-trips every sampled safe integer at scale %i', (scale) => {
    for (const minorUnits of safeIntegerSweep()) {
      const text = shiftDecimal(minorUnits.toString(), -scale);
      const negativeText = shiftDecimal((-minorUnits).toString(), -scale);

      expect(outcome(text, scale, 'exact')).toEqual({ value: Number(minorUnits) });
      expect(outcome(negativeText, scale, 'exact')).toEqual({ value: 0 - Number(minorUnits) });
    }
  });

  it.each(SCALES)('rounds one extra digit half away from zero at scale %i', (scale) => {
    for (const minorUnits of safeIntegerSweep().filter((value) => value < MAXIMUM_SAFE)) {
      for (const digit of [0n, 4n, 5n, 9n]) {
        const text = shiftDecimal((minorUnits * 10n + digit).toString(), -(scale + 1));
        const expected = Number(minorUnits + (digit >= 5n ? 1n : 0n));

        expect(outcome(text, scale, 'half-away-from-zero')).toEqual({ value: expected });
        expect(outcome(`-${text}`, scale, 'half-away-from-zero')).toEqual({ value: 0 - expected });
      }
    }
  });
});
