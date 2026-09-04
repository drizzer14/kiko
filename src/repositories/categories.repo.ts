import { eq } from 'drizzle-orm';
import { database, write } from '../db/client';
import { id } from '../db/id';
import { categories } from '../db/schema';
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
} satisfies Repository;
