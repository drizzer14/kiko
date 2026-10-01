import type { TransactionRow } from '@kiko/db';

export type BalanceSetShape = Pick<
  TransactionRow,
  'source' | 'description' | 'category' | 'exchangeCounterpartHoldingId' | 'changeGroupId'
>;

/** True for a manual row shaped like the one an opening balance, a cash
 * opening, or a hand balance edit writes: no description, no category, and
 * neither the exchange-leg nor the change-return marker. Nothing stores which
 * row set a balance, so this shape is the signal migration 0036
 * (`drizzle/migrations/0036_add_balance_set_at.sql`) backfills
 * `holdings.balanceSetAt` from, and the one `transactionsRepo.update` uses to
 * tell the balance-set row from an ordinary row at the same instant. A
 * manual row the transaction form writes always carries a category. */
export const isBalanceSetShapedRow = (row: BalanceSetShape): boolean =>
  row.source === 'manual' &&
  row.description === '' &&
  row.category === null &&
  row.exchangeCounterpartHoldingId === null &&
  row.changeGroupId === null;
