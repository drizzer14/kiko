import type { Repository } from '@kiko/db/repository';
import { asc, eq, sql } from 'drizzle-orm';

import { database, write } from '../db/client';
import { id } from '../db/id';
import { categories, categoryOverrides, settings, transactions } from '../db/schema';

import { DEFAULT_CATEGORY_KEY } from './category-display';

// The next free slot for a new category: one past the current highest
// `sortOrder` (or 0 when there are no categories yet), so a freshly created
// category appends to the end of the list. Unlike holdings, categories are NOT
// account-scoped — the list is global, so there is no `accountId` filter. Read
// inside the write transaction so a concurrent create cannot observe a stale
// maximum.
const nextSortOrder = async (tx: typeof database): Promise<number> => {
  const rows = await tx
    .select({ value: sql<number>`coalesce(max(${categories.sortOrder}), -1)` })
    .from(categories);

  return (rows.at(0)?.value ?? -1) + 1;
};

/**
 * Categories are keyed by a stable slug (`key`). `title` and `icon` are the
 * user-editable display fields; editing either leaves the key — and therefore
 * every transaction's stored `category` value — untouched.
 */
export const categoriesRepo = {
  // Ordered by the user-controlled `sortOrder` (the reorderable list order),
  // with the stable `key` slug as a tiebreak so rows sharing a rank keep a
  // deterministic order rather than flickering between renders. Categories have
  // no `createdAt`, so the primary-key slug is the natural stable tiebreaker.
  allQuery: () =>
    database.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.key)),
  // A user-added category gets a generated key, distinct from the seeded MCC
  // slugs, so it never collides with the canonical categories. It appends to the
  // end of the list via `sortOrder = max + 1`.
  create: (category: { title: string; icon: string; color?: string | null }) =>
    write(async (tx) => {
      const sortOrder = await nextSortOrder(tx);
      await tx.insert(categories).values({
        key: id(),
        title: category.title,
        icon: category.icon,
        color: category.color ?? null,
        sortOrder,
      });
    }),
  updateTitle: (key: string, title: string) =>
    write((tx) => tx.update(categories).set({ title }).where(eq(categories.key, key))),
  updateIcon: (key: string, icon: string) =>
    write((tx) => tx.update(categories).set({ icon }).where(eq(categories.key, key))),
  // Sets the category's color (an entity-color hex) or, with `null`, clears it
  // back to no picked color. The display/chart layer falls back to the stable
  // per-key palette hash when the stored color is null (see resolveCategoryColor
  // in statistics/category-breakdown.ts), mirroring accounts'/holdings' color.
  updateColor: (key: string, color: string | null) =>
    write((tx) => tx.update(categories).set({ color }).where(eq(categories.key, key))),
  /**
   * Delete a category, folding its data into the CURRENT default category. In
   * ONE op-sqlite transaction: read the configured default key from settings,
   * refuse if the target IS the default (it is the catch-all — it can never be
   * deleted), then reassign every transaction and every name→category override
   * pointing at this key to the default key, and finally remove the category
   * row. The reassignment (not a delete of the rows) is why this is one
   * transaction — a partial failure must never orphan a transaction on a
   * now-missing category slug.
   */
  delete: (key: string) =>
    write(async (tx) => {
      const settingsRows = await tx.select().from(settings);
      const defaultKey = settingsRows.at(0)?.defaultCategoryKey ?? DEFAULT_CATEGORY_KEY;
      if (key === defaultKey) {
        throw new Error('categoriesRepo.delete: cannot delete the default category');
      }

      // Match case-insensitively: rows synced before `categoryForMcc` returned
      // slugs carry a capitalized value ('Groceries'), and neither
      // `transactions.category` nor `category_overrides.category` is COLLATE
      // NOCASE — a plain `eq(category, 'groceries')` reassigned zero of them
      // and left them orphaned on a category row that no longer exists,
      // breaking this function's own never-orphan contract. Migration 0014
      // lowercases every existing value, so this predicate is belt-and-braces
      // for any row written by an older build that has not re-synced yet.
      const lowercaseKey = key.toLowerCase();

      await tx
        .update(transactions)
        .set({ category: defaultKey })
        .where(sql`lower(${transactions.category}) = ${lowercaseKey}`);
      await tx
        .update(categoryOverrides)
        .set({ category: defaultKey })
        .where(sql`lower(${categoryOverrides.category}) = ${lowercaseKey}`);
      await tx.delete(categories).where(eq(categories.key, key));
    }),
  /**
   * Persist a reorder of the categories list. `orderedKeys` is the full new
   * top-to-bottom order of every category; each row's `sortOrder` is rewritten
   * to its 0-based index in ONE transaction so the `allQuery` ordering matches
   * the list the user just arranged (via drag or the move-to-top/bottom
   * buttons). Mirrors `holdingsRepo.reorder`, but keyed by the category slug
   * (`key`) and global (categories are not account-scoped).
   */
  reorder: (orderedKeys: string[]) =>
    write(async (tx) => {
      for (let index = 0; index < orderedKeys.length; index += 1) {
        await tx
          .update(categories)
          .set({ sortOrder: index })
          .where(eq(categories.key, orderedKeys[index]));
      }
    }),
} satisfies Repository;
