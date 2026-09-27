import {
  addDecimal,
  subDecimal,
  trimDecimal,
  shiftDecimal,
  scaleMinorUnits,
  compareDecimal,
  normalizeDecimal,
  multiplyToDecimal,
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
