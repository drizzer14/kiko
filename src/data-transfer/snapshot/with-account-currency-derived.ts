import type { AccountRow, HoldingRow } from '@kiko/db';
import type { Currency } from '@kiko/currency/currency';
import { accountCurrencyOf } from '@kiko/holdings/account-currency';

/**
 * Migration 0062's backfill (`drizzle/migrations/0062_add_account_currency.sql`, its doc comment
 * states the rule), applied to a `.kiko` restore: a file written before the column carries no
 * `currency` on any account, so every account to insert gets the currency its open holdings
 * share, or the base currency.
 *
 * The presence check is per FILE, over the file's own accounts, because the crypto cash move adds
 * accounts that carry a `currency` key with no value: a per-row check would skip them. A file
 * that carries the key on any account keeps every value as exported, the user's own pick
 * included, and the same array comes back. Fed the rows the implicit-account merge produced, as
 * a live device runs 0050 before 0062.
 */
export const withAccountCurrencyDerived = ({
  fileAccounts,
  accounts,
  holdings,
  baseCurrency,
}: {
  fileAccounts: readonly AccountRow[];
  accounts: AccountRow[];
  holdings: readonly Pick<HoldingRow, 'accountId' | 'currency' | 'closedAt'>[];
  baseCurrency: Currency;
}): AccountRow[] => {
  if (accounts.length === 0 || fileAccounts.some((account) => Object.hasOwn(account, 'currency'))) {
    return accounts;
  }

  // A manual group: Hermes has no `Map.groupBy`.
  const holdingsByAccount = new Map<string, Pick<HoldingRow, 'currency' | 'closedAt'>[]>();

  for (const holding of holdings) {
    const accountHoldings = holdingsByAccount.get(holding.accountId) ?? [];

    accountHoldings.push(holding);
    holdingsByAccount.set(holding.accountId, accountHoldings);
  }

  return accounts.map((account) => ({
    ...account,
    currency: accountCurrencyOf(holdingsByAccount.get(account.id) ?? [], baseCurrency),
  }));
};
