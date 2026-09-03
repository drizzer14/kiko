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

// A single levy line on a cumulative basis: the bank keeps each levy's running
// total equal to round(cumulativeGross * rate), so a period's withheld amount is
// that rounded cumulative minus everything already withheld for the levy. With
// priorGrossMinor 0 this collapses to round(grossMinor * rate) — the single-shot
// per-period rounding.
const cumulativeLevyMinor = (
  grossMinor: number,
  priorGrossMinor: number,
  ratePct: number,
): number =>
  Math.round(((priorGrossMinor + grossMinor) * ratePct) / 100) -
  Math.round((priorGrossMinor * ratePct) / 100);

// Split the withholding on a gross interest amount (minor units) into its income
// and military components, each rounded to the minor unit separately. Zero or
// negative interest is never taxed.
//
// `priorGrossMinor` is the gross interest already withheld against earlier in the
// same running series (0 for a standalone one-off levy). The bank withholds each
// levy on a CUMULATIVE basis — the line is round(cumulativeGross * rate) minus
// what was already taken — which self-corrects the sub-kopeck drift a naive
// per-period round accumulates, so every ledger line matches the real statement.
export const splitInterestTaxMinor = (grossMinor: number, priorGrossMinor = 0): InterestTax => {
  if (grossMinor <= 0) {
    return { incomeMinor: 0, militaryMinor: 0, totalMinor: 0 };
  }
  const cumFrom = Math.max(priorGrossMinor, 0);
  const incomeMinor = cumulativeLevyMinor(grossMinor, cumFrom, INCOME_TAX_RATE_PCT);
  const militaryMinor = cumulativeLevyMinor(grossMinor, cumFrom, MILITARY_LEVY_RATE_PCT);
  return { incomeMinor, militaryMinor, totalMinor: incomeMinor + militaryMinor };
};

// The total withholding on a gross interest amount (minor units): the sum of the
// two separately-rounded levies.
export const taxOnInterestMinor = (grossMinor: number): number =>
  splitInterestTaxMinor(grossMinor).totalMinor;
