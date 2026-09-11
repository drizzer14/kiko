import type { TFunction } from 'i18next';
import { match } from 'ts-pattern';

import { Money, toMajor } from '../../currency/money';
import { asBondMeta, asTermDepositMeta } from '../holding-metadata';
import { holdingValueBreakdown, type ValuableHolding } from '../holding-value';
import { bondCouponDates, bondCouponMajor, depositLedger } from '../interest';
import { INCOME_TAX_RATE_PCT, MILITARY_LEVY_RATE_PCT, taxOnInterestMinor } from '../tax';

export type DerivedEntryKind =
  | 'contribution'
  | 'accrual'
  | 'income-tax'
  | 'military-levy'
  | 'capitalization'
  | 'interest'
  | 'tax'
  | 'purchase'
  | 'coupon'
  | 'redemption';

// The ledger tone a derived entry reads in: withholding lines are `negative`
// (red), interest/coupon accruals are `positive` (green), and the principal
// movements (a deposit contribution, a bond purchase/redemption) stay `neutral`
// so only genuine gains and taxes carry color. Classified by KIND, not by the
// sign of the amount, so an entry always reads the same regardless of sign.
export type EntryTone = 'positive' | 'negative' | 'neutral';

const toneForKind = (kind: DerivedEntryKind): EntryTone =>
  match(kind)
    .with('income-tax', 'military-levy', 'tax', (): EntryTone => 'negative')
    .with('accrual', 'interest', 'capitalization', 'coupon', (): EntryTone => 'positive')
    .with('contribution', 'purchase', 'redemption', (): EntryTone => 'neutral')
    .exhaustive();

export type DerivedEntry = {
  id: string;
  time: number;
  amountMinorUnits: number;
  label: string;
  kind: DerivedEntryKind;
  tone: EntryTone;
  // A projected entry dated after `now` — a future accrual/coupon/capitalization
  // or a scheduled future contribution. The ledger renders these dimmed as
  // "Projected".
  isFuture: boolean;
  derived: true;
};

type IdentifiedHolding = ValuableHolding & { id: string };

const makeEntry = (
  holdingId: string,
  kind: DerivedEntryKind,
  index: number,
  time: number,
  amountMinorUnits: number,
  label: string,
  now: number,
): DerivedEntry => ({
  id: `derived:${holdingId}:${kind}:${index}`,
  time,
  amountMinorUnits,
  label,
  kind,
  tone: toneForKind(kind),
  isFuture: time > now,
  derived: true,
});

// The opening deposit and each top-up as contribution entries (opening first,
// the rest labelled "Top-up").
const contributionEntries = (
  holding: IdentifiedHolding,
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
  holding: IdentifiedHolding,
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
const depositEntries = (holding: IdentifiedHolding, now: number, t: TFunction): DerivedEntry[] => {
  const meta = asTermDepositMeta(holding.metadata);
  if (meta === null) {
    return [];
  }
  const entries = contributionEntries(holding, now, t);
  if (!meta.recapitalization) {
    const breakdown = holdingValueBreakdown(holding, now);
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

const bondEntries = (holding: IdentifiedHolding, now: number, t: TFunction): DerivedEntry[] => {
  const meta = asBondMeta(holding.metadata);
  if (meta === null) {
    return [];
  }
  const { currency } = holding;
  const nominalMinorUnits = meta.quantity * meta.faceValueMinorUnits;
  const nominalMajor = toMajor(nominalMinorUnits, currency);
  const grossCouponMinor = Money.fromMajor(
    currency,
    bondCouponMajor(nominalMajor, meta.couponPct, meta.couponFrequency),
  ).minorUnits;
  // Each coupon pays out net of the corporate 23% withholding (government bonds
  // are untaxed). The bank credits the net amount, so that is the ledger entry.
  const netCouponMinor =
    grossCouponMinor - (meta.bondKind === 'corporate' ? taxOnInterestMinor(grossCouponMinor) : 0);
  const couponDates = bondCouponDates(meta.purchaseDate, meta.maturityDate, meta.couponFrequency);

  // Purchase (money out), each coupon (money in, net), and redemption of the
  // nominal at maturity (money in). Past entries render as real ledger rows;
  // entries dated after `now` render dimmed as projected.
  return [
    makeEntry(
      holding.id,
      'purchase',
      0,
      meta.purchaseDate,
      -meta.purchasePriceMinorUnits,
      t('holdingDetail.purchase'),
      now,
    ),
    ...couponDates.map((couponDate, index) =>
      makeEntry(
        holding.id,
        'coupon',
        index,
        couponDate,
        netCouponMinor,
        t('holdingDetail.coupon'),
        now,
      ),
    ),
    makeEntry(
      holding.id,
      'redemption',
      0,
      meta.maturityDate,
      nominalMinorUnits,
      t('holdingDetail.redemption'),
      now,
    ),
  ];
};

const entriesForType = (holding: IdentifiedHolding, now: number, t: TFunction): DerivedEntry[] => {
  if (holding.type === 'term_deposit') {
    return depositEntries(holding, now, t);
  }
  if (holding.type === 'bond') {
    return bondEntries(holding, now, t);
  }
  return [];
};

// The derived lifecycle entries for a holding, sorted oldest-first. Entries that
// share an instant (an accrual and its two withholding lines and any
// capitalization on the same date) keep their emitted order under the stable
// sort. Not a React component (a plain render-time helper the caller's own
// `useTranslation()` feeds `t` into), so every label re-resolves against the
// active language on every call rather than freezing to a module-load-time
// language.
export const derivedEntries = (
  holding: IdentifiedHolding,
  now: number,
  t: TFunction,
): DerivedEntry[] => [...entriesForType(holding, now, t)].sort((a, b) => a.time - b.time);
