// Ukrainian withholding on deposit and corporate-bond interest: 18% personal
// income tax + 5% military levy, BOTH assessed on the gross interest. The bank
// withholds them as two separate lines, each rounded to the minor unit
// (kopeck) on its own — so the combined withholding is
// round(gross*18%) + round(gross*5%), never a single round(gross*23%). This is
// the one source of truth for the rates and the split.
export const INCOME_TAX_RATE_PCT = 18;
export const MILITARY_LEVY_RATE_PCT = 5;
// The combined headline rate, kept for callers that only need the total (e.g. a
// government bond is 0%, a corporate bond/deposit is this).
export const INTEREST_TAX_RATE_PCT = INCOME_TAX_RATE_PCT + MILITARY_LEVY_RATE_PCT;

type InterestTax = {
  incomeMinor: number;
  militaryMinor: number;
  totalMinor: number;
};

// Split the withholding on a gross interest amount (minor units) into its income
// and military components, each rounded to the minor unit separately. Zero or
// negative interest is never taxed.
export const splitInterestTaxMinor = (grossMinor: number): InterestTax => {
  if (grossMinor <= 0) {
    return { incomeMinor: 0, militaryMinor: 0, totalMinor: 0 };
  }
  const incomeMinor = Math.round((grossMinor * INCOME_TAX_RATE_PCT) / 100);
  const militaryMinor = Math.round((grossMinor * MILITARY_LEVY_RATE_PCT) / 100);
  return { incomeMinor, militaryMinor, totalMinor: incomeMinor + militaryMinor };
};

// The total withholding on a gross interest amount (minor units): the sum of the
// two separately-rounded levies.
export const taxOnInterestMinor = (grossMinor: number): number =>
  splitInterestTaxMinor(grossMinor).totalMinor;
