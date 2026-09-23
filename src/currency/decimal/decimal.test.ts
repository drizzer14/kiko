import {
  addDecimal,
  subDecimal,
  shiftDecimal,
  compareDecimal,
  normalizeDecimal,
  multiplyToMinorUnits,
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

describe('addDecimal / subDecimal', () => {
  it('adds two decimals at the wider operand scale', () => {
    expect(addDecimal('1.5', '2.25')).toBe('3.75');
  });

  it('subtracts to a negative (signed) result', () => {
    expect(subDecimal('1', '2')).toBe('-1');
  });

  it('subtracts to an exact zero without a stray sign', () => {
    expect(subDecimal('5.00', '5')).toBe('0.00');
  });
});

describe('compareDecimal', () => {
  it('orders two decimals at different scales', () => {
    expect(compareDecimal('1.50', '1.5')).toBe(0);
    expect(compareDecimal('1.49', '1.5')).toBe(-1);
    expect(compareDecimal('2', '1.999')).toBe(1);
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
