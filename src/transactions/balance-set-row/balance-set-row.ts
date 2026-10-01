import type { TransactionRow } from '@kiko/db';

type BalanceSetShape = Pick<
  TransactionRow,
  'source' | 'description' | 'category' | 'exchangeCounterpartHoldingId' | 'changeGroupId'
>;

/** True for a manual row shaped like the one an opening balance, a cash
 * opening, or a hand balance edit writes: no description, no category, and
 * neither the exchange-leg nor the change-return marker. Data written before
 * `transactions.setsBalance` carries no other signal, so this shape is what
 * migration 0036 (`drizzle/migrations/0036_add_balance_set_at.sql`) backfills
 * `holdings.balanceSetAt` from, and, at that instant, what migration 0047
 * (`drizzle/migrations/0047_add_sets_balance.sql`) and a legacy `.kiko`
 * restore mark. A manual row the transaction form writes always carries a
 * category. */
export const isBalanceSetShapedRow = (row: BalanceSetShape): boolean =>
  row.source === 'manual' &&
  row.description === '' &&
  row.category === null &&
  row.exchangeCounterpartHoldingId === null &&
  row.changeGroupId === null;
