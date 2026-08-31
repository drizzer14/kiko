import { eq } from 'drizzle-orm';
import { database, write } from '../db/client';
import { id } from '../db/id';
import { type AccountRow, accounts } from '../db/schema';
import type { Repository } from './repository';

type NewAccount = Pick<AccountRow, 'name' | 'kind'> &
  Partial<Pick<AccountRow, 'institution' | 'sortOrder'>>;

export const accountsRepo = {
  listQuery: () => database.select().from(accounts),
  create: (input: NewAccount) => write(tx => tx.insert(accounts).values({ id: id(), ...input })),
  // Generates the id up front (rather than reading it back with a SQL
  // RETURNING clause, which op-sqlite/Drizzle does not surface here) so the
  // caller can chain a dependent write — e.g. attaching a cash holding to
  // the account this creates — inside the same logical action.
  createAndReturn: async (input: NewAccount): Promise<string> => {
    const newId = id();
    await write(tx => tx.insert(accounts).values({ id: newId, ...input }));
    return newId;
  },
  update: (accountId: string, patch: Partial<AccountRow>) =>
    write(tx => tx.update(accounts).set(patch).where(eq(accounts.id, accountId))),
  archive: (accountId: string) =>
    write(tx =>
      tx.update(accounts).set({ archivedAt: Date.now() }).where(eq(accounts.id, accountId)),
    ),
} satisfies Repository;
