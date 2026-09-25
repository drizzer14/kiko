import {
  loanInstallments,
  loanOutstandingMinorAt,
  type LoanInstallment,
} from '@kiko/holdings/loan-schedule';
import { Money } from '@kiko/currency/money';
import type { HoldingRow } from '@kiko/db/schema';
import { startOfLocalDay } from '@kiko/dates/local-day';
import type { PriceBook } from '@kiko/prices/price-book';
import type { HoldingType } from '@kiko/holdings/holding-type';
import { asBondMeta, asLoanMeta } from '@kiko/holdings/holding-metadata';
import { bondExpectedProfitMinor } from '@kiko/holdings/holding-descriptor/bond';

/** Which add action the detail screen's footer offers. */
export type FooterAction = 'contribution' | 'transaction' | 'updateValue' | 'addLot' | 'none';

// What the detail screen shows per holding type. Not exported: nothing
// outside this module needs to name the shape directly yet (every consumer
// reads it through `holdingDetailSpec`/`holdingDetailSpecOrUndefined`) — add
// the `export` back the moment a real consumer needs it (knip's "no unused
// export" gate).
type HoldingDetailSpec = {
  /** `synced` = `isSyncedHolding(holding, account)`. */
  footerAction: (synced: boolean) => FooterAction;
  /** The principal/gross/interest/tax table, or `null` to hide it. */
  breakdown: {
    principalLabelKey: 'holdingDetail.principal' | 'holdingDetail.cost';
    expectedProfit: (holding: HoldingRow) => Money | null;
  } | null;
  nextInstallment: (
    holding: HoldingRow,
    book: PriceBook,
    now: number,
  ) => LoanInstallment | undefined;
};

const noInstallment = (): undefined => undefined;

// Shared by every ledger-backed (non-ledgerless) type below: a synced
// (Monobank) holding's ledger is owned by the sync, so it offers no add
// action; a manual one takes the generic "Add transaction". None of these
// four show a breakdown or a next-installment panel. Exported so the screen
// can fall back to it for a stored `type` this registry does not recognize
// (`holdingDetailSpecOrUndefined`'s own doc comment) — the same tolerant
// result the pre-registry `footerActionFor`/`showBreakdown`/
// `nextLoanInstallment` gave any type outside their own explicit checks.
export const balanceSpec: HoldingDetailSpec = {
  footerAction: (synced) => (synced ? 'none' : 'transaction'),
  breakdown: null,
  nextInstallment: noInstallment,
};

// The next upcoming amortization row for an `'annuity'`/`'differentiated'`
// loan (T28) — the one this holding's next scheduled payment falls on, picked
// as the first installment whose due day is on or after `now`'s own LOCAL day
// (mirrors `priceAsOfCaption`'s day-key convention). `undefined` for an
// invalid/absent `LoanMeta`, a `'none'` schedule (no installments at all —
// `loanInstallments` already returns `[]` for it), once every installment has
// already come due (a fully repaid loan), and once an overpaid correction has
// already clamped the outstanding to 0 (N10a), even while `loanInstallments`
// still has future rows on the ORIGINAL schedule.
const loanNextInstallment = (
  holding: HoldingRow,
  book: PriceBook,
  now: number,
): LoanInstallment | undefined => {
  const meta = asLoanMeta(holding.metadata);

  if (meta === null || meta.schedule === 'none') {
    return undefined;
  }

  if (loanOutstandingMinorAt(meta, holding.id, book, now) <= 0) {
    return undefined;
  }

  const todayStart = startOfLocalDay(now);

  return loanInstallments(meta).find((row) => row.dueDate >= todayStart);
};

// A bond's whole-life expected profit (net coupons + nominal redeemed, less
// the price paid) — `null` for unparsable metadata.
const bondExpectedProfit = (holding: HoldingRow): Money | null => {
  const meta = asBondMeta(holding.metadata);

  return meta ? Money.of(holding.currency, bondExpectedProfitMinor(meta, holding.currency)) : null;
};

/**
 * The ONE place every holding type's detail-screen behavior is looked up:
 * its footer add action, its value-breakdown display, and its
 * next-loan-installment panel. Mirrors `holdingDescriptors`
 * (`src/holdings/holding-descriptor/`) — the `satisfies Record<HoldingType,
 * HoldingDetailSpec>` gives a compile error the moment a new holding type is
 * added without an entry here. `card`/`cash`/`crypto_asset`/`jar` share one
 * `balanceSpec` rather than four identical copies.
 */
export const holdingDetailSpecs = {
  term_deposit: {
    footerAction: () => 'contribution',
    breakdown: { principalLabelKey: 'holdingDetail.principal', expectedProfit: () => null },
    nextInstallment: noInstallment,
  },
  bond: {
    footerAction: () => 'none',
    breakdown: { principalLabelKey: 'holdingDetail.cost', expectedProfit: bondExpectedProfit },
    nextInstallment: noInstallment,
  },
  property_item: {
    footerAction: () => 'updateValue',
    breakdown: null,
    nextInstallment: noInstallment,
  },
  // `metal` opens the dedicated Lot form to record a buy/sell instead of the
  // generic price-point form — checked AHEAD of the priced-value branch a
  // type's own `isPricedHoldingType` would otherwise route through, since
  // `metal` is ALSO a priced type but must never offer "Update value": its
  // price comes from the SHARED `metal:<XAU|...>` instrument (kiko-pricing),
  // never a per-holding manual price point the way `property_item` uses.
  metal: {
    footerAction: () => 'addLot',
    breakdown: null,
    nextInstallment: noInstallment,
  },
  // A loan (T28) is ledgerless but still takes the SAME `'updateValue'`
  // action as a priced holding — it reuses `PricePointForm` to write a
  // correction onto its own `holding:<id>` manual series
  // (`loanOutstandingMinorAt` reads a correction there for every schedule,
  // not just `'none'`). The screen swaps the button's own label to "Update
  // outstanding" for this type; the navigation target is identical.
  loan: {
    footerAction: () => 'updateValue',
    breakdown: null,
    nextInstallment: loanNextInstallment,
  },
  card: balanceSpec,
  cash: balanceSpec,
  crypto_asset: balanceSpec,
  jar: balanceSpec,
} as const satisfies Record<HoldingType, HoldingDetailSpec>;

export const holdingDetailSpec = (type: HoldingType): HoldingDetailSpec => holdingDetailSpecs[type];

/**
 * A lookup safe for a `type` read straight off a stored row: the schema
 * types `holdings.type` as this exact enum, but SQLite enforces no such
 * constraint, so a corrupted row could hold any string — including an
 * inherited `Object.prototype` key such as `'constructor'`, which a plain
 * index would resolve to a non-`HoldingDetailSpec` value despite never being
 * a real holding type. `Object.hasOwn` checks the object's OWN keys only, so
 * those resolve to `undefined` too — mirroring `holdingDescriptorOrUndefined`
 * (`src/holdings/holding-descriptor/`).
 */
export const holdingDetailSpecOrUndefined = (type: HoldingType): HoldingDetailSpec | undefined => {
  const specs = holdingDetailSpecs as Record<string, HoldingDetailSpec>;

  return Object.hasOwn(specs, type) ? specs[type] : undefined;
};
