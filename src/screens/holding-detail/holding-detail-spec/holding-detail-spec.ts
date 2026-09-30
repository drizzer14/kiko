import { match } from 'ts-pattern';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { startOfLocalDay } from '@kiko/dates';
import type { PriceBook } from '@kiko/prices/price-book';
import type { HoldingType } from '@kiko/holdings/holding-type';
import { bondYieldToMaturity } from '@kiko/bonds/yield-to-maturity';
import { loanLedgerOutstandingMinorAt } from '@kiko/holdings/loan-ledger';
import { bondExpectedProfitMinor } from '@kiko/holdings/holding-descriptor';
import { type BondTerms, holdingRegisterCoupons } from '@kiko/bonds/nbu-register';
import { loanInstallments, type LoanInstallment } from '@kiko/holdings/loan-schedule';
import { asBondMeta, asLoanMeta, asShareMeta } from '@kiko/holdings/holding-metadata';

/** Which add action the detail screen's footer offers. */
export type FooterAction =
  | 'contribution'
  | 'transaction'
  | 'updateValue'
  | 'addLot'
  | 'addLotAndUpdatePrice'
  | 'none';

// The three breakdown shapes the detail screen renders (`holding-detail.screen.tsx`'s
// own `breakdownRows` dispatches on `kind`). `interest` is the
// principal-or-cost/gross/interest/tax table a deposit or bond accrues.
// `priced` is the cost/value/gain table a priced type (`property_item`,
// `metal`, `share`) shows instead — it has no interest or tax to withhold, so those
// rows would only ever read a misleading zero. `loan` is the
// principal/paid/interest paid/principal repaid/outstanding table read from
// the loan's linked payments (`loanLedgerSummary`). A bond's expected profit
// and yield to maturity read the register's cached terms for its ISIN, which
// the screen queries (`registerTerms`, null when there are none).
export type HoldingBreakdownSpec =
  | {
      kind: 'interest';
      principalLabelKey: 'holdingDetail.principal' | 'holdingDetail.cost';
      expectedProfit: (holding: HoldingRow, registerTerms: BondTerms | null) => Money | null;
      yieldToMaturity: (holding: HoldingRow, registerTerms: BondTerms | null) => number | null;
    }
  | { kind: 'priced' }
  | { kind: 'loan' };

// What the detail screen shows per holding type. Not exported: every
// consumer reads a value of this shape through `holdingDetailSpecFor` below
// rather than naming the type directly.
type HoldingDetailSpec = {
  /** `synced` = `isSyncedHolding(holding, account)`. */
  footerAction: (synced: boolean, holding: Pick<HoldingRow, 'metadata'>) => FooterAction;
  /** The breakdown table to show, or `null` to hide it. */
  breakdown: HoldingBreakdownSpec | null;
  upcomingInstallments: (
    holding: HoldingRow,
    book: PriceBook,
    now: number,
  ) => readonly LoanInstallment[];
};

const noInstallments = (): readonly LoanInstallment[] => [];

// Shared by every ledger-backed (non-ledgerless) type below: a synced
// (Monobank) holding's ledger is owned by the sync, so it offers no add
// action; a manual one takes the generic "Add transaction". None of these
// four show a breakdown or upcoming payments. Also the fallback
// `holdingDetailSpecFor` returns for a stored `type` this registry does not
// recognize.
const balanceSpec: HoldingDetailSpec = {
  footerAction: (synced) => (synced ? 'none' : 'transaction'),
  breakdown: null,
  upcomingInstallments: noInstallments,
};

// Every remaining amortization row of an `'annuity'`/`'differentiated'`
// loan: each installment whose due day is on or after `now`'s own LOCAL day
// (mirrors `price_points`' `dayKeyOf` day-key convention), in schedule
// order. Empty for an invalid/absent `LoanMeta`, a `'none'` schedule (no
// installments at all — `loanInstallments` already returns `[]` for it),
// once every installment has already come due, and once the outstanding
// reads 0 — the same outstanding every other screen shows
// (`loanLedgerOutstandingMinorAt`), so an overpaid correction or linked
// payments that repaid the loan hide the list even while `loanInstallments`
// still has future rows on the ORIGINAL schedule.
const loanUpcomingInstallments = (
  holding: HoldingRow,
  book: PriceBook,
  now: number,
): readonly LoanInstallment[] => {
  const meta = asLoanMeta(holding.metadata);

  if (meta === null || meta.schedule === 'none') {
    return [];
  }

  if (loanLedgerOutstandingMinorAt(meta, holding, book, now) <= 0) {
    return [];
  }

  const todayStart = startOfLocalDay(now);

  return loanInstallments(meta).filter((row) => row.dueDate >= todayStart);
};

// A manual share has no price feed, so its footer also updates its price; an
// EODHD share (or one whose metadata does not parse) only adds lots.
const shareFooterAction = (holding: Pick<HoldingRow, 'metadata'>): FooterAction =>
  match(asShareMeta(holding.metadata)?.quoteSource)
    .with('manual', (): FooterAction => 'addLotAndUpdatePrice')
    .with('eodhd', undefined, (): FooterAction => 'addLot')
    .exhaustive();

