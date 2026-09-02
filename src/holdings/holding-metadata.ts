export type CompoundingFrequency = 'bi-weekly' | 'monthly' | 'quarterly' | 'annually';

export type DepositContribution = { amountMinorUnits: number; date: number };

export type TermDepositMeta = {
  contributions: DepositContribution[];
  annualRatePct: number;
  termMonths: number;
  recapitalization: boolean;
  compounding: CompoundingFrequency;
};

export type BondKind = 'government' | 'corporate';

export type BondCouponFrequency = 'monthly' | 'quarterly' | 'semiannually' | 'annually';

export type BondMeta = {
  quantity: number;
  faceValueMinorUnits: number;
  couponPct: number;
  purchaseDate: number;
  purchasePriceMinorUnits: number;
  maturityDate: number;
  bondKind: BondKind;
  couponFrequency: BondCouponFrequency;
};

const frequencies = new Set<string>(['bi-weekly', 'monthly', 'quarterly', 'annually']);

// Legacy deposits stored a now-removed 'daily' compounding option. Map any such
// record onto 'monthly' — the safe, conservative choice: it is an existing,
// well-tested calendar-anniversary mode that yields slightly LESS than the new
// default 'bi-weekly', so a migrated deposit never over-reports its value, and
// it avoids retro-fitting an opening-day anchor the record never carried.
const normalizeCompounding = (value: string): CompoundingFrequency =>
  value === 'daily' ? 'monthly' : (value as CompoundingFrequency);

const bondCouponFrequencies = new Set<string>(['monthly', 'quarterly', 'semiannually', 'annually']);

const asBondCouponFrequency = (value: unknown): BondCouponFrequency =>
  typeof value === 'string' && bondCouponFrequencies.has(value)
    ? (value as BondCouponFrequency)
    : 'annually';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const asContribution = (value: unknown): DepositContribution | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { amountMinorUnits, date } = value;
  if (!isNumber(amountMinorUnits) || !isNumber(date)) {
    return null;
  }
  return { amountMinorUnits, date };
};

const readContributions = (value: Record<string, unknown>): DepositContribution[] | null => {
  const { contributions, principalMinorUnits, startDate } = value;
  if (Array.isArray(contributions)) {
    const parsed = contributions.map(asContribution);
    if (parsed.length > 0 && parsed.every((c): c is DepositContribution => c !== null)) {
      return [...parsed].sort((a, b) => a.date - b.date);
    }
    return null;
  }
  if (isNumber(principalMinorUnits) && isNumber(startDate)) {
    return [{ amountMinorUnits: principalMinorUnits, date: startDate }];
  }
  return null;
};

export const asTermDepositMeta = (value: unknown): TermDepositMeta | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { annualRatePct, termMonths, recapitalization, compounding } = value;
  const contributions = readContributions(value);
  // Accept the legacy 'daily' literal so existing deposits still parse; it is
  // normalized to 'monthly' below rather than rejected.
  if (
    contributions === null ||
    !isNumber(annualRatePct) ||
    !isNumber(termMonths) ||
    typeof recapitalization !== 'boolean' ||
    typeof compounding !== 'string' ||
    !(frequencies.has(compounding) || compounding === 'daily')
  ) {
    return null;
  }
  return {
    contributions,
    annualRatePct,
    termMonths,
    recapitalization,
    compounding: normalizeCompounding(compounding),
  };
};

export const asBondMeta = (value: unknown): BondMeta | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { quantity, faceValueMinorUnits, couponPct, purchaseDate, maturityDate, bondKind } = value;
  if (
    !isNumber(quantity) ||
    !isNumber(faceValueMinorUnits) ||
    !isNumber(couponPct) ||
    !isNumber(purchaseDate) ||
    !isNumber(maturityDate)
  ) {
    return null;
  }
  // `purchasePriceMinorUnits` is the total actually paid (separate from nominal
  // = quantity * faceValue). Legacy bonds predate this field; default it to the
  // nominal so the purchase ledger entry and expected-profit both read as
  // break-even until the user edits the real price in.
  const nominalMinorUnits = quantity * faceValueMinorUnits;
  const { purchasePriceMinorUnits } = value;
  return {
    quantity,
    faceValueMinorUnits,
    couponPct,
    purchaseDate,
    purchasePriceMinorUnits: isNumber(purchasePriceMinorUnits)
      ? purchasePriceMinorUnits
      : nominalMinorUnits,
    maturityDate,
    bondKind: bondKind === 'corporate' ? 'corporate' : 'government',
    couponFrequency: asBondCouponFrequency(value.couponFrequency),
  };
};
