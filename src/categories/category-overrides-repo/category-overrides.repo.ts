import { inArray, sql } from 'drizzle-orm';
import type { Repository } from '@kiko/db/repository';

import { database, write } from '../../db/client';
import { categoryOverrides, transactions } from '../../db/schema';
import { normalizeTransactionName } from '../../transactions/normalize-name';

export const categoryOverridesRepo = {
  /**
   * Every name→category rule as a reactive Drizzle builder (never executed
   * data), handed to useLiveQuery so a caller can build an in-JS lookup map and
   * pre-select a transaction's category from the typed description. Matching is
   * done in JS through `normalizeTransactionName` (never SQL — Cyrillic/
   * whitespace variants must match), so the query itself is a plain full select.
   */
  allQuery: () => database.select().from(categoryOverrides),
  /**
   * Upsert a name→category rule AND rewrite every existing same-name transaction
   * to the new category, all in ONE op-sqlite transaction so a partial failure
   * can never leave the rule and the ledger disagreeing. Matching is done in JS
   * (never SQL) so Cyrillic/whitespace variants match — see normalizeTransactionName.
   * A whitespace-only name is a no-op: it must not create a catch-all rule.
   *
   * Categories are keyed by a stable slug, so a later category rename only
   * changes its title — the rule and the rewritten rows keep resolving through
   * the display map with zero further writes.
   */
  upsertCategoryOverride: (name: string, category: string) =>
    write(async (tx) => {
      const key = normalizeTransactionName(name);

      if (key === '') {
        return;
      }

      const displayName = name.trim();
      await tx
        .insert(categoryOverrides)
        .values({ normalizedName: key, category, displayName })
        .onConflictDoUpdate({
          target: categoryOverrides.normalizedName,
          set: { category, displayName, updatedAt: sql`(unixepoch() * 1000)` },
        });

      const rows = await tx
        .select({ id: transactions.id, description: transactions.description })
        .from(transactions);
      const matchingIds = rows
        .filter((row) => normalizeTransactionName(row.description) === key)
        .map((row) => row.id);

      if (matchingIds.length === 0) {
        return;
      }

      await tx.update(transactions).set({ category }).where(inArray(transactions.id, matchingIds));
    }),
} satisfies Repository;
