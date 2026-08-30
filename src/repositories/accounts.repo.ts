import { eq } from 'drizzle-orm';
import { database, write } from '../db/client';
import { id } from '../db/id';
import { type AccountRow, accounts } from '../db/schema';

type NewAccount = Pick<AccountRow, 'name' | 'kind'> &
  Partial<Pick<AccountRow, 'institution' | 'sortOrder'>>;

export const accountsRepo = {
  listQuery: () => database.select().from(accounts),
  create: (input: NewAccount) => write(tx => tx.insert(accounts).values({ id: id(), ...input })),
  update: (accountId: string, patch: Partial<AccountRow>) =>
    write(tx => tx.update(accounts).set(patch).where(eq(accounts.id, accountId))),
  archive: (accountId: string) =>
    write(tx =>
      tx.update(accounts).set({ archivedAt: Date.now() }).where(eq(accounts.id, accountId)),
    ),
};
