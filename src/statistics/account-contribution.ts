import type { Currency } from '../currency/currency';
import type { AccountRow, HoldingRow } from '../db/schema';
import { defaultAccountColor } from '../holdings/entity-colors';
import type { RateTable } from '../rates/conversion';
import { guardedNetWorth } from '../rates/net-worth-view';

/**
 * An account as the pie chart needs it: identity, display name, and the two
 * fields that resolve its slice color — its own optional `color` override and
 * its `kind` (which selects the default swatch when there is no override).
 */
export type ContributionAccount = Pick<AccountRow, 'id' | 'name' | 'kind' | 'color'>;

/** A holding as the pie chart needs it: its account plus its convertible value. */
export type ContributionHolding = Pick<
  HoldingRow,
  'accountId' | 'currency' | 'balanceMinorUnits' | 'type' | 'metadata'
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

/**
 * Build one pie slice per account for the "Account contribution" chart. Each
 * account's value is `guardedNetWorth` of its holdings converted to the base
 * currency at current rates; the guard silently drops any holding with no rate.
 * Accounts that end up at zero or negative — including those whose only holdings
 * are unconvertible — are filtered out, so shares are computed over the visible
 * slices alone and sum to ~1.
 */
export const buildAccountContribution = (input: {
  accounts: ContributionAccount[];
  holdings: ContributionHolding[];
  rateTable: RateTable;
  baseCurrency: Currency;
  now: number;
}): AccountSlice[] => {
  const { accounts, holdings, rateTable, baseCurrency, now } = input;

  const valued = accounts
    .map((account) => {
      const accountHoldings = holdings.filter((holding) => holding.accountId === account.id);
      const amount = guardedNetWorth(accountHoldings, baseCurrency, rateTable, now).minorUnits;
      const color = account.color ?? defaultAccountColor[account.kind];

      return { accountId: account.id, name: account.name, amount, color };
    })
    .filter((slice) => slice.amount > 0);

  const total = valued.reduce((sum, slice) => sum + slice.amount, 0);

  return valued.map((slice) => ({ ...slice, share: slice.amount / total }));
};
