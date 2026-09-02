export type CompoundingFrequency = 'daily' | 'monthly' | 'quarterly' | 'annually';

export type TermDepositMeta = {
  principalMinorUnits: number;
  annualRatePct: number;
  startDate: number;
  termMonths: number;
  recapitalization: boolean;
  compounding: CompoundingFrequency;
};

export type BondMeta = {
  quantity: number;
  faceValueMinorUnits: number;
  couponPct: number;
  purchaseDate: number;
  maturityDate: number;
};

const frequencies = new Set<string>(['daily', 'monthly', 'quarterly', 'annually']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const asTermDepositMeta = (value: unknown): TermDepositMeta | null => {
  if (!isRecord(value)) {
    return null;
  }
  const {
    principalMinorUnits,
    annualRatePct,
    startDate,
    termMonths,
    recapitalization,
    compounding,
  } = value;
  if (
    !isNumber(principalMinorUnits) ||
    !isNumber(annualRatePct) ||
    !isNumber(startDate) ||
    !isNumber(termMonths) ||
    typeof recapitalization !== 'boolean' ||
    typeof compounding !== 'string' ||
    !frequencies.has(compounding)
  ) {
    return null;
  }
  return {
    principalMinorUnits,
    annualRatePct,
    startDate,
    termMonths,
    recapitalization,
    compounding: compounding as CompoundingFrequency,
  };
};

export const asBondMeta = (value: unknown): BondMeta | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { quantity, faceValueMinorUnits, couponPct, purchaseDate, maturityDate } = value;
  if (
    !isNumber(quantity) ||
    !isNumber(faceValueMinorUnits) ||
    !isNumber(couponPct) ||
    !isNumber(purchaseDate) ||
    !isNumber(maturityDate)
  ) {
    return null;
  }
  return { quantity, faceValueMinorUnits, couponPct, purchaseDate, maturityDate };
};
