// op-sqlite's open() calls a native module unavailable under Jest, and
// sync.ts imports the repos which open the connection at load. A minimal
// stub lets the module graph load; runSync's data access is fully injected
// through SyncDeps, so the real repos are never exercised here.
import type { AccountRow, HoldingRow, TransactionRow } from '../../db/schema';
import { i18n } from '../../i18n';

import clientInfo from '../__fixtures__/client-info.json';
import statement from '../__fixtures__/statement.json';
import type { MonobankAccount, MonobankJar, MonobankStatementItem } from '../monobank.types';
import {
  mapAccountToHolding,
  mapStatementItem,
  nextFailedSet,
  runSync,
  type SyncDeps,
} from './sync';
import {
  getProgressSnapshot,
  isFastPhaseDone,
  getSnapshot as isSyncingSnapshot,
  subscribeProgress,
} from '../sync-status';

describe('mapStatementItem', () => {
  it('namespaces the external id by account id so two connections cannot collide', () => {
    const item = statement[0];
    const transaction = mapStatementItem(item, 'holding-1', 'acc-1');
    expect(transaction.source).toBe('monobank');
    // Phase 6: the synced external id is `${accountId}:${statementId}`, so the
    // GLOBAL `(source, external_id)` unique index can never let a second Monobank
    // (or Binance) connection refresh another connection's row on a shared raw id.
    expect(transaction.externalId).toBe(`acc-1:${item.id}`);
    expect(transaction.amountMinorUnits).toBe(item.amount);
    expect(transaction.holdingId).toBe('holding-1');
  });

  it('produces a distinct external id per account for the SAME raw statement id', () => {
    const item = statement[0];
    const a = mapStatementItem(item, 'holding-a', 'acc-a');
    const b = mapStatementItem(item, 'holding-b', 'acc-b');
    expect(a.externalId).toBe(`acc-a:${item.id}`);
    expect(b.externalId).toBe(`acc-b:${item.id}`);
    expect(a.externalId).not.toBe(b.externalId);
  });

  it('converts Monobank unix seconds to milliseconds', () => {
    const item = statement[0];
    const transaction = mapStatementItem(item, 'holding-1', 'acc-1');
    expect(transaction.time).toBe(item.time * 1000);
  });

  it('carries mcc and description through, defaulting a missing comment to null', () => {
    const withoutComment = statement[1];
    const transaction = mapStatementItem(withoutComment, 'holding-1', 'acc-1');
    expect(transaction.mcc).toBe(withoutComment.mcc);
    expect(transaction.description).toBe(withoutComment.description);
    expect(transaction.comment).toBeNull();
  });

  it('derives category from the mcc via categoryForMcc', () => {
    const groceryItem = statement[0];
    const transaction = mapStatementItem(groceryItem, 'holding-1', 'acc-1');
    expect(groceryItem.mcc).toBe(5411);
    // The persisted value is the `categories.key` slug, never a display title.
    expect(transaction.category).toBe('groceries');
  });

  it('persists the counterparty IBAN when the statement item carries one', () => {
    const withCounterIban = statement[2];
    const transaction = mapStatementItem(withCounterIban, 'holding-1', 'acc-1');
    expect(withCounterIban.counterIban).toBe('UA733220010000026201112223334');
    expect(transaction.counterIban).toBe('UA733220010000026201112223334');
  });

  it('defaults counterIban to null when the statement item has none', () => {
    const withoutCounterIban = statement[0];
    const transaction = mapStatementItem(withoutCounterIban, 'holding-1', 'acc-1');
    expect(withoutCounterIban.counterIban).toBeUndefined();
    expect(transaction.counterIban).toBeNull();
  });

  it('keeps an existing comment', () => {
    const withComment = statement[0];
    const transaction = mapStatementItem(withComment, 'holding-1', 'acc-1');
    expect(transaction.comment).toBe(withComment.comment);
  });

  // `hold: true` marks a PENDING authorization whose settled amount can still
  // change, so the stored row has to carry the flag for a reader to tell a
  // provisional amount from a final one.
  it('persists the pending-authorization hold flag', () => {
    const pending = statement[2];
    const transaction = mapStatementItem(pending, 'holding-1', 'acc-1');
    expect(pending.hold).toBe(true);
    expect(transaction.hold).toBe(true);
  });

  it('defaults a hold-less payload to settled', () => {
    const { hold, ...withoutHold } = statement[0];
    const transaction = mapStatementItem(
      withoutHold as MonobankStatementItem,
      'holding-1',
      'acc-1',
    );
    expect(hold).toBe(false);
    expect(transaction.hold).toBe(false);
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

describe('nextFailedSet', () => {
  it('drops succeeded ids, keeps still-failing prior ids, adds newly-failed ids, and prunes ids absent from client-info', () => {
    const current = new Set(['a', 'b', 'c']);
    // prior [a, b, x]: a succeeded (drop), b still failed (keep), x pruned (not
    // in client-info); c is a fresh failure (add).
    const result = nextFailedSet(['a', 'b', 'x'], ['a'], ['c'], current);
    expect([...result].sort()).toEqual(['b', 'c']);
  });

  it('returns an empty set when every prior failure succeeded and nothing new failed', () => {
    expect(nextFailedSet(['a', 'b'], ['a', 'b'], [], new Set(['a', 'b']))).toEqual([]);
  });

  it('does not duplicate an id present in both prior and failed', () => {
    expect(nextFailedSet(['a'], [], ['a'], new Set(['a']))).toEqual(['a']);
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
  // A `Partial`/optional spread reintroduces `undefined` into every nullable
  // column, so each one the row type declares as `T | null` is restated from
  // the merged value — the same normalization the real repository does.
  icon: overrides.icon ?? null,
  color: overrides.color ?? null,
});

type SyncedTransactionInput = Parameters<SyncDeps['transactionsRepo']['addManyDedup']>[0][number];

/**
 * The BANK-OWNED columns of a synced row: the ones a re-fetched statement item
 * refreshes on conflict, normalized onto the `T | null` shape a stored row
 * declares. `category` and `comment` are deliberately absent — they may hold the
 * user's own value, and the real `addManyDedup` upsert leaves them alone too.
 *
 * This list MIRRORS that upsert's `onConflictDoUpdate` set in
 * `transactions/transactions.repo.ts` and must change with it, or the double
 * stops standing for the repository it doubles.
 */
const bankOwnedColumns = (input: SyncedTransactionInput) => ({
  amountMinorUnits: input.amountMinorUnits,
  time: input.time,
  description: input.description ?? '',
  mcc: input.mcc ?? null,
  hold: input.hold ?? null,
  counterIban: input.counterIban ?? null,
});

const makeInMemoryDeps = (
  statementFor: (accountId: string) => MonobankStatementItem[],
  initialAccounts: AccountRow[] = [],
) => {
  const accountsStore: AccountRow[] = initialAccounts.map((account) => ({ ...account }));
  const holdingsStore: HoldingRow[] = [];
  const transactionsStore: TransactionRow[] = [];
  // The connected account's per-connection sync_state row the sync reads through
  // `syncStateRepo.getQuery(accountId)`. It is mutable so a test can seed a
  // cursor/full-fetch marker/force-fetch set (and, via a setter it wires itself,
  // read a write back). The defaults model a never-synced app — null cursor, null
  // full-fetch marker, no force-fetch set — which forces a full fetch, the
  // starting point every existing test builds on.
  const syncStateRow: Awaited<ReturnType<SyncDeps['syncStateRepo']['getQuery']>>[number] = {
    lastSyncAt: null,
    lastFullSyncAt: null,
    failedSyncMonobankIds: null,
  };
  let sequence = 0;
  const nextId = () => `id-${++sequence}`;
  // Typed with the dep's own `milliseconds` parameter so an assertion can read
  // back the delay each call asked for, not merely that a call happened.
  const sleep = jest.fn(async (_milliseconds: number): Promise<void> => undefined);

  const upsertOne = ({
    monobankId,
    metadata,
    ...rest
  }: Parameters<SyncDeps['holdingsRepo']['upsertMonobankMany']>[0][number]): void => {
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
      // A fresh holding has never had its statements imported, so the crash-safe
      // marker starts NULL. The sync advances it (via `setSyncedBalance`) only
      // after a card's statements commit — the real repository does the same.
      syncedBalanceMinorUnits: null,
      ...rest,
      // The dep's input carries neither column, but a stored row declares both
      // as `string | null` — the real repository defaults them the same way.
      icon: null,
      color: null,
      metadata: merged,
    });
  };

  // Batched holdings upsert (mirrors `holdingsRepo.upsertMonobankMany`): one call
  // per sync writes every card/jar, so the reactive `holdings` callback fires
  // once for the fast phase rather than once per card.
  const upsertMonobankMany: SyncDeps['holdingsRepo']['upsertMonobankMany'] = async (holdings) => {
    for (const holding of holdings) {
      upsertOne(holding);
    }
  };

  // Mirrors `transactionsRepo.addManyDedup`'s upsert on (source, externalId): a
  // re-fetched statement item REFRESHES the stored row's bank-owned fields
  // (amount/description/hold/mcc/counterIban/time) instead of being skipped,
  // while `category` and `comment` — which the user may have overridden — are
  // left untouched. It returns the number of rows actually INSERTED, which is
  // what the sync reports to the user as "imported".
  const addManyDedup: SyncDeps['transactionsRepo']['addManyDedup'] = async (inputs) => {
    let inserted = 0;

    for (const input of inputs) {
      // SQLite treats every NULL as distinct in a unique index, so a row with no
      // external id (a manual one) never conflicts with another.
      const existing = input.externalId
        ? transactionsStore.find(
            (row) => row.source === input.source && row.externalId === input.externalId,
          )
        : undefined;

      if (existing) {
        Object.assign(existing, bankOwnedColumns(input));
        continue;
      }

      transactionsStore.push({
        id: nextId(),
        createdAt: 0,
        ...input,
        // The input declares each of these as optional, so the spread can put
        // `undefined` where the stored row requires `T | null` — restated after
        // the spread, exactly as the real repository normalizes them.
        ...bankOwnedColumns(input),
        category: input.category ?? null,
        // A synced row is never an exchange leg — that marker is written only
        // by the manual Exchange/Convert paths.
        exchangeCounterpartHoldingId: null,
        comment: input.comment ?? null,
        externalId: input.externalId ?? null,
      });
      inserted += 1;
    }

    return inserted;
  };

  // The injected repositories are whole OBJECTS now, not per-method wrappers: the
  // sync calls `deps.<repo>.<method>()` directly, so each in-memory double stands
  // for the real repo module. A test overrides a single method on the returned
  // repo (e.g. `deps.syncStateRepo.setLastSyncAt = jest.fn(...)`) or seeds a value
  // through `syncStateRow` / `deps.transactionsRepo.holdingIdsWithHoldQuery`.
  const accountsRepo: SyncDeps['accountsRepo'] = {
    listQuery: async () => accountsStore.map((account) => ({ ...account })),
    update: async (accountId, patch) => {
      const target = accountsStore.find((account) => account.id === accountId);
      if (target) {
        Object.assign(target, patch);
      }
    },
  };

  const holdingsRepo: SyncDeps['holdingsRepo'] = {
    listByAccountQuery: async (accountId) =>
      holdingsStore
        .filter((holding) => holding.accountId === accountId)
        .map((holding) => ({ ...holding })),
    upsertMonobankMany,
    // The crash-safe marker write: advances a card's `syncedBalanceMinorUnits`
    // once its statements have committed, mirroring `holdingsRepo.setSyncedBalance`.
    setSyncedBalance: async (holdingId, balanceMinorUnits) => {
      const target = holdingsStore.find((holding) => holding.id === holdingId);
      if (target) {
        target.syncedBalanceMinorUnits = balanceMinorUnits;
      }
    },
    // Stale-holding reconciliation seam (mirrors `holdingsRepo.closeMany`): stamp
    // `closedAt` on each id. A jest.fn so a test can assert exactly which ids the
    // sync closed, or that it closed none.
    closeMany: jest.fn(async (holdingIds: string[]): Promise<void> => {
      for (const holdingId of holdingIds) {
        const target = holdingsStore.find((holding) => holding.id === holdingId);
        if (target) {
          target.closedAt = 1704326400000;
        }
      }
    }),
  };

  const transactionsRepo: SyncDeps['transactionsRepo'] = {
    addManyDedup,
    // No outstanding holds by default; a test that exercises the hold carve-out
    // overrides this with the held card's holding id.
    holdingIdsWithHoldQuery: async () => [],
  };

  const syncStateRepo: SyncDeps['syncStateRepo'] = {
    // The sync derives all three cursors — `lastSyncAt`, `lastFullSyncAt`,
    // `failedSyncMonobankIds` — from this single connected account's row. `null`
    // everywhere forces a full fetch (via `shouldFullFetch`), which is what every
    // existing test builds from until it seeds `syncStateRow`; on that full fetch
    // the from-window derives from `lastFullSyncAt` (see `fromCursorSeconds`), so a
    // non-null default equal to `now` would collapse the window to empty and fetch
    // nothing. A test exercising the balance-diff skip seeds BOTH a recent
    // `lastSyncAt` and a recent `lastFullSyncAt` so the periodic safety net does
    // not fire. `getQuery` ignores the account id here because these
    // single-connection tests model exactly one connected account; `ensure` is a
    // no-op because the row always exists.
    getQuery: async () => [syncStateRow],
    ensure: async () => undefined,
    setLastSyncAt: async () => undefined,
    setLastSyncDisplayAt: async () => undefined,
    setLastFullSyncAt: async () => undefined,
    // No card is force-retried by default. This spy lets a test assert the
    // persisted set without wiring a store; the production sync converts an empty
    // set to `null` before calling it (see `failedIdsToPersist` in `sync.ts`), so
    // the second argument is `string[] | null` and the first is the account id.
    setFailedSyncMonobankIds: jest.fn(
      async (_accountId: string, _ids: string[] | null): Promise<void> => undefined,
    ),
  };

  const deps: SyncDeps = {
    fetchImpl: (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch,
    now: () => 1704326400000,
    sleep,
    readToken: async () => 'secret-token',
    fetchClientInfo: async () => ({
      accounts: clientInfo.accounts as MonobankAccount[],
      jars: clientInfo.jars as MonobankJar[],
    }),
    fetchStatement: async (_token, accountId) => statementFor(decodeURIComponent(accountId)),
    accountsRepo,
    holdingsRepo,
    transactionsRepo,
    syncStateRepo,
  };

  return { deps, accountsStore, holdingsStore, transactionsStore, syncStateRow, sleep };
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
      (transaction) => transaction.externalId === `acc-1:${statement[0].id}`,
    );
    expect(groceryTransaction?.category).toBe('groceries');
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

  // `useSyncAction` (src/sync/use-sync.ts) surfaces this thrown message
  // verbatim as the account-detail screen's error text, so it genuinely needs
  // to resolve in the active language, unlike a swallowed/discarded error.
  it('throws the no-account-connected message in Ukrainian once the active language switches', async () => {
    const { deps } = makeInMemoryDeps(onlyFirstAccount, [
      bankAccount({ id: 'acc-cash', institution: null }),
    ]);

    await i18n.changeLanguage('uk');
    try {
      await expect(runSync(deps)).rejects.toThrow('Рахунок Monobank не підключено');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('allows connecting a second Monobank account while another is already connected', async () => {
    const connected = bankAccount({ id: 'acc-a', institution: 'monobank' });
    const second = bankAccount({ id: 'acc-b', institution: null });
    const { deps, accountsStore, holdingsStore } = makeInMemoryDeps(onlyFirstAccount, [
      connected,
      second,
    ]);
    deps.targetAccountId = 'acc-b';

    const result = await runSync(deps);

    // The one-connection-per-institution invariant is relaxed: account B connects
    // independently, is marked monobank, and imports its own holdings/transactions
    // under itself — the already-connected account A never blocks it.
    expect(accountsStore.find((account) => account.id === 'acc-b')?.institution).toBe('monobank');
    expect(holdingsStore.some((holding) => holding.accountId === 'acc-b')).toBe(true);
    expect(result.importedTransactions).toBe(statement.length);
  });

  // Phase 6 / Risk R-1: two Monobank connections that each fetch a statement item
  // carrying the SAME raw id must import TWO distinct rows, one per account —
  // never let the second connection's upsert refresh the first's row on the
  // GLOBAL `(source, external_id)` index. The account-id namespace is what keeps
  // the two keys apart.
  it('imports two DISTINCT rows when two connections share a raw statement id', async () => {
    const accountA = bankAccount({ id: 'acc-a', institution: 'monobank' });
    const accountB = bankAccount({ id: 'acc-b', institution: null });
    // The SAME raw statement id fetched for whichever account is syncing.
    const shared: MonobankStatementItem[] = [
      { ...(statement[0] as MonobankStatementItem), id: 'shared-1' },
    ];
    const { deps, transactionsStore } = makeInMemoryDeps(
      (accountId) => (accountId === firstAccountId ? shared : []),
      [accountA, accountB],
    );

    await runSync({ ...deps, targetAccountId: 'acc-a' });
    await runSync({ ...deps, targetAccountId: 'acc-b' });

    // Two rows, namespaced apart — the second connection did NOT overwrite the
    // first. With a global (source, external_id) key on the bare id, the second
    // import would have refreshed account A's row instead of inserting B's.
    const shared1Rows = transactionsStore.filter((row) =>
      (row.externalId ?? '').endsWith(':shared-1'),
    );
    expect(shared1Rows).toHaveLength(2);
    expect(new Set(shared1Rows.map((row) => row.externalId))).toEqual(
      new Set(['acc-a:shared-1', 'acc-b:shared-1']),
    );
  });

  // The backfill migration rewrites a pre-Phase-6 row's `external_id` to
  // `${accountId}:${rawId}` — the EXACT form the sync now produces. So a re-sync
  // after the backfill must match that already-backfilled row IN PLACE (refresh),
  // never insert a duplicate. This asserts the namespaced key round-trips.
  it('re-syncs a backfilled row in place, adding no duplicate', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const item: MonobankStatementItem[] = [
      { ...(statement[0] as MonobankStatementItem), id: 'stmt-1', amount: -5_000 },
    ];
    const { deps, holdingsStore, transactionsStore } = makeInMemoryDeps(
      (accountId) => (accountId === firstAccountId ? item : []),
      [connected],
    );

    // First run creates the card holding + imports the row (namespaced).
    await runSync(deps);
    const cardHolding = holdingsStore.find(
      (holding) => monobankIdOf(holding.metadata) === firstAccountId,
    );
    // Simulate the backfilled form already stored (identical to what the sync
    // writes): `${accountId}:${rawId}`. It is here from the first run.
    expect(transactionsStore.some((row) => row.externalId === 'acc-mono:stmt-1')).toBe(true);
    expect(cardHolding?.accountId).toBe('acc-mono');

    // A second re-sync of the same id must refresh the same row, not duplicate it.
    const second = await runSync(deps);

    expect(transactionsStore.filter((row) => row.externalId === 'acc-mono:stmt-1')).toHaveLength(1);
    expect(second.importedTransactions).toBe(0);
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

  it('leaves the target account unmarked when client-info fails', async () => {
    const target = bankAccount({ id: 'acc-1', institution: null });
    const { deps, accountsStore } = makeInMemoryDeps(onlyFirstAccount, [target]);
    deps.targetAccountId = 'acc-1';
    deps.fetchClientInfo = jest.fn(() => Promise.reject(new Error('401')));

    await expect(runSync(deps)).rejects.toThrow('401');

    expect(accountsStore[0].institution).toBeNull();
  });

  it('marks the target account only once client-info resolves, not before', async () => {
    const target = bankAccount({ id: 'acc-1', institution: null });
    const { deps, accountsStore } = makeInMemoryDeps(onlyFirstAccount, [target]);
    deps.targetAccountId = 'acc-1';
    const calls: string[] = [];
    const originalFetchClientInfo = deps.fetchClientInfo as SyncDeps['fetchClientInfo'];
    deps.fetchClientInfo = async (token, fetchImpl) => {
      calls.push('fetchClientInfo');
      // At the moment fetchClientInfo resolves, the account must still be
      // unmarked — the mark can only happen after this call returns.
      expect(accountsStore[0].institution).toBeNull();
      return originalFetchClientInfo(token, fetchImpl);
    };
    deps.accountsRepo.update = async (accountId, patch) => {
      calls.push('updateAccount');
      const account = accountsStore.find((row) => row.id === accountId);
      if (account) {
        Object.assign(account, patch);
      }
    };

    await runSync(deps);

    expect(calls).toEqual(['fetchClientInfo', 'updateAccount']);
    expect(accountsStore[0].institution).toBe('monobank');
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

  // A `hold: true` item is a PENDING authorization whose final amount can still
  // move (a restaurant tip, a fuel pre-auth). It is imported right away so the
  // ledger shows the pending charge, which means the settled re-fetch must
  // REFRESH that row — dropping it as a duplicate froze the provisional amount
  // forever.
  it('refreshes a re-synced held item to its settled amount, keeping one row', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    let page: MonobankStatementItem[] = [
      { ...(statement[0] as MonobankStatementItem), id: 'stmt-1', amount: -10_000, hold: true },
    ];
    const { deps, transactionsStore } = makeInMemoryDeps(
      (accountId) => (accountId === firstAccountId ? page : []),
      [connected],
    );

    await runSync(deps);

    page = [
      { ...(statement[0] as MonobankStatementItem), id: 'stmt-1', amount: -12_500, hold: false },
    ];
    const second = await runSync(deps);

    const rows = transactionsStore.filter((row) => row.externalId === 'acc-mono:stmt-1');

    expect(rows).toHaveLength(1);
    expect(rows[0].amountMinorUnits).toBe(-12_500);
    expect(rows[0].hold).toBe(false);
    // A refresh is not an import: nothing new reached the ledger.
    expect(second.importedTransactions).toBe(0);
  });

  it('does not clobber a user category override on re-sync', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    let page: MonobankStatementItem[] = [
      { ...(statement[0] as MonobankStatementItem), id: 'stmt-1', amount: -10_000, hold: true },
    ];
    const { deps, transactionsStore } = makeInMemoryDeps(
      (accountId) => (accountId === firstAccountId ? page : []),
      [connected],
    );

    await runSync(deps);
    // The MCC-derived category, which the user then overrides by hand.
    expect(transactionsStore[0].category).toBe('groceries');
    transactionsStore[0].category = 'dining';

    page = [
      { ...(statement[0] as MonobankStatementItem), id: 'stmt-1', amount: -12_500, hold: false },
    ];
    await runSync(deps);

    expect(transactionsStore[0].category).toBe('dining');
    expect(transactionsStore[0].amountMinorUnits).toBe(-12_500);
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

  it('reads the token keyed by the resolved connected account id', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps } = makeInMemoryDeps(onlyFirstAccount, [connected]);
    deps.readToken = jest.fn(async () => 'secret-token');

    await runSync(deps);

    // The token is per-connection: the sync resolves the target account FIRST,
    // then reads THAT account's own token — never a shared global one.
    expect(deps.readToken).toHaveBeenCalledWith('acc-mono');
  });

  it('reads the token keyed by the targetAccountId on a first-time connect', async () => {
    const target = bankAccount({ id: 'acc-1', institution: null });
    const { deps } = makeInMemoryDeps(onlyFirstAccount, [target]);
    deps.targetAccountId = 'acc-1';
    deps.readToken = jest.fn(async () => 'secret-token');

    await runSync(deps);

    expect(deps.readToken).toHaveBeenCalledWith('acc-1');
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

  // A foreign-currency sub-account (a multi-currency card, a FOP account, a
  // foreign jar) carries a currency Kiko cannot represent (anything other than
  // UAH/USD/EUR). Such an account/jar must be SILENTLY SKIPPED — excluded from
  // net worth — rather than aborting the entire sync: the mappers throw on an
  // unrepresentable currency, and `upsertHoldings` used to call them inside its
  // loop with no guard, so ONE foreign card threw before any card imported and
  // before the cursor was written, stranding the user in a permanent "cannot
  // sync". The whole run must now COMPLETE: the supported card imports, the
  // unsupported account and jar are never upserted, and the cursor advances.
  it('skips an unsupported-currency account and jar, completing the sync for the supported card', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const supported = clientInfo.accounts[0] as MonobankAccount; // UAH (980)
    const unsupportedAccount: MonobankAccount = {
      ...(clientInfo.accounts[1] as MonobankAccount),
      currencyCode: 985, // PLN — not representable in Kiko
    };
    const unsupportedJar: MonobankJar = {
      ...(clientInfo.jars[0] as MonobankJar),
      currencyCode: 826, // GBP — not representable in Kiko
    };
    const { deps, holdingsStore, transactionsStore } = makeInMemoryDeps(onlyFirstAccount, [
      connected,
    ]);
    deps.fetchClientInfo = async () => ({
      accounts: [supported, unsupportedAccount],
      jars: [unsupportedJar],
    });
    const setLastSyncAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    deps.syncStateRepo.setLastSyncAt = setLastSyncAt;

    const result = await runSync(deps);

    // Only the supported card landed as a holding — the PLN account and GBP jar
    // were skipped, never upserted.
    expect(holdingsStore).toHaveLength(1);
    expect(holdingsStore[0].type).toBe('card');
    expect(holdingsStore[0].currency).toBe('UAH');
    expect(monobankIdOf(holdingsStore[0].metadata)).toBe(supported.id);
    expect(
      holdingsStore.some((holding) => monobankIdOf(holding.metadata) === unsupportedAccount.id),
    ).toBe(false);
    expect(
      holdingsStore.some((holding) => monobankIdOf(holding.metadata) === unsupportedJar.id),
    ).toBe(false);
    // The supported card still imported its statement rows, and the run
    // completed cleanly so the cursor advanced.
    expect(result.importedTransactions).toBe(statement.length);
    expect(transactionsStore).toHaveLength(statement.length);
    expect(setLastSyncAt).toHaveBeenCalledTimes(1);
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

  it('pages to the earliest item second itself, importing a same-second straggler', async () => {
    // A full (capped) page whose earliest item — the one that filled the
    // 500-item cap — shares its exact second with a "straggler" that did NOT
    // fit in the page. The straggler must still be reachable in the next
    // window, which means the next window's ceiling has to be that shared
    // second itself, not one second before it.
    const boundary = 1704240000;
    const page: MonobankStatementItem[] = Array.from({ length: 500 }, (_, index) => ({
      ...(statement[0] as MonobankStatementItem),
      id: `p1-${index}`,
      time: index === 499 ? boundary : boundary + 1000 + index,
    }));
    const straggler: MonobankStatementItem = {
      ...(statement[0] as MonobankStatementItem),
      id: 'straggler',
      time: boundary,
    };

    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, transactionsStore } = makeInMemoryDeps(() => [], [connected]);

    // A window-aware double: the bulk page is only visible while the queried
    // ceiling still covers its items; once the ceiling narrows to `boundary`
    // itself, only the straggler (also at `boundary`) is in range. The old
    // `- 1` ceiling never queries `to === boundary`, so it never sees the
    // straggler at all.
    deps.fetchStatement = jest.fn(async (_token, accountId, _from, to) => {
      if (decodeURIComponent(accountId) !== clientInfo.accounts[0].id) {
        return [];
      }
      if (to >= boundary + 1000) {
        return page;
      }
      if (to >= boundary) {
        return [straggler];
      }
      return [];
    }) as SyncDeps['fetchStatement'];

    await runSync(deps);

    const windows = (deps.fetchStatement as jest.Mock).mock.calls.map(
      ([, , , to]: [unknown, unknown, unknown, number]) => to,
    );

    expect(windows).toContain(boundary);
    expect(transactionsStore.some((row) => row.externalId === 'acc-mono:straggler')).toBe(true);
  });

  it('terminates when a full capped page shares a single second', async () => {
    // A pathological case: 500 statement items all landing in the same
    // second. Naively re-querying with that second as the ceiling would
    // re-issue the identical request forever, since the response never
    // changes. The loop must still terminate.
    const toSeconds = 1_700_100_000;
    // boundary sits inside the default 31-day lookback window ending at toSeconds.
    const boundary = 1_700_050_000;
    const page: MonobankStatementItem[] = Array.from({ length: 500 }, (_, index) => ({
      ...(statement[0] as MonobankStatementItem),
      id: `p-${index}`,
      time: boundary,
    }));

    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps } = makeInMemoryDeps(() => [], [connected]);
    deps.now = () => toSeconds * 1000;
    deps.fetchStatement = jest.fn(async (_token, accountId, _from, to) => {
      if (decodeURIComponent(accountId) !== clientInfo.accounts[0].id) {
        return [];
      }
      return to >= boundary ? page : [];
    }) as SyncDeps['fetchStatement'];

    await expect(runSync(deps)).resolves.toBeDefined();
  });

  it('throttles across accounts: one 60 s sleep between two cards', async () => {
    // Two cards, each returning a single (sub-cap) statement page, so each card
    // makes exactly one statement request.
    const singlePage = (): MonobankStatementItem[] => [statement[0] as MonobankStatementItem];
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, sleep } = makeInMemoryDeps(singlePage, [connected]);

    await runSync(deps);

    // 3 requests total: client-info, card A's statement, card B's statement.
    // Two gaps between them, both throttled by the one per-token gate.
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([60_000, 60_000]);
  });

  it('routes fetchClientInfo through the same gate', async () => {
    const singlePage = (): MonobankStatementItem[] => [statement[0] as MonobankStatementItem];
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, sleep } = makeInMemoryDeps(singlePage, [connected]);
    // One card only, so the single statement request is the ONLY request that
    // can follow client-info — a sleep here can only be the client-info gap.
    deps.fetchClientInfo = async () => ({ accounts: [clientInfo.accounts[0] as MonobankAccount] });

    await runSync(deps);

    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('persists the queried window ceiling, not the clock at loop end', async () => {
    const singlePage = (): MonobankStatementItem[] => [statement[0] as MonobankStatementItem];
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps } = makeInMemoryDeps(singlePage, [connected]);
    deps.fetchClientInfo = async () => ({ accounts: [clientInfo.accounts[0] as MonobankAccount] });

    // Every `now()` read advances 2 minutes, modelling the throttle sleeps
    // between the window ceiling being captured and the loop finishing.
    let current = 1_700_000_000_000;
    deps.now = () => {
      const value = current;
      current += 120_000;
      return value;
    };

    const fetchStatement = jest.fn(deps.fetchStatement as SyncDeps['fetchStatement']);
    deps.fetchStatement = fetchStatement;
    const setLastSyncAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    deps.syncStateRepo.setLastSyncAt = setLastSyncAt;

    await runSync(deps);

    const [, persisted] = setLastSyncAt.mock.calls.at(-1) ?? [];
    const [, , , statementTo] = fetchStatement.mock.calls.at(-1) ?? [];

    // The cursor must be the same instant the statement window closed at, not
    // whatever the clock reads after the throttle sleeps that follow it.
    expect(persisted).toBe((statementTo as number) * 1000);
  });

  // Phase 1: the Monobank cursor is per-connection in `sync_state`, keyed by the
  // resolved account id — the row is ensured to exist, read, and written all by
  // that id, so a second connection can never share or corrupt this one's cursor.
  it('ensures, reads, and writes the sync_state cursor keyed by the resolved account id', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps } = makeInMemoryDeps(onlyFirstAccount, [connected]);

    const ensure = jest.fn(async (_accountId: string): Promise<void> => undefined);
    const getQuery = jest.fn(deps.syncStateRepo.getQuery);
    const setLastSyncAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    deps.syncStateRepo.ensure = ensure;
    deps.syncStateRepo.getQuery = getQuery;
    deps.syncStateRepo.setLastSyncAt = setLastSyncAt;

    await runSync(deps);

    expect(ensure).toHaveBeenCalledWith('acc-mono');
    expect(getQuery).toHaveBeenCalledWith('acc-mono');
    expect(setLastSyncAt).toHaveBeenCalledWith('acc-mono', expect.any(Number));
  });

  // A targeted connect (a first-time Connect passes `targetAccountId`) keys the
  // cursor by that same target id, so the freshly-connected account gets its own
  // cursor row rather than writing into any other connection's.
  it('keys the sync_state cursor by the targetAccountId on a first-time connect', async () => {
    const target = bankAccount({ id: 'acc-1', institution: null });
    const { deps } = makeInMemoryDeps(onlyFirstAccount, [target]);
    deps.targetAccountId = 'acc-1';

    const ensure = jest.fn(async (_accountId: string): Promise<void> => undefined);
    deps.syncStateRepo.ensure = ensure;

    await runSync(deps);

    expect(ensure).toHaveBeenCalledWith('acc-1');
  });

  // The single-flight lock: while one `runSync` is in flight, a second trigger
  // (auto-sync on open, pull-to-refresh, the manual button) must JOIN the
  // running promise instead of starting a second concurrent run — two
  // concurrent runs on the same token collide into Monobank 429s.
  it('coalesces two concurrent triggers into one sync (single-flight lock)', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, transactionsStore } = makeInMemoryDeps(onlyFirstAccount, [connected]);

    // Hold client-info open until both triggers have fired, so the second call
    // arrives while the first is provably still running.
    let release!: () => void;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchClientInfo = jest.fn(async () => {
      await opened;
      return {
        accounts: clientInfo.accounts as MonobankAccount[],
        jars: clientInfo.jars as MonobankJar[],
      };
    });
    deps.fetchClientInfo = fetchClientInfo;

    const first = runSync(deps);
    const second = runSync(deps);
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    // Exactly one underlying sync ran, and both triggers observed its result.
    expect(fetchClientInfo).toHaveBeenCalledTimes(1);
    expect(firstResult).toBe(secondResult);
    expect(firstResult.importedTransactions).toBe(statement.length);
    // No duplicate import from the coalesced second trigger.
    expect(transactionsStore).toHaveLength(statement.length);
  });

  // Per-account single-flight (mirrors `inFlightBalanceSyncs` on the crypto side):
  // two triggers for DIFFERENT target accounts have distinct keys, distinct tokens
  // and distinct per-token rate-limit buckets, so they run concurrently and must
  // NOT coalesce into one run.
  it('runs two different target accounts concurrently without joining', async () => {
    const accountA = bankAccount({ id: 'acc-a', institution: 'monobank' });
    const accountB = bankAccount({ id: 'acc-b', institution: 'monobank' });
    const { deps } = makeInMemoryDeps(onlyFirstAccount, [accountA, accountB]);

    // Hold client-info open until both triggers have fired, so the second call
    // arrives while the first is provably still running.
    let release!: () => void;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchClientInfo = jest.fn(async () => {
      await opened;
      return {
        accounts: clientInfo.accounts as MonobankAccount[],
        jars: clientInfo.jars as MonobankJar[],
      };
    });
    deps.fetchClientInfo = fetchClientInfo;

    const first = runSync({ ...deps, targetAccountId: 'acc-a' });
    const second = runSync({ ...deps, targetAccountId: 'acc-b' });
    release();
    await Promise.all([first, second]);

    // Two independent runs → client-info fetched once PER account, not coalesced.
    expect(fetchClientInfo).toHaveBeenCalledTimes(2);
  });

  it('joins two concurrent triggers for the SAME target account', async () => {
    const accountA = bankAccount({ id: 'acc-a', institution: 'monobank' });
    const { deps } = makeInMemoryDeps(onlyFirstAccount, [accountA]);

    let release!: () => void;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchClientInfo = jest.fn(async () => {
      await opened;
      return {
        accounts: clientInfo.accounts as MonobankAccount[],
        jars: clientInfo.jars as MonobankJar[],
      };
    });
    deps.fetchClientInfo = fetchClientInfo;

    const first = runSync({ ...deps, targetAccountId: 'acc-a' });
    const second = runSync({ ...deps, targetAccountId: 'acc-a' });
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    // Same key → exactly one underlying run, both triggers observe its result.
    expect(fetchClientInfo).toHaveBeenCalledTimes(1);
    expect(firstResult).toBe(secondResult);
  });

  it('starts a fresh sync once the previous one has settled (lock releases)', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps } = makeInMemoryDeps(onlyFirstAccount, [connected]);
    const fetchClientInfo = jest.fn(async () => ({
      accounts: clientInfo.accounts as MonobankAccount[],
      jars: clientInfo.jars as MonobankJar[],
    }));
    deps.fetchClientInfo = fetchClientInfo;

    await runSync(deps);
    await runSync(deps);

    // Sequential (awaited) runs are NOT coalesced — the lock only guards
    // concurrency, so each completed run releases it for the next.
    expect(fetchClientInfo).toHaveBeenCalledTimes(2);
  });

  // Partial-progress persistence: when one card of a multi-card sync fails, the
  // cards that DID import must keep their data, the shared cursor must NOT
  // advance (so the failed card's window is re-covered next time), and the next
  // run must resume without re-importing what already landed.
  it('imports every card independently and does not advance the cursor on a partial failure', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const idA = clientInfo.accounts[0].id;
    const idB = clientInfo.accounts[1].id;
    const itemA: MonobankStatementItem = {
      ...(statement[0] as MonobankStatementItem),
      id: 'txn-A',
    };
    const itemB: MonobankStatementItem = {
      ...(statement[0] as MonobankStatementItem),
      id: 'txn-B',
    };

    const { deps, syncStateRow, transactionsStore } = makeInMemoryDeps(() => [], [connected]);

    let failA = true;
    deps.fetchStatement = async (_token, accountId) => {
      const id = decodeURIComponent(accountId);
      if (id === idA) {
        if (failA) {
          throw new Error('Monobank request failed: 500');
        }
        return [itemA];
      }
      if (id === idB) {
        return [itemB];
      }
      return [];
    };

    // The cursor starts null (a first sync) and `setLastSyncAt` writes it back
    // through this connection's sync_state row, so the second run reads what the
    // first persisted.
    const setLastSyncAt = jest.fn(async (_accountId: string, timestamp: number): Promise<void> => {
      syncStateRow.lastSyncAt = timestamp;
    });
    deps.syncStateRepo.setLastSyncAt = setLastSyncAt;

    // First run: the FIRST card fails, but the second card must still import —
    // the old fail-fast loop stopped every later card the moment one threw.
    await expect(runSync(deps)).rejects.toThrow();
    expect(transactionsStore.some((row) => row.externalId === 'acc-mono:txn-B')).toBe(true);
    // The cursor stays put so card A's window is re-fetched next time.
    expect(setLastSyncAt).not.toHaveBeenCalled();

    // Second run: card A recovers. Card B is re-fetched but its row already
    // exists, so it dedups to zero new — nothing is re-imported.
    failA = false;
    const second = await runSync(deps);

    expect(second.importedTransactions).toBe(1);
    expect(transactionsStore.filter((row) => row.externalId === 'acc-mono:txn-B')).toHaveLength(1);
    expect(transactionsStore.filter((row) => row.externalId === 'acc-mono:txn-A')).toHaveLength(1);
    expect(setLastSyncAt).toHaveBeenCalledTimes(1);
  });

  // The DISPLAY timestamp is decoupled from the statement cursor: a partial
  // failure that still imported at least one card's rows must move the "last
  // synced" display (so the user sees it landed) WITHOUT advancing the cursor
  // (so the failed card's window is re-covered next run). The crash-safe marker
  // (BUG A fix 1) is what prevents a stranded card from being silently skipped,
  // so stamping "last sync" on any success no longer reads falsely current.
  it('stamps the display timestamp but NOT the cursor on a partial failure that imported something', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const idA = clientInfo.accounts[0].id;
    const idB = clientInfo.accounts[1].id;
    const itemB: MonobankStatementItem = {
      ...(statement[0] as MonobankStatementItem),
      id: 'txn-B',
    };

    const { deps } = makeInMemoryDeps(() => [], [connected]);
    deps.fetchStatement = async (_token, accountId) => {
      const id = decodeURIComponent(accountId);
      if (id === idA) {
        throw new Error('Monobank request failed: 500');
      }
      return id === idB ? [itemB] : [];
    };

    const setLastSyncAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    const setLastSyncDisplayAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    deps.syncStateRepo.setLastSyncAt = setLastSyncAt;
    deps.syncStateRepo.setLastSyncDisplayAt = setLastSyncDisplayAt;
    deps.now = () => 1_700_000_000_000;

    await expect(runSync(deps)).rejects.toThrow();

    // The failed card leaves the cursor put, but card B imported, so the
    // display stamp still moves — to the injected `now`.
    expect(setLastSyncAt).not.toHaveBeenCalled();
    expect(setLastSyncDisplayAt).toHaveBeenCalledTimes(1);
    expect(setLastSyncDisplayAt).toHaveBeenCalledWith(expect.any(String), 1_700_000_000_000);
  });

  // A TOTAL failure (every card errored) never reached any statement, so it
  // must not stamp the display — there was no successful sync to announce.
  // This is the lower bound of the "≥1 card succeeded" gate: with every card
  // failing, `failures.length === accounts.length`, so the stamp is skipped.
  it('does not stamp the display timestamp on a total failure', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps } = makeInMemoryDeps(() => [], [connected]);
    deps.fetchStatement = async () => {
      throw new Error('Monobank request failed: 500');
    };
    const setLastSyncDisplayAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    deps.syncStateRepo.setLastSyncDisplayAt = setLastSyncDisplayAt;

    await expect(runSync(deps)).rejects.toThrow();

    expect(setLastSyncDisplayAt).not.toHaveBeenCalled();
  });

  // A fully clean run that imported rows stamps BOTH the display timestamp and
  // the statement cursor.
  it('stamps both the display timestamp and the cursor on a clean run that imported rows', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps } = makeInMemoryDeps(onlyFirstAccount, [connected]);
    const setLastSyncAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    const setLastSyncDisplayAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    deps.syncStateRepo.setLastSyncAt = setLastSyncAt;
    deps.syncStateRepo.setLastSyncDisplayAt = setLastSyncDisplayAt;
    deps.now = () => 1_700_000_000_000;

    const result = await runSync(deps);

    expect(result.importedTransactions).toBe(statement.length);
    expect(setLastSyncAt).toHaveBeenCalledTimes(1);
    expect(setLastSyncDisplayAt).toHaveBeenCalledTimes(1);
    expect(setLastSyncDisplayAt).toHaveBeenCalledWith(expect.any(String), 1_700_000_000_000);
  });

  // A clean run that imported nothing (a re-sync with no new rows) is still a
  // real, successful sync: every card was reached, so the DISPLAY stamp moves
  // (the label means "Last sync", not "last import") AND the cursor advances
  // (the window was fully covered). This is the BUG1 fix — the display used to
  // freeze at the last IMPORT time and go stale on a no-new-rows re-sync.
  it('stamps the display timestamp on a clean run that imported nothing', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps } = makeInMemoryDeps(onlyFirstAccount, [connected]);
    const setLastSyncAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    const setLastSyncDisplayAt = jest.fn(
      async (_accountId: string, _timestamp: number): Promise<void> => undefined,
    );
    deps.syncStateRepo.setLastSyncAt = setLastSyncAt;
    deps.syncStateRepo.setLastSyncDisplayAt = setLastSyncDisplayAt;
    deps.now = () => 1_700_000_000_000;

    await runSync(deps); // first run imports the fixture rows
    setLastSyncDisplayAt.mockClear();
    setLastSyncAt.mockClear();
    const second = await runSync(deps); // second run re-fetches, imports nothing new

    expect(second.importedTransactions).toBe(0);
    expect(setLastSyncAt).toHaveBeenCalledTimes(1);
    expect(setLastSyncDisplayAt).toHaveBeenCalledTimes(1);
    expect(setLastSyncDisplayAt).toHaveBeenCalledWith(expect.any(String), 1_700_000_000_000);
  });

  // The reactive sync-in-progress signal: `runSync` lights it the instant it
  // acquires the single-flight lock and clears it when the run settles, so any
  // trigger drives the same global indicator.
  it('lights the sync-status signal while a run is in flight and clears it after', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps } = makeInMemoryDeps(onlyFirstAccount, [connected]);

    // Hold client-info open so the run is provably still in flight when we read
    // the signal.
    let release!: () => void;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    deps.fetchClientInfo = async () => {
      await opened;
      return {
        accounts: clientInfo.accounts as MonobankAccount[],
        jars: clientInfo.jars as MonobankJar[],
      };
    };

    expect(isSyncingSnapshot()).toBe(false);
    const run = runSync(deps);
    expect(isSyncingSnapshot()).toBe(true);
    release();
    await run;
    expect(isSyncingSnapshot()).toBe(false);
  });

  it('clears the sync-status signal even when the run fails', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps } = makeInMemoryDeps(onlyFirstAccount, [connected]);
    deps.fetchClientInfo = jest.fn(() => Promise.reject(new Error('401')));

    await expect(runSync(deps)).rejects.toThrow('401');

    expect(isSyncingSnapshot()).toBe(false);
  });

  // R7 (reverting the R6-3 fast/background split): the signal that drives the
  // native spinner tracks the WHOLE run, not just the fast phase. It stays ON
  // across the gated per-card statement loop — at the FIRST gated fetch and
  // after the LAST card — and clears ONLY once `runSync`'s returned promise
  // settles (the `release` callback), so the spinner cannot end while the
  // 60s-gated statement fetches (and the "Last sync" stamp written at the end)
  // are still pending.
  it('keeps the sync-status signal ON across the statement loop, clearing only when the run settles', async () => {
    // Two cards so the loop genuinely spans more than one card: assert the
    // signal is still ON at the first gated fetch AND after the last card.
    const idA = clientInfo.accounts[0].id;
    const idB = clientInfo.accounts[1].id;
    const singlePage = (): MonobankStatementItem[] => [statement[0] as MonobankStatementItem];
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, holdingsStore } = makeInMemoryDeps(singlePage, [connected]);

    // The signal must already be ON while the fast-phase balances are upserted.
    let signalDuringUpsert: boolean | undefined;
    const baseUpsert = deps.holdingsRepo.upsertMonobankMany;
    deps.holdingsRepo.upsertMonobankMany = async (holdings) => {
      if (signalDuringUpsert === undefined) {
        signalDuringUpsert = isSyncingSnapshot();
      }
      return baseUpsert(holdings);
    };

    // Snapshot the signal at the FIRST gated statement fetch and at the LAST
    // card's fetch — both must be ON, proving the loop runs with the signal lit.
    let signalAtFirstFetch: boolean | undefined;
    let holdingsAtFirstFetch = 0;
    let signalAtLastCardFetch: boolean | undefined;
    const baseFetchStatement = deps.fetchStatement;
    deps.fetchStatement = async (token, accountId, fromSeconds, toSeconds, fetchImpl) => {
      const id = decodeURIComponent(accountId);
      if (signalAtFirstFetch === undefined) {
        signalAtFirstFetch = isSyncingSnapshot();
        holdingsAtFirstFetch = holdingsStore.length;
      }
      if (id === idB) {
        signalAtLastCardFetch = isSyncingSnapshot();
      }
      return baseFetchStatement(token, accountId, fromSeconds, toSeconds, fetchImpl);
    };

    expect(isSyncingSnapshot()).toBe(false);
    const run = runSync(deps);

    // The signal is lit synchronously the moment the run acquires the lock,
    // before any awaited network/DB work.
    expect(isSyncingSnapshot()).toBe(true);

    await run;

    // The fast phase genuinely ran with the signal lit...
    expect(signalDuringUpsert).toBe(true);
    // ...a gated statement fetch DID run with balances already persisted...
    expect(signalAtFirstFetch).toBeDefined();
    expect(holdingsAtFirstFetch).toBeGreaterThan(0);
    // ...the signal STAYED ON across the statement loop: at the first gated
    // fetch AND at the last card (card B), proving it never cleared early...
    expect(signalAtFirstFetch).toBe(true);
    expect(signalAtLastCardFetch).toBe(true);
    // ...and it cleared ONLY once the run settled (the `release` callback).
    expect(isSyncingSnapshot()).toBe(false);
    // Sanity: both cards' second account id was actually reached in the loop.
    expect(idB).not.toBe(idA);
  });

  // The fast-phase-done signal marks the "balances have landed" moment: it
  // fires the instant `upsertAllHoldings` commits the client-info balances,
  // BEFORE the per-card statement loop runs, and clears when the run settles.
  // The pull-to-refresh spinner ends on this signal, so it is decoupled from
  // the whole run.
  it('fires the fast-phase-done signal after balances commit and clears it when the run settles', async () => {
    const idB = clientInfo.accounts[1].id;
    const singlePage = (): MonobankStatementItem[] => [statement[0] as MonobankStatementItem];
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps } = makeInMemoryDeps(singlePage, [connected]);

    // At the upsert itself the balances are not yet committed, so the signal is
    // still OFF (it flips ON only after `upsertAllHoldings` returns).
    let fastPhaseDuringUpsert: boolean | undefined;
    const baseUpsert = deps.holdingsRepo.upsertMonobankMany;
    deps.holdingsRepo.upsertMonobankMany = async (holdings) => {
      if (fastPhaseDuringUpsert === undefined) {
        fastPhaseDuringUpsert = isFastPhaseDone();
      }
      return baseUpsert(holdings);
    };

    // At the FIRST gated statement fetch — which runs AFTER the fast phase — the
    // signal must already be ON: balances are committed, only the slow
    // transaction fetch remains.
    let fastPhaseAtFirstFetch: boolean | undefined;
    const baseFetchStatement = deps.fetchStatement;
    deps.fetchStatement = async (token, accountId, fromSeconds, toSeconds, fetchImpl) => {
      if (fastPhaseAtFirstFetch === undefined) {
        fastPhaseAtFirstFetch = isFastPhaseDone();
      }
      return baseFetchStatement(token, accountId, fromSeconds, toSeconds, fetchImpl);
    };

    expect(isFastPhaseDone()).toBe(false);
    await runSync(deps);

    // The upsert ran with the signal still OFF...
    expect(fastPhaseDuringUpsert).toBe(false);
    // ...the signal was ON by the first statement fetch (balances committed)...
    expect(fastPhaseAtFirstFetch).toBe(true);
    // ...and it cleared once the whole run settled.
    expect(isFastPhaseDone()).toBe(false);
    // Sanity: the second card exists, so the fetch loop genuinely ran.
    expect(idB).not.toBe(clientInfo.accounts[0].id);
  });

  // The per-run diagnostic: a single console.warn summarising the run's
  // fetch/skip/failure counts, so a dev reading a device log can tell whether
  // the balance-diff skip is engaging or a card is stuck in full-fetch mode.
  // BUG C (fan-out coalescing): the fast-phase balance upsert must be ONE
  // batched write, so op-sqlite fires the reactive `holdings` callback once for
  // the whole fast phase — not once per card. A per-card write loop fanned out
  // N+M reactive fires in a tight burst at sync start, each re-running Home's
  // O(n) render and starving the JS thread (the laggy pull spinner). `write()`
  // flushes reactive queries once per call, so ONE dep call == ONE fire.
  it('upserts every card and jar in ONE batched write, not once per card', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps } = makeInMemoryDeps(onlyFirstAccount, [connected]);
    const upsertHoldings = jest.fn(
      deps.holdingsRepo.upsertMonobankMany as SyncDeps['holdingsRepo']['upsertMonobankMany'],
    );
    deps.holdingsRepo.upsertMonobankMany = upsertHoldings;

    await runSync(deps);

    // A single batched call carries all three holdings (2 cards + 1 jar from the
    // fixture), so the reactive callback fires once rather than three times.
    expect(upsertHoldings).toHaveBeenCalledTimes(1);
    expect(upsertHoldings.mock.calls[0][0]).toHaveLength(3);
  });

  it('logs a one-line diagnostic summary once per run with the expected keys', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps } = makeInMemoryDeps(onlyFirstAccount, [connected]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Snapshot the captured calls BEFORE restoring the spy — `mockRestore` also
    // resets `mock.calls`, so reading them afterwards would always see [].
    let doneCalls: unknown[][];
    try {
      await runSync(deps);
      doneCalls = warn.mock.calls.filter(([message]) => message === '[monobank sync] done');
    } finally {
      warn.mockRestore();
    }

    expect(doneCalls).toHaveLength(1);
    expect(doneCalls[0][1]).toEqual(
      expect.objectContaining({
        isFullFetch: expect.any(Boolean),
        cards: expect.any(Number),
        fetched: expect.any(Number),
        skipped: expect.any(Number),
        failures: expect.any(Number),
        elapsedMs: expect.any(Number),
      }),
    );
  });

  // The balance-diff skip (round 4-D option (a)): a steady-state incremental
  // sync SKIPS a card whose /client-info balance is unchanged since the last
  // sync, cutting the number of gated statement fetches (N cards ⇒ ~N×60s under
  // the per-token rate limit). A card is fetched when its balance CHANGED, when
  // it carries an outstanding hold, on the first sync ever, or on the periodic
  // full-fetch safety net.
  describe('balance-diff skip', () => {
    const idA = clientInfo.accounts[0].id;
    const idB = clientInfo.accounts[1].id;
    const fetchedIds = (fetchStatement: jest.Mock): string[] =>
      fetchStatement.mock.calls.map(([, accountId]) => decodeURIComponent(accountId as string));

    it('skips an unchanged card and fetches a changed one on an incremental run', async () => {
      const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
      const { deps, syncStateRow } = makeInMemoryDeps(() => [], [connected]);

      // First sync populates each holding's stored balance at its client-info
      // value; it is a full fetch (no cursor yet).
      await runSync(deps);

      // Incremental run: a cursor exists and the last full fetch is recent, so
      // the balance-diff skip is live. Card A's balance is unchanged; card B's
      // moved, so only B must be fetched.
      syncStateRow.lastSyncAt = 1704326400000 - 1000;
      syncStateRow.lastFullSyncAt = 1704326400000 - 1000;
      deps.fetchClientInfo = async () => ({
        accounts: (clientInfo.accounts as MonobankAccount[]).map((account, index) =>
          index === 1 ? { ...account, balance: account.balance + 5000 } : { ...account },
        ),
        jars: clientInfo.jars as MonobankJar[],
      });
      const fetchStatement = jest.fn(async () => [] as MonobankStatementItem[]);
      deps.fetchStatement = fetchStatement as unknown as SyncDeps['fetchStatement'];

      await runSync(deps);

      expect(fetchedIds(fetchStatement)).not.toContain(idA);
      expect(fetchedIds(fetchStatement)).toContain(idB);
    });

    it('fetches every card and stamps the full-fetch marker on the first sync ever', async () => {
      const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
      const { deps } = makeInMemoryDeps(() => [], [connected]);
      deps.now = () => 1_700_000_000_000;
      const setLastFullSyncAt = jest.fn(
        async (_accountId: string, _timestamp: number): Promise<void> => undefined,
      );
      deps.syncStateRepo.setLastFullSyncAt = setLastFullSyncAt;
      const fetchStatement = jest.fn(async () => [] as MonobankStatementItem[]);
      deps.fetchStatement = fetchStatement as unknown as SyncDeps['fetchStatement'];

      // getLastSyncAt defaults to null → first sync → full fetch regardless of
      // balance.
      await runSync(deps);

      expect(fetchedIds(fetchStatement)).toEqual(expect.arrayContaining([idA, idB]));
      expect(setLastFullSyncAt).toHaveBeenCalledWith(expect.any(String), 1_700_000_000_000);
    });

    it('fetches an unchanged card that still carries an outstanding hold', async () => {
      const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
      const { deps, holdingsStore, syncStateRow } = makeInMemoryDeps(() => [], [connected]);

      await runSync(deps);
      const heldHoldingId = holdingsStore.find((holding) => monobankIdOf(holding.metadata) === idA)
        ?.id as string;

      // Incremental run, both balances unchanged, but card A's holding has an
      // outstanding hold — a hold→settled refresh does not move the balance, so
      // A must still be fetched while B (unchanged, no hold) is skipped.
      syncStateRow.lastSyncAt = 1704326400000 - 1000;
      syncStateRow.lastFullSyncAt = 1704326400000 - 1000;
      deps.transactionsRepo.holdingIdsWithHoldQuery = async () => [{ holdingId: heldHoldingId }];
      const fetchStatement = jest.fn(async () => [] as MonobankStatementItem[]);
      deps.fetchStatement = fetchStatement as unknown as SyncDeps['fetchStatement'];

      await runSync(deps);

      expect(fetchedIds(fetchStatement)).toContain(idA);
      expect(fetchedIds(fetchStatement)).not.toContain(idB);
    });

    it('fetches every card on the periodic full-fetch even when balances are unchanged', async () => {
      const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
      const { deps, syncStateRow } = makeInMemoryDeps(() => [], [connected]);
      deps.now = () => 1_700_000_000_000;

      await runSync(deps);

      // Incremental run with unchanged balances and no holds, but the last full
      // fetch is >24h old, so the safety net forces an all-cards fetch and
      // re-stamps the marker.
      syncStateRow.lastSyncAt = 1_700_000_000_000 - 1000;
      syncStateRow.lastFullSyncAt = 1_700_000_000_000 - (24 * 60 * 60 * 1000 + 1);
      const setLastFullSyncAt = jest.fn(
        async (_accountId: string, _timestamp: number): Promise<void> => undefined,
      );
      deps.syncStateRepo.setLastFullSyncAt = setLastFullSyncAt;
      const fetchStatement = jest.fn(async () => [] as MonobankStatementItem[]);
      deps.fetchStatement = fetchStatement as unknown as SyncDeps['fetchStatement'];

      await runSync(deps);

      expect(fetchedIds(fetchStatement)).toEqual(expect.arrayContaining([idA, idB]));
      expect(setLastFullSyncAt).toHaveBeenCalledWith(expect.any(String), 1_700_000_000_000);
    });

    // The recovery this whole safety net exists for: the incremental cursor
    // (`lastSyncAt`) advances on EVERY clean run — including runs that
    // balance-diff-skip a card — so by the time the periodic full fetch fires it
    // has drifted recent. Deriving the full fetch's from-window from that recent
    // cursor would only re-query the already-covered recent window and recover
    // nothing; the from-window must widen back to `lastFullSyncAt` so every
    // window skipped since the last full fetch (where a net-zero same-window pair
    // could hide) is actually re-queried. Asserts the concrete `fromSeconds`
    // argument, not merely WHICH ids are fetched.
    it('widens the periodic full fetch back to lastFullSyncAt, not the recent cursor', async () => {
      const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
      const { deps, syncStateRow } = makeInMemoryDeps(() => [], [connected]);
      deps.now = () => 1_700_000_000_000;

      // First sync populates each holding's stored balance (a full fetch, no
      // cursor yet).
      await runSync(deps);

      // A periodic full fetch with UNCHANGED balances: the last full fetch is
      // stale (>24h), so `shouldFullFetch` fires even though the incremental
      // cursor is recent. `lastFullSyncAt` sits ~2.3 days back — well past the
      // 24h interval, but inside one 31-day API window, so a single statement
      // request covers it.
      const lastFullSyncAt = 1_699_800_000_000;
      const recentCursor = 1_699_999_000_000;
      syncStateRow.lastSyncAt = recentCursor;
      syncStateRow.lastFullSyncAt = lastFullSyncAt;
      const fetchStatement = jest.fn(async () => [] as MonobankStatementItem[]);
      deps.fetchStatement = fetchStatement as unknown as SyncDeps['fetchStatement'];

      await runSync(deps);

      // Card A (unchanged, would be skipped incrementally) is fetched by the full
      // fetch from the WIDE `lastFullSyncAt`-derived window (1_699_800_000 s), NOT
      // the recent cursor's window (1_699_999_000 s).
      const callForA = (fetchStatement as jest.Mock).mock.calls.find(
        ([, accountId]) => decodeURIComponent(accountId as string) === idA,
      );
      const fromSecondsForA = callForA?.[2] as number;
      expect(fromSecondsForA).toBe(Math.floor(lastFullSyncAt / 1000));
      expect(fromSecondsForA).not.toBe(Math.floor(recentCursor / 1000));
    });

    // R6-1: a full fetch where one card fails now GRADUATES `lastFullSyncAt`
    // even though it re-throws — the fix for the "permanent full-fetch" trap
    // where a partial failure never advanced the marker, so once it aged past
    // the 24h interval every sync became a slow N×60s full fetch and the
    // balance-diff skip never engaged again. The failed card is persisted for a
    // forced retry next run; the statement cursor still stays put so that retry
    // re-covers the failed window (dedup keeps it idempotent).
    it('graduates the full-fetch marker on a partial failure and persists the failed card, without advancing the cursor', async () => {
      const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
      const { deps } = makeInMemoryDeps(() => [], [connected]);
      deps.now = () => 1_700_000_000_000;
      // First sync ever → full fetch. Card A throws, so the run partially fails.
      deps.fetchStatement = async (_token, accountId) => {
        if (decodeURIComponent(accountId) === idA) {
          throw new Error('Monobank request failed: 500');
        }
        return [];
      };
      const setLastSyncAt = jest.fn(
        async (_accountId: string, _timestamp: number): Promise<void> => undefined,
      );
      const setLastFullSyncAt = jest.fn(
        async (_accountId: string, _timestamp: number): Promise<void> => undefined,
      );
      const setFailedSyncIds = jest.fn(
        async (_accountId: string, _ids: string[] | null): Promise<void> => undefined,
      );
      deps.syncStateRepo.setLastSyncAt = setLastSyncAt;
      deps.syncStateRepo.setLastFullSyncAt = setLastFullSyncAt;
      deps.syncStateRepo.setFailedSyncMonobankIds = setFailedSyncIds;

      await expect(runSync(deps)).rejects.toThrow();

      // The marker graduates on the partial failure; the failed card is stored
      // for a forced retry; the cursor stays put.
      expect(setLastFullSyncAt).toHaveBeenCalledWith(expect.any(String), 1_700_000_000_000);
      expect(setFailedSyncIds).toHaveBeenCalledWith(expect.any(String), [idA]);
      expect(setLastSyncAt).not.toHaveBeenCalled();
    });

    it('force-fetches a previously-failed card even when its balance is unchanged, still skipping a different unchanged card', async () => {
      const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
      const { deps, syncStateRow } = makeInMemoryDeps(() => [], [connected]);

      // First sync populates each holding's stored balance (a full fetch).
      await runSync(deps);

      // Incremental run: cursor + recent full fetch, both balances UNCHANGED.
      // Card A is in the force-retry set, so it is fetched despite the unchanged
      // balance; card B (unchanged, not failed, no hold) is skipped.
      syncStateRow.lastSyncAt = 1704326400000 - 1000;
      syncStateRow.lastFullSyncAt = 1704326400000 - 1000;
      syncStateRow.failedSyncMonobankIds = [idA];
      const fetchStatement = jest.fn(async () => [] as MonobankStatementItem[]);
      deps.fetchStatement = fetchStatement as unknown as SyncDeps['fetchStatement'];

      await runSync(deps);

      expect(fetchedIds(fetchStatement)).toContain(idA);
      expect(fetchedIds(fetchStatement)).not.toContain(idB);
    });

    it('removes a previously-failed card from the set once it syncs clean', async () => {
      const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
      const { deps, syncStateRow } = makeInMemoryDeps(() => [], [connected]);
      await runSync(deps);

      syncStateRow.lastSyncAt = 1704326400000 - 1000;
      syncStateRow.lastFullSyncAt = 1704326400000 - 1000;
      syncStateRow.failedSyncMonobankIds = [idA];
      const setFailedSyncIds = jest.fn(
        async (_accountId: string, _ids: string[] | null): Promise<void> => undefined,
      );
      deps.syncStateRepo.setFailedSyncMonobankIds = setFailedSyncIds;
      deps.fetchStatement = jest.fn(
        async () => [] as MonobankStatementItem[],
      ) as unknown as SyncDeps['fetchStatement'];

      await runSync(deps);

      // idA is force-fetched, succeeds, and is dropped — the set is now empty,
      // so it is persisted as NULL (the sync maps an empty set to null before the
      // repo call — see `failedIdsToPersist` in `sync.ts`).
      expect(setFailedSyncIds).toHaveBeenCalledWith(expect.any(String), null);
    });

    it('prunes a stale failed id that is no longer present in client-info', async () => {
      const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
      const { deps, syncStateRow } = makeInMemoryDeps(() => [], [connected]);
      await runSync(deps);

      syncStateRow.lastSyncAt = 1704326400000 - 1000;
      syncStateRow.lastFullSyncAt = 1704326400000 - 1000;
      // 'ghost-card' failed on a prior run but no longer appears in client-info
      // (the user disconnected it): it must be dropped, not force-fetched forever.
      syncStateRow.failedSyncMonobankIds = ['ghost-card'];
      const setFailedSyncIds = jest.fn(
        async (_accountId: string, _ids: string[] | null): Promise<void> => undefined,
      );
      deps.syncStateRepo.setFailedSyncMonobankIds = setFailedSyncIds;
      deps.fetchStatement = jest.fn(
        async () => [] as MonobankStatementItem[],
      ) as unknown as SyncDeps['fetchStatement'];

      await runSync(deps);

      // The pruned set is empty, which the sync persists as NULL (see
      // `failedIdsToPersist` in `sync.ts`).
      expect(setFailedSyncIds).toHaveBeenCalledWith(expect.any(String), null);
    });

    it('refreshes the display timestamp and imports zero when every card is skipped', async () => {
      const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
      const { deps, syncStateRow } = makeInMemoryDeps(() => [], [connected]);

      await runSync(deps);

      syncStateRow.lastSyncAt = 1704326400000 - 1000;
      syncStateRow.lastFullSyncAt = 1704326400000 - 1000;
      const setLastSyncDisplayAt = jest.fn(
        async (_accountId: string, _timestamp: number): Promise<void> => undefined,
      );
      const setLastSyncAt = jest.fn(
        async (_accountId: string, _timestamp: number): Promise<void> => undefined,
      );
      deps.syncStateRepo.setLastSyncDisplayAt = setLastSyncDisplayAt;
      deps.syncStateRepo.setLastSyncAt = setLastSyncAt;
      const fetchStatement = jest.fn(async () => [] as MonobankStatementItem[]);
      deps.fetchStatement = fetchStatement as unknown as SyncDeps['fetchStatement'];

      const result = await runSync(deps);

      // No card fetched, nothing imported, but the run reached Monobank cleanly:
      // the display stamp still refreshes and the cursor still advances.
      expect(fetchStatement).not.toHaveBeenCalled();
      expect(result.importedTransactions).toBe(0);
      expect(setLastSyncDisplayAt).toHaveBeenCalledTimes(1);
      expect(setLastSyncAt).toHaveBeenCalledTimes(1);
    });

    // BUG A fix 1 — the crash-safe marker. `upsertHoldings` commits each card's
    // DISPLAY balance (`balanceMinorUnits`) up front, BEFORE the per-card
    // statement loop. If a run advances a card's balance but is interrupted (app
    // background/kill) before importing that card's statements — and before any
    // failed-set record is written — the display balance already equals
    // /client-info, so the OLD skip (which compared the display balance) skipped
    // the card on every later run and its transactions never imported until the
    // 24h full fetch. The skip now compares `syncedBalanceMinorUnits`, which
    // advances ONLY after a card's statements commit, so such a card is
    // re-fetched next run even with no failed-set record and no outstanding hold
    // — the marker is the ONLY thing that can force this re-fetch here.
    it('re-fetches a card whose display balance advanced but whose statements never imported', async () => {
      const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
      const { deps, holdingsStore, syncStateRow } = makeInMemoryDeps(() => [], [connected]);

      // A clean full fetch populates each holding's marker at its client-info
      // balance (each card is fetched, so `setSyncedBalance` runs for both).
      await runSync(deps);

      const holdingA = holdingsStore.find((holding) => monobankIdOf(holding.metadata) === idA);
      const holdingB = holdingsStore.find((holding) => monobankIdOf(holding.metadata) === idB);
      if (!holdingA || !holdingB) {
        throw new Error('expected both card holdings to exist after the first sync');
      }

      // Model the interrupted run: card A's DISPLAY balance advanced (as
      // `upsertHoldings` would have committed it up front) but its statements
      // never imported, so its marker stays behind. No failed-set record and no
      // hold — only the marker/display-balance mismatch can force a re-fetch.
      const advanced = (holdingA.syncedBalanceMinorUnits ?? 0) + 5000;
      holdingA.balanceMinorUnits = advanced;

      syncStateRow.lastSyncAt = 1704326400000 - 1000;
      syncStateRow.lastFullSyncAt = 1704326400000 - 1000;
      syncStateRow.failedSyncMonobankIds = [];
      deps.fetchClientInfo = async () => ({
        accounts: (clientInfo.accounts as MonobankAccount[]).map((account) =>
          account.id === idA ? { ...account, balance: advanced } : { ...account },
        ),
        jars: clientInfo.jars as MonobankJar[],
      });
      const fetchStatement = jest.fn(async () => [] as MonobankStatementItem[]);
      deps.fetchStatement = fetchStatement as unknown as SyncDeps['fetchStatement'];

      await runSync(deps);

      // Card A is re-fetched (its marker never reached the advanced balance);
      // card B, genuinely unchanged and fully imported, is still skipped.
      expect(fetchedIds(fetchStatement)).toContain(idA);
      expect(fetchedIds(fetchStatement)).not.toContain(idB);
    });
  });

  // ITEM 2: the determinate progress signal that drives the transactions-list
  // progress bar. The bar is WEIGHTED BY REAL WORK: `workTotal` is the sum of
  // each syncing holding's work units — a card weighs its statement-window count,
  // a changed jar one unit — and `workCompleted` rises as work is DONE, starting
  // at 0 with NO pre-filled baseline. `total`/`completed` count HOLDINGS for the
  // label only. The signal resets to zero when the run settles so the bar hides.
  it('publishes work-weighted progress: workTotal sums per-card windows, starts at 0, cleared at the end', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps } = makeInMemoryDeps(() => [], [connected]);

    // A first sync fetches both cards over one 31-day window each (1 unit each)
    // and the jar is new, so it is a changed holding (1 unit). Work total = 3,
    // holdings total = 3 (2 cards + 1 jar). The jar commits at the fast phase, so
    // work already reads 1 by the time the first card is fetched.
    const samples: Array<{
      completed: number;
      total: number;
      workCompleted: number;
      workTotal: number;
    }> = [];
    const base = deps.fetchStatement as SyncDeps['fetchStatement'];
    deps.fetchStatement = async (token, accountId, from, to, fetchImpl) => {
      samples.push({ ...getProgressSnapshot() });
      return base(token, accountId, from, to, fetchImpl);
    };

    await runSync(deps);

    // Sampled at the START of each card's fetch: the jar (1 unit) is already
    // committed, then card A commits, so the second sample reads one more unit.
    expect(samples).toEqual([
      { completed: 1, total: 3, workCompleted: 1, workTotal: 3 },
      { completed: 2, total: 3, workCompleted: 2, workTotal: 3 },
    ]);
    // Cleared once the run settles, so the bar hides.
    expect(getProgressSnapshot()).toEqual({
      completed: 0,
      total: 0,
      workCompleted: 0,
      workTotal: 0,
    });
  });

  // The weighting: a card whose statement span is many 31-day windows weighs
  // proportionally MORE than the holding count. A full fetch over ~90 days is 3
  // windows per card, so 2 cards weigh 6 work units even though the label counts
  // only 2 holdings.
  it('weights workTotal by each card statement-window count, not by holding count', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, syncStateRow } = makeInMemoryDeps(() => [], [connected]);

    // First run stores the card balances and markers; the jar lands unchanged
    // afterward, so the second run's only work is the two cards.
    await runSync(deps);

    // Force a wide FULL fetch: a full-fetch cursor 90 days back makes each card
    // page 3 windows. The jar balance is unchanged, so it adds no work.
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    syncStateRow.lastSyncAt = 1704326400000 - 1000;
    syncStateRow.lastFullSyncAt = 1704326400000 - ninetyDaysMs;

    let workTotalDuringRun = 0;
    let holdingsTotalDuringRun = 0;
    const base = deps.fetchStatement as SyncDeps['fetchStatement'];
    deps.fetchStatement = async (token, accountId, from, to, fetchImpl) => {
      const snap = getProgressSnapshot();
      workTotalDuringRun = snap.workTotal;
      holdingsTotalDuringRun = snap.total;
      return base(token, accountId, from, to, fetchImpl);
    };

    await runSync(deps);

    // 2 cards × 3 windows = 6 work units, but only 2 holdings.
    expect(workTotalDuringRun).toBe(6);
    expect(holdingsTotalDuringRun).toBe(2);
    expect(getProgressSnapshot().workTotal).toBe(0);
  });

  // A run with NO card to fetch (every card balance-diff-skipped) and no changed
  // jar does zero work, so the bar never appears.
  it('publishes no progress when no holding does any work', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, syncStateRow } = makeInMemoryDeps(() => [], [connected]);

    const emissions: Array<{ workTotal: number; total: number }> = [];
    const unsubscribe = subscribeProgress(() => {
      const snap = getProgressSnapshot();
      emissions.push({ workTotal: snap.workTotal, total: snap.total });
    });

    // Seed the run so nothing changed: recent cursors (no full fetch) and each
    // card's marker already equal to its /client-info balance.
    syncStateRow.lastSyncAt = 1704326400000 - 1000;
    syncStateRow.lastFullSyncAt = 1704326400000 - 1000;
    // First sync populates markers; a second identical run then skips every card.
    await runSync(deps);
    emissions.length = 0;

    await runSync(deps);
    unsubscribe();

    // No work was ever published — every emission stays at the reset value.
    expect(emissions.every((sample) => sample.workTotal === 0 && sample.total === 0)).toBe(true);
  });

  // A jar has no statements, so it is syncable ONLY when its balance actually
  // MOVES since the last stored value (a new jar counts as changed). A changed
  // jar weighs ONE work unit and completes at the fast phase — its balance lands
  // in the up-front upsert — even when every card is balance-diff-skipped.
  it('counts a CHANGED jar as one work unit, completed at the fast phase, with every card skipped', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, syncStateRow } = makeInMemoryDeps(() => [], [connected]);
    // Recent cursors so this is never a full fetch — the card skip can engage.
    syncStateRow.lastSyncAt = 1704326400000 - 1000;
    syncStateRow.lastFullSyncAt = 1704326400000 - 1000;

    // A mutable jar balance: the second run sees a CHANGED jar while the two
    // cards stay unchanged (and so balance-diff-skipped).
    let jarBalance = 5_000_000;
    deps.fetchClientInfo = async () => ({
      accounts: clientInfo.accounts as MonobankAccount[],
      jars: [{ ...(clientInfo.jars[0] as MonobankJar), balance: jarBalance }],
    });

    // First run establishes the card markers and stores the jar at 5,000,000.
    await runSync(deps);

    // The jar balance moves; the cards do not.
    jarBalance = 6_000_000;

    const emissions: Array<{
      completed: number;
      total: number;
      workCompleted: number;
      workTotal: number;
    }> = [];
    const unsubscribe = subscribeProgress(() => emissions.push({ ...getProgressSnapshot() }));

    await runSync(deps);
    unsubscribe();

    // Every card is skipped, so the ONLY work is the changed jar: 1 work unit and
    // 1 holding. No card contributes work, so workTotal never exceeds 1.
    const nonZero = emissions.filter((sample) => sample.workTotal > 0);
    expect(nonZero.every((sample) => sample.workTotal === 1 && sample.total === 1)).toBe(true);
    // The jar reaches full (1/1 work, 1/1 holding) at the fast phase.
    expect(nonZero.at(-1)).toEqual({ completed: 1, total: 1, workCompleted: 1, workTotal: 1 });
    // Then the run settles and the bar clears.
    expect(emissions.at(-1)).toEqual({
      completed: 0,
      total: 0,
      workCompleted: 0,
      workTotal: 0,
    });
  });

  // ITEM 3: a card that changed on a monthly cadence can sit LAST in client-info
  // order. The old serial 60s-gated loop fetched cards in fixed client-info
  // order and derived one shared from-window, so a just-changed last card was
  // starved by an interruption and, even when fetched, missed a transaction
  // older than the incremental cursor. FIX A orders the queue changed-first;
  // FIX C widens the from-window per card for a behind/NULL marker.
  describe('statement queue priority and per-card window (ITEM 3)', () => {
    const idA = clientInfo.accounts[0].id;
    const idB = clientInfo.accounts[1].id;
    const fetchedIds = (fetchStatement: jest.Mock): string[] =>
      fetchStatement.mock.calls.map(([, accountId]) => decodeURIComponent(accountId as string));

    // FIX A. The priority signal is the PRIOR STORED balance (captured before the
    // up-front upsert), not the crash-safe marker — so this discriminates even on
    // the NULL-marker recovery build. idB is the second (last) card in the
    // fixture; a change on it must move it to the FIRST 60s slot.
    it('fetches a changed card first even when it is ordered last in client-info', async () => {
      const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
      const { deps, syncStateRow } = makeInMemoryDeps(() => [], [connected]);

      // First sync stores each card's balance and the full-fetch marker.
      await runSync(deps);

      // A periodic full fetch (both cards fetched) where only card B's balance
      // moved since the last sync. Client-info order is [A, B]; changed-first
      // ordering must fetch B before A.
      syncStateRow.lastSyncAt = 1704326400000 - 1000;
      syncStateRow.lastFullSyncAt = 1704326400000 - (24 * 60 * 60 * 1000 + 1);
      deps.fetchClientInfo = async () => ({
        accounts: (clientInfo.accounts as MonobankAccount[]).map((account) =>
          account.id === idB ? { ...account, balance: account.balance + 5000 } : { ...account },
        ),
        jars: clientInfo.jars as MonobankJar[],
      });
      const fetchStatement = jest.fn(async () => [] as MonobankStatementItem[]);
      deps.fetchStatement = fetchStatement as unknown as SyncDeps['fetchStatement'];

      await runSync(deps);

      const order = fetchedIds(fetchStatement);
      expect(order).toContain(idA);
      expect(order.indexOf(idB)).toBeLessThan(order.indexOf(idA));
    });

    // FIX C. On an INCREMENTAL run (no periodic full fetch), a card whose marker
    // is behind its client-info balance fetches the WIDE lastFullSyncAt-derived
    // window; a normally-in-sync card (fetched here because it holds an
    // outstanding authorization) keeps the NARROW incremental lastSyncAt cursor.
    it('fetches a wide window for a behind-marker card and the incremental cursor for an in-sync card', async () => {
      const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
      const { deps, holdingsStore, syncStateRow } = makeInMemoryDeps(() => [], [connected]);

      await runSync(deps);

      const heldHoldingId = holdingsStore.find((holding) => monobankIdOf(holding.metadata) === idA)
        ?.id as string;
      // lastFullSyncAt sits inside the 24h interval (so this is NOT a periodic
      // full fetch) but strictly before the near-now incremental cursor, so the
      // behind-marker card's window reaches further back than the in-sync card's.
      const lastSyncAt = 1704326400000 - 1000;
      const lastFullSyncAt = 1704326400000 - 2 * 60 * 60 * 1000;
      syncStateRow.lastSyncAt = lastSyncAt;
      syncStateRow.lastFullSyncAt = lastFullSyncAt;
      deps.transactionsRepo.holdingIdsWithHoldQuery = async () => [{ holdingId: heldHoldingId }];
      deps.fetchClientInfo = async () => ({
        accounts: (clientInfo.accounts as MonobankAccount[]).map((account) =>
          account.id === idB ? { ...account, balance: account.balance + 5000 } : { ...account },
        ),
        jars: clientInfo.jars as MonobankJar[],
      });
      const fetchStatement = jest.fn(async () => [] as MonobankStatementItem[]);
      deps.fetchStatement = fetchStatement as unknown as SyncDeps['fetchStatement'];

      await runSync(deps);

      const fromFor = (id: string): number | undefined => {
        const call = (fetchStatement as jest.Mock).mock.calls.find(
          ([, accountId]) => decodeURIComponent(accountId as string) === id,
        );
        return call?.[2] as number | undefined;
      };
      expect(fromFor(idA)).toBe(Math.floor(lastSyncAt / 1000));
      expect(fromFor(idB)).toBe(Math.floor(lastFullSyncAt / 1000));
      // The behind-marker card reaches strictly further back, re-covering a
      // transaction older than the incremental cursor.
      expect(fromFor(idB)).toBeLessThan(fromFor(idA) as number);
    });

    // FIX A durability: the changed card is fetched first and its statements
    // commit in their own transaction, so a failure/interruption on a LATER card
    // never loses the changed card's just-imported transactions.
    it('imports the changed card first, durable even when a later card fails', async () => {
      const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
      const { deps, syncStateRow, transactionsStore } = makeInMemoryDeps(() => [], [connected]);

      await runSync(deps);

      const bToday: MonobankStatementItem = {
        ...(statement[0] as MonobankStatementItem),
        id: 'b-today',
        time: 1704300000,
      };
      // Periodic full fetch: both cards fetched. Only B changed, so B is fetched
      // first; the later card A then fails, modelling a run cut short after the
      // first (changed) card.
      syncStateRow.lastSyncAt = 1704326400000 - 1000;
      syncStateRow.lastFullSyncAt = 1704326400000 - (24 * 60 * 60 * 1000 + 1);
      deps.fetchClientInfo = async () => ({
        accounts: (clientInfo.accounts as MonobankAccount[]).map((account) =>
          account.id === idB ? { ...account, balance: account.balance + 5000 } : { ...account },
        ),
        jars: clientInfo.jars as MonobankJar[],
      });
      const fetchStatement = jest.fn(async (_token: string, accountId: string) => {
        const id = decodeURIComponent(accountId);
        if (id === idA) {
          throw new Error('interrupted after the first card');
        }
        if (id === idB) {
          return [bToday];
        }
        return [];
      });
      deps.fetchStatement = fetchStatement as unknown as SyncDeps['fetchStatement'];

      await expect(runSync(deps)).rejects.toThrow('interrupted after the first card');

      const order = fetchedIds(fetchStatement);
      expect(order[0]).toBe(idB);
      expect(transactionsStore.some((row) => row.externalId === 'acc-mono:b-today')).toBe(true);
    });
  });
});

