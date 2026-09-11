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

  describe('cumulative-basis withholding (matches the bank statement line by line)', () => {
    // The bank keeps each levy's running total equal to round(cumulativeGross *
    // rate); a period's withheld line is that rounded cumulative minus what was
    // already withheld. This self-corrects the sub-kopeck drift that a naive
    // per-period round(gross*rate) accumulates, so every ledger line matches the
    // real statement.
    it('defaults to the plain per-period rounding when no prior gross is given', () => {
      // priorGrossMinor defaults to 0, so the cumulative reduces to round(gross*rate):
      // identical to the single-shot behaviour every existing caller relies on.
      expect(splitInterestTaxMinor(87_671, 0)).toEqual(splitInterestTaxMinor(87_671));
    });

    it('reconciles the statement 12 Feb military levy to 25.20, not a naive 25.21', () => {
      // Second accrual: this-period gross 504.11 (50 411), prior cumulative gross
      // 876.71 (87 671). Cumulative military = round(1380.82*5%)=6904 minus the
      // 4384 already withheld = 2520 (25.20) — exactly the statement, where the
      // naive round(504.11*5%) would over-withhold to 25.21.
      const tax = splitInterestTaxMinor(50_411, 87_671);
      expect(tax.incomeMinor).toBe(9_074); // round(138082*18%)=24855 - round(87671*18%)=15781
      expect(tax.militaryMinor).toBe(2_520); // round(138082*5%)=6904 - round(87671*5%)=4384
      expect(tax.totalMinor).toBe(11_594);
    });
  });
});
