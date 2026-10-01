import { SHARE_PRICE_SCALE, sharePriceOf } from './share-price';

describe('sharePriceOf', () => {
  it('keeps a price below one minor unit', () => {
    expect(sharePriceOf('0.004')).toBe('0.004');
  });

  it('keeps more places than the currency has', () => {
    expect(sharePriceOf('12.345')).toBe('12.345');
    expect(sharePriceOf('333.33333333')).toBe('333.33333333');
  });

  it('reads a grouped, comma-decimal input', () => {
    expect(sharePriceOf('1 234,5')).toBe('1234.5');
  });

  it('drops trailing zeros', () => {
    expect(sharePriceOf('250.00')).toBe('250');
  });

  it('rounds past the share price scale, half away from zero', () => {
    expect(SHARE_PRICE_SCALE).toBe(8);
    expect(sharePriceOf('1.123456785')).toBe('1.12345679');
  });

  it('rejects 0, a price that rounds to 0, and junk', () => {
    expect(sharePriceOf('0')).toBeUndefined();
    expect(sharePriceOf('0.000000004')).toBeUndefined();
    expect(sharePriceOf('')).toBeUndefined();
    expect(sharePriceOf('abc')).toBeUndefined();
  });
});
