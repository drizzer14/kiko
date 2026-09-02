import { eq } from 'drizzle-orm';
import { database, write } from '../db/client';
import { categories } from '../db/schema';
import type { Repository } from './repository';

/**
 * Categories are keyed by a stable slug (`key`). `title` and `icon` are the
 * user-editable display fields; editing either leaves the key — and therefore
 * every transaction's stored `category` value — untouched.
 */
export const categoriesRepo = {
  allQuery: () => database.select().from(categories),
  updateTitle: (key: string, title: string) =>
    write((tx) => tx.update(categories).set({ title }).where(eq(categories.key, key))),
  updateIcon: (key: string, icon: string) =>
    write((tx) => tx.update(categories).set({ icon }).where(eq(categories.key, key))),
} satisfies Repository;
