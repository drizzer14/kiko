import { eq } from 'drizzle-orm';

import { DEFAULT_CATEGORY_KEY } from '../categories/category-display';
import { database, write } from '../db/client';
import { id } from '../db/id';
import { categories, categoryOverrides, settings, transactions } from '../db/schema';

import type { Repository } from './repository';

/**
 * Categories are keyed by a stable slug (`key`). `title` and `icon` are the
 * user-editable display fields; editing either leaves the key — and therefore
 * every transaction's stored `category` value — untouched.
 */
export const categoriesRepo = {
  allQuery: () => database.select().from(categories),
  // A user-added category gets a generated key, distinct from the seeded MCC
  // slugs, so it never collides with the canonical categories.
  create: (category: { title: string; icon: string; color?: string | null }) =>
    write((tx) =>
      tx.insert(categories).values({
        key: id(),
        title: category.title,
        icon: category.icon,
        color: category.color ?? null,
      }),
    ),
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

      await tx
        .update(transactions)
        .set({ category: defaultKey })
        .where(eq(transactions.category, key));
      await tx
        .update(categoryOverrides)
        .set({ category: defaultKey })
        .where(eq(categoryOverrides.category, key));
      await tx.delete(categories).where(eq(categories.key, key));
    }),
} satisfies Repository;
