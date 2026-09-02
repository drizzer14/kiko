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
  create: (category: { title: string; icon: string }) =>
    write((tx) =>
      tx.insert(categories).values({ key: id(), title: category.title, icon: category.icon }),
    ),
  updateTitle: (key: string, title: string) =>
    write((tx) => tx.update(categories).set({ title }).where(eq(categories.key, key))),
  updateIcon: (key: string, icon: string) =>
    write((tx) => tx.update(categories).set({ icon }).where(eq(categories.key, key))),
} satisfies Repository;
