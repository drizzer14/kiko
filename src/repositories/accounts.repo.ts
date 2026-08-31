import { eq } from 'drizzle-orm';
import type { Currency } from '../currency/currency';
import { database, write } from '../db/client';
import { id } from '../db/id';
import { type AccountRow, accounts, holdings } from '../db/schema';
import type { Repository } from './repository';

type NewAccount = Pick<AccountRow, 'name' | 'kind'> &
  Partial<Pick<AccountRow, 'institution' | 'sortOrder'>>;

type NewCashAccount = {
  name: string;
  currency: Currency;
  initialBalanceMinorUnits: number;
};

export const accountsRepo = {
  listQuery: () => database.select().from(accounts),
  create: (input: NewAccount) => write(tx => tx.insert(accounts).values({ id: id(), ...input })),
  /**
   * Create a cash account and its initial cash holding in ONE op-sqlite
   * transaction, so the account can never persist without its holding on a
   * partial failure (mirrors `transactionsRepo.recordManual`'s ledger +
   * balance atomicity).
   */
  createCashAccount: ({ name, currency, initialBalanceMinorUnits }: NewCashAccount) =>
    write(async tx => {
      const accountId = id();
      await tx.insert(accounts).values({ id: accountId, name, kind: 'cash' });
      await tx.insert(holdings).values({
        id: id(),
        accountId,
        name,
        type: 'cash',
        currency,
        balanceMinorUnits: initialBalanceMinorUnits,
      });
    }),
  update: (accountId: string, patch: Partial<AccountRow>) =>
    write(tx => tx.update(accounts).set(patch).where(eq(accounts.id, accountId))),
  archive: (accountId: string) =>
    write(tx =>
      tx.update(accounts).set({ archivedAt: Date.now() }).where(eq(accounts.id, accountId)),
    ),
} satisfies Repository;
