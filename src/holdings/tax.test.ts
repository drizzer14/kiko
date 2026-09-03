import {
  INCOME_TAX_RATE_PCT,
  INTEREST_TAX_RATE_PCT,
  MILITARY_LEVY_RATE_PCT,
  splitInterestTaxMinor,
  taxOnInterestMinor,
} from './tax';

describe('tax', () => {
  it('models 18% income + 5% military = 23% combined', () => {
    expect(INCOME_TAX_RATE_PCT).toBe(18);
    expect(MILITARY_LEVY_RATE_PCT).toBe(5);
    expect(INTEREST_TAX_RATE_PCT).toBe(23);
  });

  it('splits the withholding into two separately-rounded levies', () => {
    // 876.71 gross (87671 minor): income round(15780.78)=15781, military
    // round(4383.55)=4384; total 20165 (not round(87671*23%)=20164).
    const tax = splitInterestTaxMinor(87_671);
    expect(tax.incomeMinor).toBe(15_781);
    expect(tax.militaryMinor).toBe(4_384);
    expect(tax.totalMinor).toBe(20_165);
  });

  it('taxes positive interest as the sum of the two rounded levies', () => {
    // 10000 minor: round(1800) + round(500) = 2300.
    expect(taxOnInterestMinor(10_000)).toBe(2_300);
    // 999 minor: round(179.82)=180 + round(49.95)=50 = 230.
    expect(taxOnInterestMinor(999)).toBe(230);
  });

  it('never taxes zero or negative interest', () => {
    expect(taxOnInterestMinor(0)).toBe(0);
    expect(taxOnInterestMinor(-500)).toBe(0);
    expect(splitInterestTaxMinor(-500)).toEqual({
      incomeMinor: 0,
      militaryMinor: 0,
      totalMinor: 0,
    });
  });
});
