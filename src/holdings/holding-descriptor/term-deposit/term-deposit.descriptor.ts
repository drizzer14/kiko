import type { TFunction } from 'i18next';

import { makeEntry } from '../entry-parts';
import { Money, toMajor } from '../../../currency/money';
import type { DerivedEntry } from '../../derived-entries';
import { asTermDepositMeta } from '../../holding-metadata';
import type { ValuableHolding } from '../../holding-value';
import type { HoldingDescriptor } from '../holding-descriptor.d';
import { entityColorsDark } from '../../../design-system/palette';
import { depositAccruedMajor, depositLedger } from '../../interest';
import { flat, makeBreakdown, type HoldingValueBreakdown } from '../breakdown-parts';
import { INCOME_TAX_RATE_PCT, MILITARY_LEVY_RATE_PCT, taxOnInterestMinor } from '../../tax';

const depositBreakdown = (holding: ValuableHolding, now: number): HoldingValueBreakdown => {
  const meta = asTermDepositMeta(holding.metadata);
  if (meta === null) {
    return flat(holding.currency, holding.balanceMinorUnits);
  }
  const { currency } = holding;
  // A contribution dated after `now` is not yet credited: exclude it from both
  // the principal and the compounded/accrued value so a future top-up never
  // shows in the present balance.
  const active = meta.contributions.filter((c) => c.date <= now);
  if (active.length === 0) {
    return flat(currency, 0);
  }

  if (!meta.recapitalization) {
    // Interest is paid out each period rather than compounded. We surface the
    // CUMULATIVE simple interest accrued to date, net of tax, and count it in
    // the deposit's value/net worth (principal + net interest).
    const contributionsMajor = active.map((c) => ({
      amountMajor: toMajor(c.amountMinorUnits, currency),
      date: c.date,
    }));
    const principalMinor = active.reduce((sum, c) => sum + c.amountMinorUnits, 0);
    const accruedMajorValue = depositAccruedMajor(
      contributionsMajor,
      meta.annualRatePct,
      meta.termMonths,
      now,
    );
    const interestMinor = Money.fromMajor(currency, accruedMajorValue).minorUnits;
    const taxMinor = taxOnInterestMinor(interestMinor);
    return makeBreakdown(currency, principalMinor, interestMinor, taxMinor);
  }

  // Recapitalizing deposits iterate the step-by-step engine (no closed form):
  // per-period interest on the last capitalized balance, withheld net of the
  // 18%+5% tax and capitalized on each anniversary (bi-weekly capitalizes once a
  // month). The value is the last capitalized balance plus landed contributions
  // — the in-progress accrual is excluded, which is the fix for the old
  // overvaluation. `capitalizedGross`/`capitalizedTax` are the realized totals,
  // so principal + gross - tax reconciles exactly to the net current value.
  const ledger = depositLedger(
    meta.contributions.map((c) => ({ amountMinor: c.amountMinorUnits, date: c.date })),
    meta.annualRatePct,
    meta.compounding,
    meta.termMonths,
    now,
  );
  return makeBreakdown(
    currency,
    ledger.principalMinor,
    ledger.capitalizedGrossMinor,
    ledger.capitalizedTaxMinor,
  );
};

// The opening deposit and each top-up as contribution entries (opening first,
// the rest labelled "Top-up").
const contributionEntries = (
  holding: ValuableHolding,
  now: number,
  t: TFunction,
): DerivedEntry[] => {
  const meta = asTermDepositMeta(holding.metadata);
  if (meta === null) {
    return [];
  }
  return meta.contributions.map((contribution, index) =>
    makeEntry(
      holding.id,
      'contribution',
      index,
      contribution.date,
      contribution.amountMinorUnits,
      index === 0 ? t('holdingDetail.openingDeposit') : t('holdingDetail.topUp'),
      now,
    ),
  );
};

// The per-accrual lifecycle lines for a recap-ON deposit: an "Interest accrual"
// (+gross), an "Income tax 18%" and a "Military levy 5%" (negative withholding
// lines) per period, and a "Capitalization" (+net) on each capitalization
// instant — the bank statement's line structure. Amounts come from the
// step-by-step ledger, so past lines are settled and future ones project.
const recapAccrualEntries = (
  holding: ValuableHolding,
  meta: NonNullable<ReturnType<typeof asTermDepositMeta>>,
  now: number,
  t: TFunction,
): DerivedEntry[] => {
  const ledger = depositLedger(
    meta.contributions.map((c) => ({ amountMinor: c.amountMinorUnits, date: c.date })),
    meta.annualRatePct,
    meta.compounding,
    meta.termMonths,
    now,
  );
  const entries: DerivedEntry[] = [];
  const counters = { accrual: 0, 'income-tax': 0, 'military-levy': 0, capitalization: 0 };
  const push = (kind: keyof typeof counters, time: number, amount: number, label: string): void => {
    entries.push(makeEntry(holding.id, kind, counters[kind], time, amount, label, now));
    counters[kind] += 1;
  };
  for (const accrual of ledger.accruals) {
    if (accrual.grossMinor > 0) {
      push('accrual', accrual.date, accrual.grossMinor, t('holdingDetail.interestAccrual'));
    }
    if (accrual.incomeTaxMinor > 0) {
      push(
        'income-tax',
        accrual.date,
        -accrual.incomeTaxMinor,
        t('holdingDetail.incomeTax', { pct: INCOME_TAX_RATE_PCT }),
      );
    }
    if (accrual.militaryLevyMinor > 0) {
      push(
        'military-levy',
        accrual.date,
        -accrual.militaryLevyMinor,
        t('holdingDetail.militaryLevy', { pct: MILITARY_LEVY_RATE_PCT }),
      );
    }
    if (accrual.capitalized && accrual.capitalizationMinor !== 0) {
      push(
        'capitalization',
        accrual.date,
        accrual.capitalizationMinor,
        t('holdingDetail.capitalization'),
      );
    }
  }
  return entries;
};

// The full deposit lifecycle as inline ledger entries. Recap-ON deposits expand
// to the opening/top-ups plus the per-accrual interest/tax/capitalization lines;
// a recap-OFF deposit pays interest out instead of compounding, so it surfaces a
// single cumulative interest/tax pair at `now`.
const depositEntries = (holding: ValuableHolding, now: number, t: TFunction): DerivedEntry[] => {
  const meta = asTermDepositMeta(holding.metadata);
  if (meta === null) {
    return [];
  }
  const entries = contributionEntries(holding, now, t);
  if (!meta.recapitalization) {
    const breakdown = depositBreakdown(holding, now);
    if (breakdown.interest.minorUnits > 0) {
      entries.push(
        makeEntry(
          holding.id,
          'interest',
          0,
          now,
          breakdown.interest.minorUnits,
          t('holdingDetail.interest'),
          now,
        ),
      );
    }
    if (breakdown.tax.minorUnits > 0) {
      entries.push(
        makeEntry(
          holding.id,
          'tax',
          0,
          now,
          -breakdown.tax.minorUnits,
          t('holdingDetail.tax'),
          now,
        ),
      );
    }
    return entries;
  }
  return [...entries, ...recapAccrualEntries(holding, meta, now, t)];
};

export const termDepositDescriptor: HoldingDescriptor = {
  symbol: 'calendar',
  defaultColor: entityColorsDark.blue,
  side: 'asset',
  ledgerless: true,
  timeExempt: true,
  fixedCurrency: null,
  exchange: {
    receivePath: 'contribution',
    source: false,
    createSource: false,
    createDestination: false,
  },
  priced: null,
  breakdown: (holding, now) => depositBreakdown(holding, now),
  entries: depositEntries,
};
