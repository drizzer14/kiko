// 23% = 18% personal income tax + 5% military levy on deposit/corporate-bond interest.
export const INTEREST_TAX_RATE_PCT = 23;

export const taxOnInterestMinor = (interestMinor: number): number =>
  interestMinor <= 0 ? 0 : Math.floor((interestMinor * INTEREST_TAX_RATE_PCT) / 100);
