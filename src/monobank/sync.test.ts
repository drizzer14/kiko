// op-sqlite's open() calls a native module unavailable under Jest, and
// sync.ts imports the repos which open the connection at load. A minimal
// stub lets the module graph load; runSync's data access is fully injected
// through SyncDeps, so the real repos are never exercised here.
import type { AccountRow, HoldingRow, TransactionRow } from '../db/schema';

import clientInfo from './__fixtures__/client-info.json';
import statement from './__fixtures__/statement.json';
import type { MonobankAccount, MonobankJar, MonobankStatementItem } from './monobank.types';
import { mapAccountToHolding, mapStatementItem, runSync, type SyncDeps } from './sync';

describe('mapStatementItem', () => {
  it('maps a Monobank item to a transaction with the source and external id', () => {
    const item = statement[0];
    const transaction = mapStatementItem(item, 'holding-1');
    expect(transaction.source).toBe('monobank');
    expect(transaction.externalId).toBe(item.id);
    expect(transaction.amountMinorUnits).toBe(item.amount);
    expect(transaction.holdingId).toBe('holding-1');
  });

  it('converts Monobank unix seconds to milliseconds', () => {
    const item = statement[0];
    const transaction = mapStatementItem(item, 'holding-1');
    expect(transaction.time).toBe(item.time * 1000);
  });

  it('carries mcc and description through, defaulting a missing comment to null', () => {
    const withoutComment = statement[1];
    const transaction = mapStatementItem(withoutComment, 'holding-1');
    expect(transaction.mcc).toBe(withoutComment.mcc);
    expect(transaction.description).toBe(withoutComment.description);
    expect(transaction.comment).toBeNull();
  });

  it('derives category from the mcc via categoryForMcc', () => {
    const groceryItem = statement[0];
    const transaction = mapStatementItem(groceryItem, 'holding-1');
    expect(groceryItem.mcc).toBe(5411);
    expect(transaction.category).toBe('Groceries');
  });

  it('persists the counterparty IBAN when the statement item carries one', () => {
    const withCounterIban = statement[2];
    const transaction = mapStatementItem(withCounterIban, 'holding-1');
    expect(withCounterIban.counterIban).toBe('UA733220010000026201112223334');
    expect(transaction.counterIban).toBe('UA733220010000026201112223334');
  });

  it('defaults counterIban to null when the statement item has none', () => {
    const withoutCounterIban = statement[0];
    const transaction = mapStatementItem(withoutCounterIban, 'holding-1');
    expect(withoutCounterIban.counterIban).toBeUndefined();
    expect(transaction.counterIban).toBeNull();
  });

  it('keeps an existing comment', () => {
    const withComment = statement[0];
    const transaction = mapStatementItem(withComment, 'holding-1');
    expect(transaction.comment).toBe(withComment.comment);
  });
});

describe('mapAccountToHolding', () => {
  it('maps a card account onto a holding under the given account id', () => {
    const account = clientInfo.accounts[0] as MonobankAccount;
    const holding = mapAccountToHolding(account, 'account-1');
    expect(holding.accountId).toBe('account-1');
    expect(holding.type).toBe('card');
    expect(holding.currency).toBe('UAH');
    expect(holding.name).toBe(account.maskedPan[0]);
    expect(holding.balanceMinorUnits).toBe(account.balance);
    expect(holding.metadata).toMatchObject({
      monobankId: account.id,
      iban: account.iban,
      maskedPan: account.maskedPan,
    });
  });

  it('throws on an unsupported currency code', () => {
    const account = { ...(clientInfo.accounts[0] as MonobankAccount), currencyCode: 999 };
    expect(() => mapAccountToHolding(account, 'account-1')).toThrow(/currency/i);
  });
});

const monobankIdOf = (metadata: unknown): string | undefined =>
  (metadata as { monobankId?: string } | null)?.monobankId;

