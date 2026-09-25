import { P, match } from 'ts-pattern';

import { Money } from '../../currency/money';
import { asLoanMeta } from '../holding-metadata';
import type { HoldingRow } from '../../db/schema';
import { isPricedHoldingType } from '../priced-value';
import { loanOutstandingMinorAt } from '../loan-schedule';
import { bondDescriptor } from '../holding-descriptor/bond';
import { metalPricedSpec } from '../holding-descriptor/metal';
import { pricedBreakdown } from '../holding-descriptor/priced-parts';
import { termDepositDescriptor } from '../holding-descriptor/term-deposit';
import { EMPTY_PRICE_BOOK, type PriceBook } from '../../prices/price-book';
import { propertyItemPricedSpec } from '../holding-descriptor/property-item';
import { flat, type HoldingValueBreakdown } from '../holding-descriptor/breakdown-parts';

/**
 * `id` is optional — mirroring `PricedHolding` (`src/holdings/priced-value/`)
 * — so every existing test fixture across the app's holding-value suites
 * (a synthetic cash/deposit/bond literal with no real row) keeps compiling
 * unchanged. A PRICED holding (`isPricedHoldingType`) needs its own `id` to
 * resolve its `holding:<id>` instrument key; one with no `id` simply reads as
 * having no stored price point (falls back to its lots' cost basis).
 */
export type ValuableHolding = Pick<
  HoldingRow,
  'type' | 'currency' | 'balanceMinorUnits' | 'metadata'
> & { id?: HoldingRow['id'] };

export type { HoldingValueBreakdown };

// A loan's held value is NEGATIVE (spec 5, T27): it is debt, not an asset, so
// `holdingValue`/net-worth subtract it by simply summing every holding's own
// signed value. `gross`/`net` are minus the outstanding balance at `now`
// (`loanOutstandingMinorAt` — M4 already returns 0 before the loan's own
// `startDate`, so a not-yet-taken loan contributes nothing, mirroring a
// priced holding before its first lot). `principalOrCost` is minus the
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
    // M1 (T27 round 1, carried from the T26 review finding (c)): a debt must
    // never read as a positive asset — missing/malformed metadata values the
    // loan at 0, NOT `holding.balanceMinorUnits` (the flat fallback every
    // other type uses), which would otherwise surface as a positive balance.
    return flat(holding.currency, 0);
  }
  const { currency } = holding;
  const outstandingMinor = loanOutstandingMinorAt(meta, holding.id ?? '', book, now);
  // `outstandingMinor` is always clamped >= 0 (`loanOutstandingMinorAt`);
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

// A priced type's own spec, keyed off `holding.type` directly rather than a
// registry (B7 adds one): `metal` reads the shared `metal:<XAU|...>`
// instrument; every OTHER priced type (today only `property_item`) reads its
// own `holding:<id>` instrument, mirroring `pricedLotsOf`'s old fallback.
const pricedSpecFor = (type: ValuableHolding['type']) =>
  type === 'metal' ? metalPricedSpec : propertyItemPricedSpec;

export const holdingValueBreakdown = (
  holding: ValuableHolding,
  now: number,
  book: PriceBook = EMPTY_PRICE_BOOK,
): HoldingValueBreakdown =>
  match(holding.type)
    .with(P.when(isPricedHoldingType), () =>
      pricedBreakdown(pricedSpecFor(holding.type), holding, now, book),
    )
    .with('term_deposit', () => termDepositDescriptor.breakdown(holding, now, book))
    .with('bond', () => bondDescriptor.breakdown(holding, now, book))
    .with('loan', () => loanBreakdown(holding, now, book))
    // Not `.exhaustive()`: the original `switch`'s `default` branch tolerated
    // any unmatched value, not only the 3 other named literal types — a
    // malformed or absent `type` falls back to the flat stored balance
    // instead of throwing.
    .otherwise(() => flat(holding.currency, holding.balanceMinorUnits));

export const holdingValue = (
  holding: ValuableHolding,
  now: number,
  book: PriceBook = EMPTY_PRICE_BOOK,
): Money => holdingValueBreakdown(holding, now, book).net;
