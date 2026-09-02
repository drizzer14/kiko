import { currencyScale } from '../currency/currency';
import { Money } from '../currency/money';
import type { HoldingRow } from '../db/schema';
import { asBondMeta, asTermDepositMeta } from './holding-metadata';
import { bondAccruedMajor, depositAccruedMajor, depositCompoundedMajor } from './interest';
import { taxOnInterestMinor } from './tax';

export type ValuableHolding = Pick<
  HoldingRow,
  'type' | 'currency' | 'balanceMinorUnits' | 'metadata'
>;

export type HoldingValueBreakdown = {
  gross: Money;
  principalOrCost: Money;
  interest: Money;
  tax: Money;
  net: Money;
};

const toMajor = (minorUnits: number, currency: ValuableHolding['currency']): number =>
  minorUnits / 10 ** currencyScale[currency];

const flat = (currency: ValuableHolding['currency'], minorUnits: number): HoldingValueBreakdown => {
  const money = Money.of(currency, minorUnits);
  const zero = Money.of(currency, 0);
  return { gross: money, principalOrCost: money, interest: zero, tax: zero, net: money };
};

const depositBreakdown = (holding: ValuableHolding, now: number): HoldingValueBreakdown => {
  const meta = asTermDepositMeta(holding.metadata);
  if (meta === null) {
    return flat(holding.currency, holding.balanceMinorUnits);
  }
  const { currency } = holding;
  const contributionsMajor = meta.contributions.map((c) => ({
    amountMajor: toMajor(c.amountMinorUnits, currency),
    date: c.date,
  }));
  const principalMinor = meta.contributions.reduce((s, c) => s + c.amountMinorUnits, 0);

  if (!meta.recapitalization) {
    // Value is held at the contributions sum; interest is paid out.
    // Tax/interest describe the current-period accrual for display only.
    const accruedMajorValue = depositAccruedMajor(
      contributionsMajor,
      meta.annualRatePct,
      meta.compounding,
      meta.termMonths,
      now,
    );
    const interestMinor = Money.fromMajor(currency, accruedMajorValue).minorUnits;
    const taxMinor = taxOnInterestMinor(interestMinor);
    return {
      gross: Money.of(currency, principalMinor),
      principalOrCost: Money.of(currency, principalMinor),
      interest: Money.of(currency, interestMinor),
      tax: Money.of(currency, taxMinor),
      net: Money.of(currency, principalMinor),
    };
  }

  const grossMajor = depositCompoundedMajor(
    contributionsMajor,
    meta.annualRatePct,
    meta.compounding,
    meta.termMonths,
    now,
  );
  const grossMinor = Money.fromMajor(currency, grossMajor).minorUnits;
  const interestMinor = Math.max(0, grossMinor - principalMinor);
  const taxMinor = taxOnInterestMinor(interestMinor);
  return {
    gross: Money.of(currency, grossMinor),
    principalOrCost: Money.of(currency, principalMinor),
    interest: Money.of(currency, interestMinor),
    tax: Money.of(currency, taxMinor),
    net: Money.of(currency, grossMinor - taxMinor),
  };
};

const bondBreakdown = (holding: ValuableHolding, now: number): HoldingValueBreakdown => {
  const meta = asBondMeta(holding.metadata);
  if (meta === null) {
    return flat(holding.currency, holding.balanceMinorUnits);
  }
  const { currency } = holding;
  const nominalMinor = meta.quantity * meta.faceValueMinorUnits;
  const accrued = bondAccruedMajor(
    toMajor(nominalMinor, currency),
    meta.couponPct,
    meta.couponFrequency,
    meta.purchaseDate,
    meta.maturityDate,
    now,
  );
  const accruedMinor = Money.fromMajor(currency, accrued).minorUnits;
  const grossMinor = nominalMinor + accruedMinor;
  const taxMinor = meta.bondKind === 'corporate' ? taxOnInterestMinor(accruedMinor) : 0;
  return {
    gross: Money.of(currency, grossMinor),
    principalOrCost: Money.of(currency, nominalMinor),
    interest: Money.of(currency, accruedMinor),
    tax: Money.of(currency, taxMinor),
    net: Money.of(currency, grossMinor - taxMinor),
  };
};

export const holdingValueBreakdown = (
  holding: ValuableHolding,
  now: number,
): HoldingValueBreakdown => {
  switch (holding.type) {
    case 'term_deposit':
      return depositBreakdown(holding, now);
    case 'bond':
      return bondBreakdown(holding, now);
    default:
      return flat(holding.currency, holding.balanceMinorUnits);
  }
};

export const holdingValue = (holding: ValuableHolding, now: number): Money =>
  holdingValueBreakdown(holding, now).net;
