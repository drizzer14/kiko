/*
 Add `accounts.currency`: the currency the account card totals in, and give every existing account
 its value ONCE.

 The rule: an account whose OPEN holdings (`closed_at IS NULL`) all share one currency gets that
 currency. An account with several currencies among its open holdings, or with no open holding,
 gets `settings.base_currency`, or 'UAH' when there is no settings row. It applies to every
 account: archived, implicit (property, debt), synced, and the accounts the 0044 crypto cash move
 created. Open only, because the card sums only open holdings. After this migration the value is
 fixed: no code recomputes it, and a base-currency change never moves it.

 Two statements, in order. The first sets every account to the base; the second overwrites the
 accounts whose open holdings share one currency. `holdings` is read in ONE grouped scan, never
 by a lookup per account.

 Nothing but `accounts.currency` is written: no holding, transaction or amount changes.

 Crash-safe and additive: no delete, no temporary table. The runner applies all three statements
 and their bookkeeping row in ONE transaction, so a crash leaves the database at 0061 to retry
 whole.

 RESTORE MIRROR: a `.kiko` file written before this column carries no `currency` on its accounts.
 `restore-snapshot.ts` calls `withAccountCurrencyDerived`, which applies the same rule through the
 pure `accountCurrencyOf` (`src/holdings/account-currency/`), after the implicit-account merge, as
 a live device runs 0050 before this migration.
*/
ALTER TABLE `accounts` ADD `currency` text DEFAULT 'UAH' NOT NULL;
--> statement-breakpoint
UPDATE accounts SET currency = COALESCE((SELECT base_currency FROM settings WHERE id = 1), 'UAH');
--> statement-breakpoint
UPDATE accounts SET currency = single.currency
FROM (
  SELECT account_id, MIN(currency) AS currency
  FROM holdings
  WHERE closed_at IS NULL
  GROUP BY account_id
  HAVING COUNT(DISTINCT currency) = 1
) AS single
WHERE single.account_id = accounts.id;
