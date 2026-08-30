// op-sqlite's open() calls a native module unavailable under Jest, and
// sync.ts imports the repos which open the connection at load. A minimal
// stub lets the module graph load; runSync's data access is fully injected
// through SyncDeps, so the real repos are never exercised here.
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

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
const makeInMemoryDeps = (statementFor: (accountId: string) => MonobankStatementItem[]) => {
  const accountsStore: AccountRow[] = [];
  const holdingsStore: HoldingRow[] = [];
  const transactionsStore: TransactionRow[] = [];
  let sequence = 0;
  const nextId = () => `id-${++sequence}`;
  const sleep = jest.fn(async () => undefined);

  const upsertHolding: SyncDeps['upsertHolding'] = async ({ monobankId, metadata, ...rest }) => {
    const merged = { ...(metadata as Record<string, unknown> | null), monobankId };
    const existing = holdingsStore.find(
      holding =>
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

  const addTransactions: SyncDeps['addTransactions'] = async inputs => {
    for (const input of inputs) {
      const duplicate = transactionsStore.some(
        row => row.source === input.source && row.externalId === (input.externalId ?? null),
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
    listAccounts: async () => accountsStore.map(account => ({ ...account })),
    createMonobankAccount: async () => {
      accountsStore.push({
        id: nextId(),
        name: 'Monobank',
        kind: 'bank',
        institution: 'monobank',
        sortOrder: 0,
        archivedAt: null,
        createdAt: 0,
      });
    },
    listHoldingsByAccount: async accountId =>
      holdingsStore
        .filter(holding => holding.accountId === accountId)
        .map(holding => ({ ...holding })),
    upsertHolding,
    listTransactionsByHolding: async holdingId =>
      transactionsStore.filter(row => row.holdingId === holdingId).map(row => ({ ...row })),
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

  it('creates a single Monobank account, upserts holdings, and imports statement items', async () => {
    const { deps, accountsStore, holdingsStore, transactionsStore } =
      makeInMemoryDeps(onlyFirstAccount);

    const result = await runSync(deps);

    expect(accountsStore).toHaveLength(1);
    expect(accountsStore[0].institution).toBe('monobank');
    // two card accounts + one jar
    expect(holdingsStore).toHaveLength(3);
    expect(holdingsStore.filter(holding => holding.type === 'jar')).toHaveLength(1);
    expect(result.importedTransactions).toBe(statement.length);
    expect(transactionsStore).toHaveLength(statement.length);
  });

  it('imports zero new transactions on a second run (dedup on source + externalId)', async () => {
    const { deps, transactionsStore } = makeInMemoryDeps(onlyFirstAccount);

    const first = await runSync(deps);
    const second = await runSync(deps);

    expect(first.importedTransactions).toBe(statement.length);
    expect(second.importedTransactions).toBe(0);
    // no duplicates accumulated across the two runs
    expect(transactionsStore).toHaveLength(statement.length);
  });

  it('does not create a second Monobank account on a repeat sync', async () => {
    const { deps, accountsStore } = makeInMemoryDeps(onlyFirstAccount);

    await runSync(deps);
    await runSync(deps);

    expect(accountsStore).toHaveLength(1);
  });

  it('throws when no token is stored, without importing anything', async () => {
    const { deps, transactionsStore } = makeInMemoryDeps(onlyFirstAccount);
    deps.readToken = async () => undefined;

    await expect(runSync(deps)).rejects.toThrow(/token/i);
    expect(transactionsStore).toHaveLength(0);
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

    const { deps, sleep, transactionsStore } = makeInMemoryDeps(pagingStatement);

    const result = await runSync(deps);

    expect(result.importedTransactions).toBe(cappedPage.length + secondPage.length);
    expect(transactionsStore).toHaveLength(cappedPage.length + secondPage.length);
    // a delay was inserted between the two paged requests to respect the rate limit
    expect(sleep).toHaveBeenCalledWith(60 * 1000);
  });
});