// A bond's whole-life expected profit (net coupons + nominal redeemed, less
// the price paid), each coupon at its own register rate when the cache has
// them — `null` for unparsable metadata.
const bondExpectedProfit = (holding: HoldingRow, registerTerms: BondTerms | null): Money | null =>
  foldMap(maybe(asBondMeta(holding.metadata)), (meta) =>
    Money.of(
      holding.currency,
      bondExpectedProfitMinor(
        meta,
        holding.currency,
        holdingRegisterCoupons(holding.metadata, holding.currency, registerTerms),
      ),
    ),
  ) ?? null;

/**
 * The ONE place every holding type's detail-screen behavior is looked up:
 * its footer add action, its value-breakdown display, and its upcoming
 * loan payments. Mirrors `holdingDescriptors`
 * (`src/holdings/holding-descriptor/`) — the `satisfies Record<HoldingType,
 * HoldingDetailSpec>` gives a compile error the moment a new holding type is
 * added without an entry here. `card`/`cash`/`crypto_asset`/`jar` share one
 * `balanceSpec` rather than four identical copies.
 */
export const holdingDetailSpecs = {
  term_deposit: {
    footerAction: () => 'contribution',
    breakdown: {
      kind: 'interest',
      principalLabelKey: 'holdingDetail.principal',
      expectedProfit: () => null,
      yieldToMaturity: () => null,
    },
    upcomingInstallments: noInstallments,
  },
  bond: {
    footerAction: () => 'none',
    breakdown: {
      kind: 'interest',
      principalLabelKey: 'holdingDetail.cost',
      expectedProfit: bondExpectedProfit,
      yieldToMaturity: (holding, registerTerms) =>
        bondYieldToMaturity(holding.metadata, holding.currency, registerTerms),
    },
    upcomingInstallments: noInstallments,
  },
  // A priced type shows its cost basis, its current (priced) value, and the
  // gain between them — never the deposit/bond interest/tax table, which
  // would only ever read a misleading zero (a priced type accrues no
  // interest and withholds no tax).
  property_item: {
    footerAction: () => 'updateValue',
    breakdown: { kind: 'priced' },
    upcomingInstallments: noInstallments,
  },
  // `metal` opens the dedicated Lot form to record a buy/sell instead of the
  // generic price-point form: `metal` is ALSO a priced type, but its price
  // comes from the SHARED `metal:<XAU|...>` instrument (kiko-pricing), never
  // a per-holding manual price point the way `property_item` uses — so it
  // adds lots rather than updating a value.
  metal: {
    footerAction: () => 'addLot',
    breakdown: { kind: 'priced' },
    upcomingInstallments: noInstallments,
  },
  // A share records its buys and sells through the Lot form, like a metal.
  share: {
    footerAction: (_synced, holding) => shareFooterAction(holding),
    breakdown: { kind: 'priced' },
    upcomingInstallments: noInstallments,
  },
  // A loan is ledgerless but still takes the SAME `'updateValue'`
  // action as a priced holding — it reuses `PricePointForm` to write a
  // correction onto its own `holding:<id>` manual series
  // (`loanAnchorAt` reads a correction there for every schedule, not just
  // `'none'`). The screen swaps the button's own label to "Update
  // outstanding" for this type; the navigation target is identical.
  loan: {
    footerAction: () => 'updateValue',
    breakdown: { kind: 'loan' },
    upcomingInstallments: loanUpcomingInstallments,
  },
  card: balanceSpec,
  cash: balanceSpec,
  crypto_asset: balanceSpec,
  jar: balanceSpec,
} as const satisfies Record<HoldingType, HoldingDetailSpec>;

/**
 * The tolerant lookup the detail screen reads for footer action, breakdown,
 * and upcoming-payments behavior in one place: `Object.hasOwn`-guarded — the
 * schema types `holdings.type` as this exact enum, but SQLite enforces no
 * such constraint, so a corrupted row could hold any string, including an
 * inherited `Object.prototype` key such as `'constructor'`, which a plain
 * index would resolve to a non-`HoldingDetailSpec` value despite never being
 * a real holding type; `Object.hasOwn` checks the object's OWN keys only, so
 * those resolve to the fallback too (mirroring `holdingDescriptorOrUndefined`,
 * `src/holdings/holding-descriptor/`) — and falls back to `balanceSpec` — the
 * plain "add transaction" behavior — for a type it does not recognize, or
 * for `undefined`, so callers never need their own `?? balanceSpec`.
 */
export const holdingDetailSpecFor = (type: string | undefined): HoldingDetailSpec => {
  const specs = holdingDetailSpecs as Record<string, HoldingDetailSpec>;

  return type !== undefined && Object.hasOwn(specs, type) ? specs[type] : balanceSpec;
};