/**
 * A faithful in-memory double of the injected data-access seams: holdings
 * upsert on (accountId, monobankId), transactions dedup on (source,
 * externalId) — the same keys the real repos enforce.
 */
const bankAccount = (overrides: Partial<AccountRow> = {}): AccountRow => ({
  id: 'acc-1',
  name: 'My Bank',
  kind: 'bank',
  institution: null,
  sortOrder: 0,
  archivedAt: null,
  createdAt: 0,
  ...overrides,
});

const makeInMemoryDeps = (
  statementFor: (accountId: string) => MonobankStatementItem[],
  initialAccounts: AccountRow[] = [],
) => {
  const accountsStore: AccountRow[] = initialAccounts.map((account) => ({ ...account }));
  const holdingsStore: HoldingRow[] = [];
  const transactionsStore: TransactionRow[] = [];
  let sequence = 0;
  const nextId = () => `id-${++sequence}`;
  const sleep = jest.fn(async () => undefined);

  const upsertHolding: SyncDeps['upsertHolding'] = async ({ monobankId, metadata, ...rest }) => {
    const merged = { ...(metadata as Record<string, unknown> | null), monobankId };
    const existing = holdingsStore.find(
      (holding) =>
        holding.accountId === rest.accountId && monobankIdOf(holding.metadata) === monobankId,
    );
    if (existing) {
      existing.balanceMinorUnits = rest.balanceMinorUnits ?? 0;
      existing.metadata = merged;
      return;
    }
    holdingsStore.push({
      id: nextId(),
      sortOrder: 0,
      closedAt: null,
      createdAt: 0,
      balanceMinorUnits: rest.balanceMinorUnits ?? 0,
      ...rest,
      metadata: merged,
    });
  };

  const addTransactions: SyncDeps['addTransactions'] = async (inputs) => {
    for (const input of inputs) {
      const duplicate = transactionsStore.some(
        (row) => row.source === input.source && row.externalId === (input.externalId ?? null),
      );
      if (!duplicate) {
        transactionsStore.push({
          id: nextId(),
          category: null,
          description: '',
          mcc: null,
          comment: null,
          externalId: null,
          createdAt: 0,
          ...input,
        });
      }
    }
  };

  const deps: Partial<SyncDeps> = {
    fetchImpl: (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch,
    now: () => 1704326400000,
    sleep,
    readToken: async () => 'secret-token',
    fetchClientInfo: async () => ({
      accounts: clientInfo.accounts as MonobankAccount[],
      jars: clientInfo.jars as MonobankJar[],
    }),
    fetchStatement: async (_token, accountId) => statementFor(decodeURIComponent(accountId)),
    listAccounts: async () => accountsStore.map((account) => ({ ...account })),
    updateAccount: async (accountId, patch) => {
      const target = accountsStore.find((account) => account.id === accountId);
      if (target) {
        Object.assign(target, patch);
      }
    },
    listHoldingsByAccount: async (accountId) =>
      holdingsStore
        .filter((holding) => holding.accountId === accountId)
        .map((holding) => ({ ...holding })),
    upsertHolding,
    listTransactionsByHolding: async (holdingId) =>
      transactionsStore.filter((row) => row.holdingId === holdingId).map((row) => ({ ...row })),
    addTransactions,
    ensureSettings: async () => undefined,
    getLastSyncAt: async () => null,
    setLastSyncAt: async () => undefined,
  };

  return { deps, accountsStore, holdingsStore, transactionsStore, sleep };
};

describe('runSync', () => {
  const firstAccountId = clientInfo.accounts[0].id;
  const onlyFirstAccount = (accountId: string): MonobankStatementItem[] =>
    accountId === firstAccountId ? (statement as MonobankStatementItem[]) : [];

  it('marks the target account monobank, upserts holdings into it, and imports statement items', async () => {
    const target = bankAccount({ id: 'acc-1', institution: null });
    const { deps, accountsStore, holdingsStore, transactionsStore } = makeInMemoryDeps(
      onlyFirstAccount,
      [target],
    );
    deps.targetAccountId = 'acc-1';

    const result = await runSync(deps);

    // the pre-existing account is reused and marked, not duplicated
    expect(accountsStore).toHaveLength(1);
    expect(accountsStore[0].id).toBe('acc-1');
    expect(accountsStore[0].institution).toBe('monobank');
    // two card accounts + one jar, all under the target account
    expect(holdingsStore).toHaveLength(3);
    expect(holdingsStore.every((holding) => holding.accountId === 'acc-1')).toBe(true);
    expect(holdingsStore.filter((holding) => holding.type === 'jar')).toHaveLength(1);
    expect(result.importedTransactions).toBe(statement.length);
    expect(transactionsStore).toHaveLength(statement.length);
    // the grocery-MCC fixture item (5411) is synced with its derived category
    const groceryTransaction = transactionsStore.find(
      (transaction) => transaction.externalId === statement[0].id,
    );
    expect(groceryTransaction?.category).toBe('Groceries');
  });

  it('with no target id, syncs into the existing institution=monobank account', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, accountsStore, holdingsStore, transactionsStore } = makeInMemoryDeps(
      onlyFirstAccount,
      [connected],
    );

    const result = await runSync(deps);

    expect(accountsStore).toHaveLength(1);
    expect(holdingsStore.every((holding) => holding.accountId === 'acc-mono')).toBe(true);
    expect(result.importedTransactions).toBe(statement.length);
    expect(transactionsStore).toHaveLength(statement.length);
  });

  it('throws when neither a target id nor an existing monobank account exists', async () => {
    const { deps, holdingsStore, transactionsStore } = makeInMemoryDeps(onlyFirstAccount, [
      bankAccount({ id: 'acc-cash', institution: null }),
    ]);

    await expect(runSync(deps)).rejects.toThrow('No Monobank account connected');
    expect(holdingsStore).toHaveLength(0);
    expect(transactionsStore).toHaveLength(0);
  });

  it('rejects connecting a second account while another is already connected, importing nothing', async () => {
    const connected = bankAccount({ id: 'acc-a', institution: 'monobank' });
    const second = bankAccount({ id: 'acc-b', institution: null });
    const { deps, accountsStore, holdingsStore, transactionsStore } = makeInMemoryDeps(
      onlyFirstAccount,
      [connected, second],
    );
    deps.targetAccountId = 'acc-b';

    await expect(runSync(deps)).rejects.toThrow('A Monobank account is already connected');
    // account B is never marked, and no holdings/transactions land under it
    expect(accountsStore.find((account) => account.id === 'acc-b')?.institution).toBeNull();
    expect(holdingsStore.filter((holding) => holding.accountId === 'acc-b')).toHaveLength(0);
    expect(holdingsStore).toHaveLength(0);
    expect(transactionsStore).toHaveLength(0);
  });

  it('allows re-connecting the SAME already-connected account (idempotent re-sync)', async () => {
    const connected = bankAccount({ id: 'acc-a', institution: 'monobank' });
    const { deps, accountsStore, holdingsStore, transactionsStore } = makeInMemoryDeps(
      onlyFirstAccount,
      [connected],
    );
    deps.targetAccountId = 'acc-a';

    const result = await runSync(deps);

    expect(accountsStore).toHaveLength(1);
    expect(accountsStore[0].institution).toBe('monobank');
    expect(holdingsStore.every((holding) => holding.accountId === 'acc-a')).toBe(true);
    expect(result.importedTransactions).toBe(statement.length);
    expect(transactionsStore).toHaveLength(statement.length);
  });

  it('throws when the target id does not match any existing account', async () => {
    const { deps, holdingsStore, transactionsStore } = makeInMemoryDeps(onlyFirstAccount, [
      bankAccount({ id: 'acc-cash', institution: null }),
    ]);
    deps.targetAccountId = 'acc-does-not-exist';

    await expect(runSync(deps)).rejects.toThrow('No Monobank account connected');
    expect(holdingsStore).toHaveLength(0);
    expect(transactionsStore).toHaveLength(0);
  });

  it('imports zero new transactions on a second run (dedup on source + externalId)', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, transactionsStore } = makeInMemoryDeps(onlyFirstAccount, [connected]);

    const first = await runSync(deps);
    const second = await runSync(deps);

    expect(first.importedTransactions).toBe(statement.length);
    expect(second.importedTransactions).toBe(0);
    // no duplicates accumulated across the two runs
    expect(transactionsStore).toHaveLength(statement.length);
  });

  it('does not create a second account on a repeat sync', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, accountsStore } = makeInMemoryDeps(onlyFirstAccount, [connected]);

    await runSync(deps);
    await runSync(deps);

    expect(accountsStore).toHaveLength(1);
  });

  it('throws when no token is stored, without importing anything', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, transactionsStore } = makeInMemoryDeps(onlyFirstAccount, [connected]);
    deps.readToken = async () => undefined;

    await expect(runSync(deps)).rejects.toThrow(/token/i);
    expect(transactionsStore).toHaveLength(0);
  });

  it('does not throw and still imports cards when client-info omits jars (jars: undefined)', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, holdingsStore, transactionsStore } = makeInMemoryDeps(onlyFirstAccount, [
      connected,
    ]);
    // A Monobank user with NO jars: the /personal/client-info response omits
    // `jars`, so it arrives undefined. This must not crash the sync.
    deps.fetchClientInfo = async () => ({
      accounts: clientInfo.accounts as MonobankAccount[],
      jars: undefined,
    });

    const result = await runSync(deps);

    // the card holdings still land, and none are jars
    expect(holdingsStore).toHaveLength(clientInfo.accounts.length);
    expect(holdingsStore.every((holding) => holding.type === 'card')).toBe(true);
    // the transaction-import loop still runs for the cards
    expect(result.importedTransactions).toBe(statement.length);
    expect(transactionsStore).toHaveLength(statement.length);
  });

  it('does not throw and still imports cards when client-info has no jars field at all', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, holdingsStore, transactionsStore } = makeInMemoryDeps(onlyFirstAccount, [
      connected,
    ]);
    // `jars` entirely absent from the payload — same effect as undefined.
    deps.fetchClientInfo = async () => ({
      accounts: clientInfo.accounts as MonobankAccount[],
    });

    const result = await runSync(deps);

    expect(holdingsStore).toHaveLength(clientInfo.accounts.length);
    expect(holdingsStore.every((holding) => holding.type === 'card')).toBe(true);
    expect(result.importedTransactions).toBe(statement.length);
    expect(transactionsStore).toHaveLength(statement.length);
  });

  it('pages a capped window and throttles with the injected sleep', async () => {
    const cappedPage: MonobankStatementItem[] = Array.from({ length: 500 }, (_, index) => ({
      ...(statement[0] as MonobankStatementItem),
      id: `page-1-${index}`,
      time: 1704240000 - index,
    }));
    const secondPage: MonobankStatementItem[] = [
      { ...(statement[0] as MonobankStatementItem), id: 'page-2-0', time: 1704000000 },
    ];

    let call = 0;
    const pagingStatement = (accountId: string): MonobankStatementItem[] => {
      if (accountId !== clientInfo.accounts[0].id) {
        return [];
      }
      call += 1;
      return call === 1 ? cappedPage : secondPage;
    };

    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, sleep, transactionsStore } = makeInMemoryDeps(pagingStatement, [connected]);

    const result = await runSync(deps);

    expect(result.importedTransactions).toBe(cappedPage.length + secondPage.length);
    expect(transactionsStore).toHaveLength(cappedPage.length + secondPage.length);
    // a delay was inserted between the two paged requests to respect the rate limit
    expect(sleep).toHaveBeenCalledWith(60 * 1000);
  });
});
