import { SETTINGS_ID } from '@kiko/settings';
import { eq, isNotNull, sql } from 'drizzle-orm';
import { write, chunkRows, type database, settings, holdings, transactions } from '@kiko/db';

import { planImportTimeRezone } from './plan-import-time-rezone';

// Bounds how many rows this loop loads into ONE `INSERT` statement — the row
// count itself is unbounded (a heavy statement-import user's whole history),
// same reasoning as `upgradeStoredDedupKeys`'s own `UPGRADE_CHUNK_SIZE`.
const REZONE_CHUNK_SIZE = 500;

/**
 * Runs once, from `MigrationsGate` (after migration 0043 adds the flag this
 * reads/writes) and from `importParsedStatement` (before any import),
 * rewriting every stored statement-import row's `time` (and its dedup key's
 * time token) from the legacy "wall clock written as UTC" convention to a
 * real instant (`planImportTimeRezone`), then marking
 * `settings.importTimesRezoned` so every later launch is a no-op.
 *
 * Crash-safe ordering, everything inside this ONE `write()` transaction:
 * 1. Read the flag; anything other than an explicit `false` is a no-op.
 * 2. Read every `source = 'import'` row and every holding with a non-null
 *    `balanceSetAt` (the candidate set `planImportTimeRezone` needs).
 * 3. Compute the plan (pure).
 * 4. Load the plan into a TEMP table (reversible: dropped inside the same
 *    transaction, or rolled back entirely with it on a crash).
 * 5. Phase A: move every affected row's key to a temporary,
 *    unique-by-construction key — SQLite checks UNIQUE per row, even inside
 *    one UPDATE, so writing final keys directly could transiently collide
 *    with a row not yet rewritten.
 * 6. Phase B: write the final `time` + key.
 * 7. Write each changed holding's `balanceSetAt` (never `balanceMinorUnits` —
 *    this step has no such write at all).
 * 8. Drop the temp table.
 * 9. Set the flag — the commitment, done LAST. A crash at any point rolls
 *    the WHOLE transaction back, so the flag stays `false` and the next
 *    launch retries everything from scratch; no step here deletes source
 *    data.
 */
export const rezoneImportTimesIn = async (databaseTransaction: typeof database): Promise<void> => {
  const settingsRows = await databaseTransaction
    .select({ importTimesRezoned: settings.importTimesRezoned })
    .from(settings)
    .where(eq(settings.id, SETTINGS_ID));

  if (settingsRows[0]?.importTimesRezoned !== false) {
    return;
  }

  const importRows = await databaseTransaction
    .select({
      id: transactions.id,
      holdingId: transactions.holdingId,
      time: transactions.time,
      externalId: transactions.externalId,
    })
    .from(transactions)
    .where(eq(transactions.source, 'import'));

  const stampedHoldings = await databaseTransaction
    .select({ id: holdings.id, balanceSetAt: holdings.balanceSetAt })
    .from(holdings)
    .where(isNotNull(holdings.balanceSetAt));

  const plan = planImportTimeRezone(importRows, stampedHoldings);

  if (plan.transactions.length > 0) {
    await databaseTransaction.run(
      sql`CREATE TEMP TABLE import_time_rezone (id TEXT PRIMARY KEY, time INTEGER NOT NULL, external_id TEXT)`,
    );

    for (const chunk of chunkRows(plan.transactions, REZONE_CHUNK_SIZE)) {
      const values = chunk.map((row) => sql`(${row.id}, ${row.time}, ${row.externalId})`);

      await databaseTransaction.run(
        sql`INSERT INTO temp.import_time_rezone (id, time, external_id) VALUES ${sql.join(values, sql`, `)}`,
      );
    }

    await databaseTransaction.run(sql`
      UPDATE transactions
      SET external_id = '␟rezone␟' || id
      WHERE id IN (SELECT id FROM temp.import_time_rezone) AND external_id IS NOT NULL
    `);

    await databaseTransaction.run(sql`
      UPDATE transactions
      SET
        time = (SELECT r.time FROM temp.import_time_rezone r WHERE r.id = transactions.id),
        external_id = (SELECT r.external_id FROM temp.import_time_rezone r WHERE r.id = transactions.id)
      WHERE id IN (SELECT id FROM temp.import_time_rezone)
    `);

    await databaseTransaction.run(sql`DROP TABLE temp.import_time_rezone`);
  }

  for (const holding of plan.holdings) {
    await databaseTransaction
      .update(holdings)
      .set({ balanceSetAt: holding.balanceSetAt })
      .where(eq(holdings.id, holding.id));
  }

  await databaseTransaction
    .update(settings)
    .set({ importTimesRezoned: true })
    .where(eq(settings.id, SETTINGS_ID));
};

export const rezoneImportTimes = (): Promise<void> => write(rezoneImportTimesIn);
