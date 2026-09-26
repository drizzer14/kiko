import type { AccountRow, HoldingRow } from '@kiko/db';

import { Money } from '../../currency/money';
import { canConvert } from '../../rates/net-worth-view';
import type { Currency } from '../../currency/currency';
import { holdingValue } from '../../holdings/holding-value';
import { convert, type RateTable } from '../../rates/conversion';
import { defaultAccountColor } from '../../holdings/entity-colors';
import { resolveEntityColor } from '../../design-system/entity-tint';
import { EMPTY_PRICE_BOOK, type PriceBook } from '../../prices/price-book';

/**
 * An account as the pie chart needs it: identity, display name, and the two
 * fields that resolve its slice color — its own optional `color` override and
 * its `kind` (which selects the default swatch when there is no override).
 */
export type ContributionAccount = Pick<AccountRow, 'id' | 'name' | 'kind' | 'color'>;

/** A holding as the pie chart needs it: its account plus its convertible value. */
export type ContributionHolding = Pick<
  HoldingRow,
  'accountId' | 'currency' | 'balanceMinorUnits' | 'type' | 'metadata' | 'id'
>;

/**
 * One pie slice. `amount` is the account's net worth in the BASE currency's
 * minor units (so the legend can rebuild a `Money`); `share` is that amount over
 * the total of all returned slices, in `[0, 1]`.
 */
export type AccountSlice = {
  accountId: string;
  name: string;
  amount: number;
  share: number;
  // The effective slice color: the account's own override when set, else the
  // per-kind default. The same color the account card renders, so the pie reads
  // in the app's color language.
  color: string;
};

// Every holding's own value, converted to the base currency — dropping any
// holding whose currency cannot convert (no rate), the same guard
// `guardedNetWorth`/`buildTypeBreakdown` use. Shared by the pie (positive
// values only) and `buildDebtTotal` (negative values only) below, so the
// convert/guard logic lives in exactly one place.
const convertibleValues = (
  holdings: ContributionHolding[],
  baseCurrency: Currency,
  rateTable: RateTable,
  now: number,
  book: PriceBook,
): Money[] =>
  holdings
    .filter((holding) => canConvert(holding.currency, baseCurrency, rateTable))
    .map((holding) => convert(holdingValue(holding, now, book), baseCurrency, rateTable));

/**
 * Build one pie slice per account for the "Account contribution" chart. The
 * pie is ASSETS ONLY: an account's `amount` sums only its POSITIVE holding
 * values — a negative holding (a `loan`'s own value, or a non-loan holding
 * in debit, e.g. a credit card) never reduces it, so an account can never
 * get a negative slice, and a debt-heavy account
 * with no positive holding at all contributes no slice rather than a
 * negative one. See `buildDebtTotal` below for where that debt goes instead.
 * Accounts that end up at zero — including those whose only holdings are
 * unconvertible or negative — are filtered out, so shares are computed over
 * the visible slices alone and sum to ~1.
 */
export const buildAccountContribution = (input: {
  accounts: ContributionAccount[];
  holdings: ContributionHolding[];
  rateTable: RateTable;
  baseCurrency: Currency;
  now: number;
  book?: PriceBook;
}): AccountSlice[] => {
  const { accounts, holdings, rateTable, baseCurrency, now, book = EMPTY_PRICE_BOOK } = input;
  const accountDefaults = defaultAccountColor;

  const valued = accounts
    .map((account) => {
      const accountHoldings = holdings.filter((holding) => holding.accountId === account.id);
      const amount = convertibleValues(accountHoldings, baseCurrency, rateTable, now, book)
        .filter((money) => money.minorUnits > 0)
        .reduce((sum, money) => sum.add(money), Money.of(baseCurrency, 0)).minorUnits;
      // `resolveEntityColor` (design-system/entity-tint.ts) is the ONE function
      // that picks an entity's effective color: a valid stored hex, else the
      // kind default, else a safe gray. A bare `stored ?? default` let an
      // empty-string color and an unmapped kind (a row written under a
      // since-removed enum member — the schema enum is TS-only, no CHECK
      // constraint) reach the chart as `''`/`undefined`, so `<Path fill>` drew
      // black on the black card and the legend swatch was transparent while
      // the slice still consumed ring share. Every other call site in the app
      // already uses this; this was the last hold-out.
      const color = resolveEntityColor(account.color, accountDefaults[account.kind]);

      return { accountId: account.id, name: account.name, amount, color };
    })
    .filter((slice) => slice.amount > 0)
    // Largest contributor first, so the biggest slice leads the ring and the
    // legend column reads top-down by size.
    .sort((a, b) => b.amount - a.amount);

  const total = valued.reduce((sum, slice) => sum + slice.amount, 0);

  return valued.map((slice) => ({ ...slice, share: slice.amount / total }));
};

/**
 * The "Debts" total (Statistics screen; "Credit-card negative balances count
 * as debt too"): the sum of every holding whose own held value is NEGATIVE,
 * converted to the base currency — a NEGATIVE
 * `Money`, read verbatim by `MoneyText` to render the minus sign. A `loan`
 * holding's own value is already minus its outstanding balance
 * (`holding-value.ts`), and a non-loan holding in debit (a credit card) is
 * already a negative `balanceMinorUnits` — NEITHER needs a type check here,
 * only the sign of the already-computed value. A holding whose value is
 * zero or positive contributes nothing (it belongs to the ASSETS-only pie
 * above instead). An unconvertible holding (no rate for its currency) is
 * silently dropped, same guard as `guardedNetWorth`/`buildTypeBreakdown`.
 */
export const buildDebtTotal = (input: {
  holdings: ContributionHolding[];
  rateTable: RateTable;
  baseCurrency: Currency;
  now: number;
  book?: PriceBook;
}): Money => {
  const { holdings, rateTable, baseCurrency, now, book = EMPTY_PRICE_BOOK } = input;

  return convertibleValues(holdings, baseCurrency, rateTable, now, book)
    .filter((money) => money.minorUnits < 0)
    .reduce((sum, money) => sum.add(money), Money.of(baseCurrency, 0));
};
