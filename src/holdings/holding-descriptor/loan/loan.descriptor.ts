import { Money } from '../../../currency/money';
import { asLoanMeta } from '../../holding-metadata';
import type { ValuableHolding } from '../../holding-value';
import type { PriceBook } from '../../../prices/price-book';
import { loanLedgerOutstandingMinorAt } from '../../loan-ledger';
import type { HoldingDescriptor } from '../holding-descriptor.d';
import { entityColorsDark } from '../../../design-system/palette';
import { flat, type HoldingValueBreakdown } from '../breakdown-parts';

// A loan's held value is NEGATIVE: it is debt, not an asset, so
// `holdingValue`/net-worth subtract it by simply summing every holding's own
// signed value. `gross`/`net` are minus the outstanding balance at `now` —
// from the loan's linked payments when any count by `now`, else the schedule
// (`loanLedgerOutstandingMinorAt`), so every site reading this breakdown
// shows the same number. It is 0 before the loan's own `startDate`, so a
// not-yet-taken loan contributes nothing, mirroring a priced holding before
// its first lot. `principalOrCost` is minus the
// ORIGINAL principal, flat, regardless of how much has been paid down —
// mirroring `principalOrCost`'s role elsewhere as the reference point a
// gain/loss (here, a payoff progress) is measured against, not the current
// balance. A loan never accrues interest/tax at valuation time (interest is
// a ledger event on payment, `loanInterestForPaymentMinor` — not a held
// value), so both stay zero.
const loanBreakdown = (
  holding: ValuableHolding,
  now: number,
  book: PriceBook,
): HoldingValueBreakdown => {
  const meta = asLoanMeta(holding.metadata);

  if (meta === null) {
    // A debt must never read as a positive asset — missing/malformed
    // metadata values the loan at 0, NOT `holding.balanceMinorUnits` (the
    // flat fallback every other type uses), which would otherwise surface
    // as a positive balance.
    return flat(holding.currency, 0);
  }
  const { currency } = holding;
  const outstandingMinor = loanLedgerOutstandingMinorAt(meta, holding, book, now);
  // `outstandingMinor` is always clamped >= 0 (`loanLedgerOutstandingMinorAt`);
  // negating it directly would produce `-0` for a paid-off loan (`Object.is`
  // distinguishes `-0` from `0`, which a `toBe(0)` assertion catches), so the
  // `|| 0` normalizes the zero case back to a plain `0`.
  const negatedOutstandingMinor = -outstandingMinor || 0;
  const zero = Money.of(currency, 0);

  return {
    gross: Money.of(currency, negatedOutstandingMinor),
    principalOrCost: Money.of(currency, -meta.principalMinorUnits),
    interest: zero,
    tax: zero,
    net: Money.of(currency, negatedOutstandingMinor),
  };
};

export const loanDescriptor: HoldingDescriptor = {
  symbol: 'minus.circle.fill',
  defaultColor: entityColorsDark.red,
  side: 'debt',
  ledgerless: true,
  timeExempt: false,
  fixedCurrency: null,
  exchange: {
    receivePath: 'excluded',
    source: false,
    createSource: false,
    createDestination: false,
  },
  priced: null,
  breakdown: (holding, now, book) => loanBreakdown(holding, now, book),
  entries: () => [],
};
