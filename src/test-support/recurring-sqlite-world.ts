import { settingsRepo } from '@kiko/settings';
import { accounts, database, holdings, transactions } from '@kiko/db';

import type { Ledger } from './recurring-ledger';

/**
 * Puts a recurring-detection ledger (`ledgerOf`) into the database `openSqliteWorld` opened, one
 * real row per charge, holding and account, and the one settings row the mark writes update.
 * The marks of a world are written by the real repository, not seeded here.
 */
export const seedRecurringWorld = async (ledger: Ledger): Promise<void> => {
  await settingsRepo.ensure();
  await database
    .insert(accounts)
    .values(
      ledger.accounts.map(({ id, kind, archivedAt }) => ({ id, name: id, kind, archivedAt })),
    );
  await database.insert(holdings).values(
    ledger.holdings.map(({ id, accountId, name, currency, metadata }) => ({
      id,
      accountId,
      name,
      currency,
      metadata,
      type: 'card' as const,
    })),
  );
  await database.insert(transactions).values(ledger.rows);
};
