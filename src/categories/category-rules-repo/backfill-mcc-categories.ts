import {
  IN_CLAUSE_CHUNK_SIZE,
  categories,
  chunkRows,
  database,
  holdings,
  settings,
  transactions,
  write,
} from '@kiko/db';
import { SETTINGS_ID } from '@kiko/settings';
import { and, eq, inArray } from 'drizzle-orm';
import { logOnFailure } from '@kiko/diagnostics';
import { ADDED_MCC_CODES } from '@kiko/monobank/mcc-category';
import { categoryKeyOf, planMccBackfill, prepareRules } from '@kiko/categories/category-rules';

import {
  candidateColumns,
  noRealCategorySql,
  readHoldingLabels,
  withVisibleDescription,
  readAllRulesDatabaseTransaction,
} from './category-rules.repo';

// The added codes bind as one list, far inside the engine's variable limit; a test pins it. SQL
// only narrows: the pure plan decides every row.
export const mccBackfillRowsQuery = (databaseTransaction: typeof database) =>
  databaseTransaction
    .select(candidateColumns)
    .from(transactions)
    .innerJoin(holdings, eq(holdings.id, transactions.holdingId))
    .where(and(inArray(transactions.mcc, [...ADDED_MCC_CODES]), noRealCategorySql));

const isBackfillDone = async (databaseTransaction: typeof database): Promise<boolean> => {
  const rows = await databaseTransaction
    .select({ mccCategoriesBackfilled: settings.mccCategoriesBackfilled })
    .from(settings)
    .where(eq(settings.id, SETTINGS_ID));

  return rows.at(0)?.mccCategoriesBackfilled !== false;
};

// A manual group: Hermes has no `Map.groupBy`.
const idsByCategory = (planned: readonly { id: string; category: string }[]) => {
  const grouped = new Map<string, string[]>();

  for (const { id, category } of planned) {
    const ids = grouped.get(category);

    if (ids === undefined) {
      grouped.set(category, [id]);
    } else {
      ids.push(id);
    }
  }

  return grouped;
};

// One transaction, re-reading the mark and every row inside it: the rows and the mark commit
// together, so a crash or a failed write leaves the mark unset and the next open starts over. A
// row's own flag is never touched.
const backfillIn = async (databaseTransaction: typeof database): Promise<void> => {
  if (await isBackfillDone(databaseTransaction)) {
    return;
  }

  const categoryRows = await databaseTransaction.select({ key: categories.key }).from(categories);
  const prepared = prepareRules(await readAllRulesDatabaseTransaction(databaseTransaction));
  const rows = withVisibleDescription(
    await mccBackfillRowsQuery(databaseTransaction),
    await readHoldingLabels(databaseTransaction),
  );
  const planned = planMccBackfill(
    prepared,
    rows,
    new Set(categoryRows.map((category) => categoryKeyOf(category.key))),
  );

  for (const [category, ids] of idsByCategory(planned)) {
    for (const idChunk of chunkRows(ids, IN_CLAUSE_CHUNK_SIZE)) {
      await databaseTransaction
        .update(transactions)
        .set({ category })
        .where(inArray(transactions.id, idChunk));
    }
  }

  await databaseTransaction
    .update(settings)
    .set({ mccCategoriesBackfilled: true })
    .where(eq(settings.id, SETTINGS_ID));
};

/**
 * Moves every row with a code the MCC map gained and no real category onto the category the map
 * now names, once per data set (`settings.mccCategoriesBackfilled`), and again after a restore of
 * a file made before it. A later run would overwrite a row that became `other` since, through a
 * deleted rule or a deleted category, so after the first run an open reads only the mark. Never
 * rejects: a failure is logged as fixed text, with no name or IBAN, and the next open tries again.
 */
export const backfillMccCategories = async (): Promise<void> => {
  await logOnFailure('[mcc-backfill] back-fill failed', async () => {
    if (!(await isBackfillDone(database))) {
      await write(backfillIn);
    }
  });
};
