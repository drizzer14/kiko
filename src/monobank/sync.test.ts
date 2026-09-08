// op-sqlite's open() calls a native module unavailable under Jest, and
// sync.ts imports the repos which open the connection at load. A minimal
// stub lets the module graph load; runSync's data access is fully injected
// through SyncDeps, so the real repos are never exercised here.
import type { AccountRow, HoldingRow, TransactionRow } from '../db/schema';
import { i18n } from '../i18n';

import clientInfo from './__fixtures__/client-info.json';
import statement from './__fixtures__/statement.json';
import type { MonobankAccount, MonobankJar, MonobankStatementItem } from './monobank.types';
import { mapAccountToHolding, mapStatementItem, runSync, type SyncDeps } from './sync';
import { getSnapshot as isSyncingSnapshot } from './sync-status';

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
    // The persisted value is the `categories.key` slug, never a display title.
    expect(transaction.category).toBe('groceries');
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

  // `hold: true` marks a PENDING authorization whose settled amount can still
  // change, so the stored row has to carry the flag for a reader to tell a
  // provisional amount from a final one.
  it('persists the pending-authorization hold flag', () => {
    const pending = statement[2];
    const transaction = mapStatementItem(pending, 'holding-1');
    expect(pending.hold).toBe(true);
    expect(transaction.hold).toBe(true);
  });

  it('defaults a hold-less payload to settled', () => {
    const { hold, ...withoutHold } = statement[0];
    const transaction = mapStatementItem(withoutHold as MonobankStatementItem, 'holding-1');
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

type SyncedTransactionInput = Parameters<SyncDeps['addTransactions']>[0][number];

/**
 * The BANK-OWNED columns of a synced row: the ones a re-fetched statement item
 * refreshes on conflict, normalized onto the `T | null` shape a stored row
 * declares. `category` and `comment` are deliberately absent — they may hold the
 * user's own value, and the real `addManyDedup` upsert leaves them alone too.
 *
 * This list MIRRORS that upsert's `onConflictDoUpdate` set in
 * `repositories/transactions.repo.ts` and must change with it, or the double
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
  let sequence = 0;
  const nextId = () => `id-${++sequence}`;
  // Typed with the dep's own `milliseconds` parameter so an assertion can read
  // back the delay each call asked for, not merely that a call happened.
  const sleep = jest.fn(async (_milliseconds: number): Promise<void> => undefined);

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
      // The dep's input carries neither column, but a stored row declares both
      // as `string | null` — the real repository defaults them the same way.
      icon: null,
      color: null,
      metadata: merged,
    });
  };

  // Mirrors `transactionsRepo.addManyDedup`'s upsert on (source, externalId): a
  // re-fetched statement item REFRESHES the stored row's bank-owned fields
  // (amount/description/hold/mcc/counterIban/time) instead of being skipped,
  // while `category` and `comment` — which the user may have overridden — are
  // left untouched. It returns the number of rows actually INSERTED, which is
  // what the sync reports to the user as "imported".
  const addTransactions: SyncDeps['addTransactions'] = async (inputs) => {
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
    addTransactions,
    getLastSyncAt: async () => null,
    setLastSyncAt: async () => undefined,
    setLastSyncDisplayAt: async () => undefined,
    // NULL by default, matching a never-synced app: the base fake also returns a
    // null `getLastSyncAt`, and production stamps both together (a full-fetch run
    // sets `lastSyncAt` AND `lastFullSyncAt`), so "cursor null, full-fetch marker
    // set" is an impossible state a fake must not fabricate. Null here forces a
    // full fetch (via `shouldFullFetch`), which is what every existing test wants
    // until it opts into the incremental/skip path — and, crucially, on that full
    // fetch the from-window now derives from `lastFullSyncAt` (see
    // `fromCursorSeconds`), so a non-null default equal to `now` would collapse
    // the window to empty and fetch nothing. A test exercising the balance-diff
    // skip sets BOTH a recent `getLastSyncAt` and a recent `getLastFullSyncAt` so
    // the periodic safety net does not fire.
    getLastFullSyncAt: async () => null,
    setLastFullSyncAt: async () => undefined,
    // No outstanding holds by default; a test that exercises the hold carve-out
    // overrides this with the held card's holding id.
    getHoldingIdsWithHold: async () => [],
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

  // `useSyncAction` (src/screens/use-sync.ts) surfaces this thrown message
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
    deps.updateAccount = async (accountId, patch) => {
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

    const rows = transactionsStore.filter((row) => row.externalId === 'stmt-1');

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
    expect(transactionsStore.some((row) => row.externalId === 'straggler')).toBe(true);
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
    const setLastSyncAt = jest.fn(async (_timestamp: number): Promise<void> => undefined);
    deps.setLastSyncAt = setLastSyncAt;

    await runSync(deps);

    const [persisted] = setLastSyncAt.mock.calls.at(-1) ?? [];
    const [, , , statementTo] = fetchStatement.mock.calls.at(-1) ?? [];

    // The cursor must be the same instant the statement window closed at, not
    // whatever the clock reads after the throttle sleeps that follow it.
    expect(persisted).toBe((statementTo as number) * 1000);
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

    const { deps, transactionsStore } = makeInMemoryDeps(() => [], [connected]);

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

    let cursor: number | null = null;
    deps.getLastSyncAt = async () => cursor;
    const setLastSyncAt = jest.fn(async (timestamp: number): Promise<void> => {
      cursor = timestamp;
    });
    deps.setLastSyncAt = setLastSyncAt;

    // First run: the FIRST card fails, but the second card must still import —
    // the old fail-fast loop stopped every later card the moment one threw.
    await expect(runSync(deps)).rejects.toThrow();
    expect(transactionsStore.some((row) => row.externalId === 'txn-B')).toBe(true);
    // The cursor stays put so card A's window is re-fetched next time.
    expect(setLastSyncAt).not.toHaveBeenCalled();

    // Second run: card A recovers. Card B is re-fetched but its row already
    // exists, so it dedups to zero new — nothing is re-imported.
    failA = false;
    const second = await runSync(deps);

    expect(second.importedTransactions).toBe(1);
    expect(transactionsStore.filter((row) => row.externalId === 'txn-B')).toHaveLength(1);
    expect(transactionsStore.filter((row) => row.externalId === 'txn-A')).toHaveLength(1);
    expect(setLastSyncAt).toHaveBeenCalledTimes(1);
  });

  // The DISPLAY timestamp is decoupled from the statement cursor: a partial
  // failure that still imported at least one card's rows must move the "last
  // synced" display (so the user sees it landed) WITHOUT advancing the cursor
  // (so the failed card's window is re-covered next run).
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

    const setLastSyncAt = jest.fn(async (_timestamp: number): Promise<void> => undefined);
    const setLastSyncDisplayAt = jest.fn(async (_timestamp: number): Promise<void> => undefined);
    deps.setLastSyncAt = setLastSyncAt;
    deps.setLastSyncDisplayAt = setLastSyncDisplayAt;
    deps.now = () => 1_700_000_000_000;

    await expect(runSync(deps)).rejects.toThrow();

    // The failed card leaves the cursor put, but card B imported, so the
    // display stamp still moves — to the injected `now`.
    expect(setLastSyncAt).not.toHaveBeenCalled();
    expect(setLastSyncDisplayAt).toHaveBeenCalledTimes(1);
    expect(setLastSyncDisplayAt).toHaveBeenCalledWith(1_700_000_000_000);
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
    const setLastSyncDisplayAt = jest.fn(async (_timestamp: number): Promise<void> => undefined);
    deps.setLastSyncDisplayAt = setLastSyncDisplayAt;

    await expect(runSync(deps)).rejects.toThrow();

    expect(setLastSyncDisplayAt).not.toHaveBeenCalled();
  });

  // A fully clean run that imported rows stamps BOTH the display timestamp and
  // the statement cursor.
  it('stamps both the display timestamp and the cursor on a clean run that imported rows', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps } = makeInMemoryDeps(onlyFirstAccount, [connected]);
    const setLastSyncAt = jest.fn(async (_timestamp: number): Promise<void> => undefined);
    const setLastSyncDisplayAt = jest.fn(async (_timestamp: number): Promise<void> => undefined);
    deps.setLastSyncAt = setLastSyncAt;
    deps.setLastSyncDisplayAt = setLastSyncDisplayAt;
    deps.now = () => 1_700_000_000_000;

    const result = await runSync(deps);

    expect(result.importedTransactions).toBe(statement.length);
    expect(setLastSyncAt).toHaveBeenCalledTimes(1);
    expect(setLastSyncDisplayAt).toHaveBeenCalledTimes(1);
    expect(setLastSyncDisplayAt).toHaveBeenCalledWith(1_700_000_000_000);
  });

  // A clean run that imported nothing (a re-sync with no new rows) is still a
  // real, successful sync: every card was reached, so the DISPLAY stamp moves
  // (the label means "Last sync", not "last import") AND the cursor advances
  // (the window was fully covered). This is the BUG1 fix — the display used to
  // freeze at the last IMPORT time and go stale on a no-new-rows re-sync.
  it('stamps the display timestamp on a clean run that imported nothing', async () => {
    const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
    const { deps } = makeInMemoryDeps(onlyFirstAccount, [connected]);
    const setLastSyncAt = jest.fn(async (_timestamp: number): Promise<void> => undefined);
    const setLastSyncDisplayAt = jest.fn(async (_timestamp: number): Promise<void> => undefined);
    deps.setLastSyncAt = setLastSyncAt;
    deps.setLastSyncDisplayAt = setLastSyncDisplayAt;
    deps.now = () => 1_700_000_000_000;

    await runSync(deps); // first run imports the fixture rows
    setLastSyncDisplayAt.mockClear();
    setLastSyncAt.mockClear();
    const second = await runSync(deps); // second run re-fetches, imports nothing new

    expect(second.importedTransactions).toBe(0);
    expect(setLastSyncAt).toHaveBeenCalledTimes(1);
    expect(setLastSyncDisplayAt).toHaveBeenCalledTimes(1);
    expect(setLastSyncDisplayAt).toHaveBeenCalledWith(1_700_000_000_000);
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
      const { deps } = makeInMemoryDeps(() => [], [connected]);

      // First sync populates each holding's stored balance at its client-info
      // value; it is a full fetch (no cursor yet).
      await runSync(deps);

      // Incremental run: a cursor exists and the last full fetch is recent, so
      // the balance-diff skip is live. Card A's balance is unchanged; card B's
      // moved, so only B must be fetched.
      deps.getLastSyncAt = async () => 1704326400000 - 1000;
      deps.getLastFullSyncAt = async () => 1704326400000 - 1000;
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
      const setLastFullSyncAt = jest.fn(async (_timestamp: number): Promise<void> => undefined);
      deps.setLastFullSyncAt = setLastFullSyncAt;
      const fetchStatement = jest.fn(async () => [] as MonobankStatementItem[]);
      deps.fetchStatement = fetchStatement as unknown as SyncDeps['fetchStatement'];

      // getLastSyncAt defaults to null → first sync → full fetch regardless of
      // balance.
      await runSync(deps);

      expect(fetchedIds(fetchStatement)).toEqual(expect.arrayContaining([idA, idB]));
      expect(setLastFullSyncAt).toHaveBeenCalledWith(1_700_000_000_000);
    });

    it('fetches an unchanged card that still carries an outstanding hold', async () => {
      const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
      const { deps, holdingsStore } = makeInMemoryDeps(() => [], [connected]);

      await runSync(deps);
      const heldHoldingId = holdingsStore.find((holding) => monobankIdOf(holding.metadata) === idA)
        ?.id as string;

      // Incremental run, both balances unchanged, but card A's holding has an
      // outstanding hold — a hold→settled refresh does not move the balance, so
      // A must still be fetched while B (unchanged, no hold) is skipped.
      deps.getLastSyncAt = async () => 1704326400000 - 1000;
      deps.getLastFullSyncAt = async () => 1704326400000 - 1000;
      deps.getHoldingIdsWithHold = async () => [heldHoldingId];
      const fetchStatement = jest.fn(async () => [] as MonobankStatementItem[]);
      deps.fetchStatement = fetchStatement as unknown as SyncDeps['fetchStatement'];

      await runSync(deps);

      expect(fetchedIds(fetchStatement)).toContain(idA);
      expect(fetchedIds(fetchStatement)).not.toContain(idB);
    });

    it('fetches every card on the periodic full-fetch even when balances are unchanged', async () => {
      const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
      const { deps } = makeInMemoryDeps(() => [], [connected]);
      deps.now = () => 1_700_000_000_000;

      await runSync(deps);

      // Incremental run with unchanged balances and no holds, but the last full
      // fetch is >24h old, so the safety net forces an all-cards fetch and
      // re-stamps the marker.
      deps.getLastSyncAt = async () => 1_700_000_000_000 - 1000;
      deps.getLastFullSyncAt = async () => 1_700_000_000_000 - (24 * 60 * 60 * 1000 + 1);
      const setLastFullSyncAt = jest.fn(async (_timestamp: number): Promise<void> => undefined);
      deps.setLastFullSyncAt = setLastFullSyncAt;
      const fetchStatement = jest.fn(async () => [] as MonobankStatementItem[]);
      deps.fetchStatement = fetchStatement as unknown as SyncDeps['fetchStatement'];

      await runSync(deps);

      expect(fetchedIds(fetchStatement)).toEqual(expect.arrayContaining([idA, idB]));
      expect(setLastFullSyncAt).toHaveBeenCalledWith(1_700_000_000_000);
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
      const { deps } = makeInMemoryDeps(() => [], [connected]);
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
      deps.getLastSyncAt = async () => recentCursor;
      deps.getLastFullSyncAt = async () => lastFullSyncAt;
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

    it('does not stamp the full-fetch marker or advance the cursor when a full fetch partially fails', async () => {
      const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
      const { deps } = makeInMemoryDeps(() => [], [connected]);
      // First sync ever → full fetch. Card A throws, so the run partially fails
      // and re-throws before either marker advances.
      deps.fetchStatement = async (_token, accountId) => {
        if (decodeURIComponent(accountId) === idA) {
          throw new Error('Monobank request failed: 500');
        }
        return [];
      };
      const setLastSyncAt = jest.fn(async (_timestamp: number): Promise<void> => undefined);
      const setLastFullSyncAt = jest.fn(async (_timestamp: number): Promise<void> => undefined);
      deps.setLastSyncAt = setLastSyncAt;
      deps.setLastFullSyncAt = setLastFullSyncAt;

      await expect(runSync(deps)).rejects.toThrow();

      expect(setLastSyncAt).not.toHaveBeenCalled();
      expect(setLastFullSyncAt).not.toHaveBeenCalled();
    });

    it('refreshes the display timestamp and imports zero when every card is skipped', async () => {
      const connected = bankAccount({ id: 'acc-mono', institution: 'monobank' });
      const { deps } = makeInMemoryDeps(() => [], [connected]);

      await runSync(deps);

      deps.getLastSyncAt = async () => 1704326400000 - 1000;
      deps.getLastFullSyncAt = async () => 1704326400000 - 1000;
      const setLastSyncDisplayAt = jest.fn(async (_timestamp: number): Promise<void> => undefined);
      const setLastSyncAt = jest.fn(async (_timestamp: number): Promise<void> => undefined);
      deps.setLastSyncDisplayAt = setLastSyncDisplayAt;
      deps.setLastSyncAt = setLastSyncAt;
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
  });
});
