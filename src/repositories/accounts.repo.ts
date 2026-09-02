import { eq } from 'drizzle-orm';
import type { Currency } from '../currency/currency';
import { database, write } from '../db/client';
import { id } from '../db/id';
import { type AccountRow, accounts, holdings, transactions } from '../db/schema';
import { isSyncedAccount } from '../holdings/deletable';
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
  byIdQuery: (accountId: string) =>
    database.select().from(accounts).where(eq(accounts.id, accountId)),
  /**
   * The account(s) currently connected to the personal Monobank API. The
   * single-connection invariant means this yields at most one row; the UI uses
   * it to hide "Connect" on every other account while one is connected.
   */
  connectedQuery: () =>
    database.select().from(accounts).where(eq(accounts.institution, 'monobank')),
  create: (input: NewAccount) => write((tx) => tx.insert(accounts).values({ id: id(), ...input })),
  /**
   * Create a cash account and its initial cash holding in ONE op-sqlite
   * transaction, so the account can never persist without its holding on a
   * partial failure (mirrors `transactionsRepo.recordManual`'s ledger +
   * balance atomicity).
   */
  createCashAccount: ({ name, currency, initialBalanceMinorUnits }: NewCashAccount) =>
    write(async (tx) => {
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
  /**
   * Disconnect a Monobank-connected account, turning it into a plain manual
   * account whose data is kept as a historical snapshot. In ONE op-sqlite
   * transaction: clear the account's `institution` (so `isSyncedAccount` is
   * false and `remove` accepts it), and strip the `monobankId` key from every
   * synced holding's metadata (so `isSyncedHolding` is false and each card/jar
   * holding becomes manual). Balances, holdings and transactions are left as-is.
   * Manual holdings under the account (no `monobankId`) are untouched. Clearing
   * the Keychain token is NOT done here — the Keychain is not transactional; the
   * `disconnectMonobank` operation in `../monobank/disconnect` composes both.
   */
  disconnectMonobank: (accountId: string) =>
    write(async (tx) => {
      await tx.update(accounts).set({ institution: null }).where(eq(accounts.id, accountId));
      const accountHoldings = await tx
        .select()
        .from(holdings)
        .where(eq(holdings.accountId, accountId));
      for (const holding of accountHoldings) {
        const meta = holding.metadata;
        if (typeof meta !== 'object' || meta === null || !('monobankId' in meta)) {
          continue;
        }
        const { monobankId: _monobankId, ...rest } = meta as Record<string, unknown>;
        const nextMetadata = Object.keys(rest).length > 0 ? rest : null;
        await tx
          .update(holdings)
          .set({ metadata: nextMetadata })
          .where(eq(holdings.id, holding.id));
      }
    }),
  update: (accountId: string, patch: Partial<AccountRow>) =>
    write((tx) => tx.update(accounts).set(patch).where(eq(accounts.id, accountId))),
  /**
   * Sets the account's icon (an SF Symbol name) or, with `null`, clears it back
   * to no custom icon. The display layer falls back to a kind-derived default
   * when the stored icon is null.
   */
  setIcon: (accountId: string, icon: string | null) =>
    write((tx) => tx.update(accounts).set({ icon }).where(eq(accounts.id, accountId))),
  archive: (accountId: string) =>
    write((tx) =>
      tx.update(accounts).set({ archivedAt: Date.now() }).where(eq(accounts.id, accountId)),
    ),
  /**
   * Delete a MANUAL account together with all of its holdings and every one of
   * their transactions, in ONE op-sqlite transaction so a partial failure can
   * never leave orphaned holdings or ledger rows behind (and so foreign-key
   * enforcement, ON per connection, is satisfied by deleting children before
   * parents: transactions, then holdings, then the account). A synced (monobank)
   * account is owned by the bank connection and is refused with a typed error; a
   * missing id is a no-op rather than an error.
   */
  remove: (accountId: string) =>
    write(async (tx) => {
      const rows = await tx.select().from(accounts).where(eq(accounts.id, accountId));
      const row = rows.at(0);
      if (!row) {
        return;
      }
      if (isSyncedAccount(row)) {
        throw new Error('accountsRepo.remove: cannot delete a synced account');
      }
      const accountHoldings = await tx
        .select()
        .from(holdings)
        .where(eq(holdings.accountId, accountId));
      for (const holding of accountHoldings) {
        await tx.delete(transactions).where(eq(transactions.holdingId, holding.id));
      }
      await tx.delete(holdings).where(eq(holdings.accountId, accountId));
      await tx.delete(accounts).where(eq(accounts.id, accountId));
    }),
} satisfies Repository;