describe('runSync stale-holding reconciliation', () => {
  const noStatements = (): MonobankStatementItem[] => [];

  // A previously-synced Monobank holding whose card/jar the current snapshot no
  // longer returns. Its `monobankId` is set (so it is a sync-owned row) and it is
  // still open (`closedAt: null`).
  const staleHolding = (over: Partial<HoldingRow> = {}): HoldingRow => ({
    id: 'stale-1',
    accountId: 'acc-mono',
    name: 'Closed card',
    type: 'card',
    currency: 'UAH',
    balanceMinorUnits: 5_000,
    metadata: { monobankId: 'gone-card' },
    icon: null,
    color: null,
    sortOrder: 0,
    closedAt: null,
    createdAt: 0,
    syncedBalanceMinorUnits: null,
    ...over,
  });

  it('closes a previously-synced holding a complete full-sync snapshot no longer returns', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, holdingsStore } = makeInMemoryDeps(noStatements, [connected]);
    holdingsStore.push(staleHolding({ id: 'stale-1', accountId: 'acc-mono' }));

    await runSync(deps);

    // The gone card is absent from the snapshot, so it is closed; the snapshot's
    // own cards/jar stay open.
    expect(deps.holdingsRepo.closeMany).toHaveBeenCalledWith(['stale-1']);
    expect(holdingsStore.find((holding) => holding.id === 'stale-1')?.closedAt).not.toBeNull();
  });

  it('does not close on a successful-but-empty snapshot (guard: non-empty)', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, holdingsStore } = makeInMemoryDeps(noStatements, [connected]);
    deps.fetchClientInfo = async () => ({ accounts: [], jars: [] });
    holdingsStore.push(staleHolding({ id: 'stale-1', accountId: 'acc-mono' }));

    await runSync(deps);

    expect(deps.holdingsRepo.closeMany).not.toHaveBeenCalled();
    expect(holdingsStore.find((holding) => holding.id === 'stale-1')?.closedAt).toBeNull();
  });

  it('does not close on a partial-failure full sync (guard: no per-card failure)', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, holdingsStore } = makeInMemoryDeps(
      () => statement as MonobankStatementItem[],
      [connected],
    );
    // Every card's statement fetch fails, so the run throws AFTER the per-card
    // loop and never reaches the close step.
    deps.fetchStatement = async () => {
      throw new Error('429');
    };
    holdingsStore.push(staleHolding({ id: 'stale-1', accountId: 'acc-mono' }));

    await expect(runSync(deps)).rejects.toThrow('429');

    expect(deps.holdingsRepo.closeMany).not.toHaveBeenCalled();
    expect(holdingsStore.find((holding) => holding.id === 'stale-1')?.closedAt).toBeNull();
  });

  it('does not close a holding whose card is present but unrepresentable-currency (skipped from upsert)', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps, holdingsStore } = makeInMemoryDeps(noStatements, [connected]);
    // A card in the snapshot whose currency cannot be mapped: it is skipped from
    // upsert but is STILL present, so its holding must not be closed.
    const unrepresentable = {
      ...(clientInfo.accounts[0] as MonobankAccount),
      id: 'weird-cur',
      currencyCode: 999,
    };
    deps.fetchClientInfo = async () => ({
      accounts: [...(clientInfo.accounts as MonobankAccount[]), unrepresentable],
      jars: clientInfo.jars as MonobankJar[],
    });
    holdingsStore.push(
      staleHolding({
        id: 'weird-holding',
        accountId: 'acc-mono',
        metadata: { monobankId: 'weird-cur' },
      }),
    );

    await runSync(deps);

    expect(deps.holdingsRepo.closeMany).not.toHaveBeenCalled();
  });
});
