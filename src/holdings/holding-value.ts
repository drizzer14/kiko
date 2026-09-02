import { currencyScale } from '../currency/currency';
import { Money } from '../currency/money';
import type { HoldingRow } from '../db/schema';
import { asBondMeta, asTermDepositMeta } from './holding-metadata';
import { accruedMajor, addMonths, compoundedMajor, daysBetween, periodDays } from './interest';

export type ValuableHolding = Pick<
  HoldingRow,
  'type' | 'currency' | 'balanceMinorUnits' | 'metadata'
>;

const cachedBalance = (holding: ValuableHolding): Money =>
  Money.of(holding.currency, holding.balanceMinorUnits);

const toMajor = (minorUnits: number, currency: ValuableHolding['currency']): number =>
  minorUnits / 10 ** currencyScale[currency];

const termDepositValue = (holding: ValuableHolding, now: number): Money => {
  const meta = asTermDepositMeta(holding.metadata);
  if (meta === null) {
    return cachedBalance(holding);
  }
  if (!meta.recapitalization) {
    return Money.of(holding.currency, meta.principalMinorUnits);
  }
  const maturity = addMonths(meta.startDate, meta.termMonths);
  const days = daysBetween(meta.startDate, Math.min(now, maturity));
  const principalMajor = toMajor(meta.principalMinorUnits, holding.currency);
  const valueMajor = compoundedMajor(principalMajor, meta.annualRatePct, meta.compounding, days);
  return Money.fromMajor(holding.currency, valueMajor);
};

const bondValue = (holding: ValuableHolding, now: number): Money => {
  const meta = asBondMeta(holding.metadata);
  if (meta === null) {
    return cachedBalance(holding);
  }
  const nominalMinor = meta.quantity * meta.faceValueMinorUnits;
  const days = daysBetween(meta.purchaseDate, Math.min(now, meta.maturityDate));
  const nominalMajor = toMajor(nominalMinor, holding.currency);
  const accrued = accruedMajor(nominalMajor, meta.couponPct, days);
  return Money.fromMajor(holding.currency, nominalMajor + accrued);
};

export const holdingValue = (holding: ValuableHolding, now: number): Money => {
  switch (holding.type) {
    case 'term_deposit':
      return termDepositValue(holding, now);
    case 'bond':
      return bondValue(holding, now);
    default:
      return cachedBalance(holding);
  }
};

export const accruedInterest = (holding: ValuableHolding, now: number): Money | null => {
  if (holding.type !== 'term_deposit') {
    return null;
  }
  const meta = asTermDepositMeta(holding.metadata);
  if (meta === null || meta.recapitalization) {
    return null;
  }
  const maturity = addMonths(meta.startDate, meta.termMonths);
  const days = daysBetween(meta.startDate, Math.min(now, maturity));
  const period = periodDays(meta.compounding);
  const daysIntoPeriod = days - Math.floor(days / period) * period;
  const principalMajor = toMajor(meta.principalMinorUnits, holding.currency);
  const accrued = accruedMajor(principalMajor, meta.annualRatePct, daysIntoPeriod);
  return Money.fromMajor(holding.currency, accrued);
};
