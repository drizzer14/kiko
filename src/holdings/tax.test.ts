import { INTEREST_TAX_RATE_PCT, taxOnInterestMinor } from './tax';

describe('tax', () => {
  it('uses the 23% combined rate', () => {
    expect(INTEREST_TAX_RATE_PCT).toBe(23);
  });

  it('taxes positive interest, floored', () => {
    expect(taxOnInterestMinor(10000)).toBe(2300);
    expect(taxOnInterestMinor(999)).toBe(229); // floor(229.77)
  });

  it('never taxes zero or negative interest', () => {
    expect(taxOnInterestMinor(0)).toBe(0);
    expect(taxOnInterestMinor(-500)).toBe(0);
  });
});
