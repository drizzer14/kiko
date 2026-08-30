import { isCurrency } from './currency';

describe('isCurrency', () => {
  it('accepts each of the four supported currency codes', () => {
    expect(isCurrency('BTC')).toBe(true);
    expect(isCurrency('USD')).toBe(true);
    expect(isCurrency('EUR')).toBe(true);
    expect(isCurrency('UAH')).toBe(true);
  });

  it('rejects an unsupported code', () => {
    expect(isCurrency('GBP')).toBe(false);
  });
});
