import { eq } from 'drizzle-orm';
import { SETTINGS_ID } from '@kiko/settings';
import { write, chunkRows, settings, transactions } from '@kiko/db';

import { upgradeLegacyDedupKey } from '../mapping';

// Bounds how many rewrites this loop groups together before moving on to the
// next slice of the (already fully loaded) `importRows` array — the row
// count itself is unbounded (a heavy statement-import user). Each rewrite
// inside a chunk is still awaited ONE AT A TIME below (never `Promise.all`,
// which would issue every rewrite in the chunk concurrently before any of
// them resolves, the same enormous-pending-batch shape this chunking
// exists to avoid), so at most one write is ever outstanding against the
// DB's single worker queue — the sequential-await precedent
// restore-snapshot.ts's own chunked insert loops already follow.
const UPGRADE_CHUNK_SIZE = 500;

/**
 * Runs once, from `MigrationsGate` (after migration 0041 adds the flag this
 * reads/writes), rewriting every stored statement-import transaction whose
 * `externalId` still carries the pre-`␟` legacy occurrence suffix
 * (`upgradeLegacyDedupKey`, `../mapping/upgrade-dedup-key.ts`), then marking
 * `settings.dedupKeysUpgraded` so every later launch is a no-op.
 *
 * The candidate SET is every `source = 'import'` row: `upgradeLegacyDedupKey`
 * is pure JS (the collision it fixes can't be told apart in SQL — see its own
 * doc comment), so filtering further has to happen row-by-row, in JS, after
 * the read. Read-then-write inside ONE `write()` transaction: a failure
 * partway leaves the flag at `false`, so the NEXT launch retries the whole
 * upgrade rather than silently leaving some rows unrewritten.
 */
export const upgradeStoredDedupKeys = (): Promise<void> =>
  write(async (databaseTransaction) => {
    const settingsRows = await databaseTransaction
      .select({ dedupKeysUpgraded: settings.dedupKeysUpgraded })
      .from(settings)
      .where(eq(settings.id, SETTINGS_ID));

    // Anything other than an explicit `false` (already upgraded, or — should
    // the row somehow be missing — nothing safe to key the write off) skips
    // the rest of this run.
    if (settingsRows[0]?.dedupKeysUpgraded !== false) {
      return;
    }

    const importRows = await databaseTransaction
      .select({
        id: transactions.id,
        holdingId: transactions.holdingId,
        time: transactions.time,
        amountMinorUnits: transactions.amountMinorUnits,
        description: transactions.description,
        source: transactions.source,
        externalId: transactions.externalId,
      })
      .from(transactions)
      .where(eq(transactions.source, 'import'));

    for (const chunk of chunkRows(importRows, UPGRADE_CHUNK_SIZE)) {
      const rewrites = chunk
        .map((row) => ({ id: row.id, externalId: upgradeLegacyDedupKey(row) }))
        .filter(
          (rewrite): rewrite is { id: string; externalId: string } => rewrite.externalId !== null,
        );

      for (const rewrite of rewrites) {
        await databaseTransaction
          .update(transactions)
          .set({ externalId: rewrite.externalId })
          .where(eq(transactions.id, rewrite.id));
      }
    }

    await databaseTransaction
      .update(settings)
      .set({ dedupKeysUpgraded: true })
      .where(eq(settings.id, SETTINGS_ID));
  });
