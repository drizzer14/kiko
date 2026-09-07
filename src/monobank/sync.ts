import type { AccountRow, HoldingRow, TransactionRow } from '../db/schema';
import { i18n } from '../i18n';
import { accountsRepo } from '../repositories/accounts.repo';
import { holdingsRepo } from '../repositories/holdings.repo';
import { settingsRepo } from '../repositories/settings.repo';
import { transactionsRepo } from '../repositories/transactions.repo';

import { currencyFromCode } from './currency-code';
import { categoryForMcc } from './mcc-category';
import { fetchClientInfo, fetchStatement } from './monobank.client';
import type { MonobankAccount, MonobankJar, MonobankStatementItem } from './monobank.types';
import { createRequestGate, type RequestGate } from './throttle';
import { readToken } from './token';

type NewHolding = Pick<HoldingRow, 'accountId' | 'name' | 'type' | 'currency'> &
  Partial<Pick<HoldingRow, 'balanceMinorUnits' | 'metadata' | 'sortOrder'>>;

type MonobankHolding = NewHolding & { monobankId: string };

type NewTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time' | 'source'> &
  Partial<
    Pick<
      TransactionRow,
      'description' | 'category' | 'mcc' | 'hold' | 'counterIban' | 'comment' | 'externalId'
    >
  >;

/** Monobank statement window ceiling: 31 days, expressed in seconds. */
const MAX_WINDOW_SECONDS = 31 * 24 * 60 * 60;
/** Monobank personal API rate limit: at most one request per 60 seconds. */
const RATE_LIMIT_MS = 60 * 1000;
/** Monobank returns at most 500 statement items per response. */
const MAX_ITEMS_PER_RESPONSE = 500;
/** First-sync lookback when no previous sync timestamp is stored. */
const DEFAULT_LOOKBACK_SECONDS = MAX_WINDOW_SECONDS;

/**
 * The injectable seams of the sync pipeline. Network, clock and delay are
 * injected so tests run instantly with fakes and never touch the real API
 * or wait on a real timer; the data-access functions are injected so tests
 * can drive an in-memory double instead of the native op-sqlite repos.
 *
 * There is deliberately no `gate` seam here: `runSync` builds its rate-limit
 * gate from `now`/`sleep`, which are already injectable, so a test needs no
 * extra seam to control it — and a `gate` dep would let a test accidentally
 * share one gate across two `runSync` calls, which is exactly the per-token
 * scoping the gate exists to get right (see `./throttle`).
 *
 * There is deliberately no settings-row-creation seam here either: the
 * single settings row (id = 1) that `getLastSyncAt`/`setLastSyncAt` read
 * and write is guaranteed to exist by the app-boot migrations gate
 * (`src/db/migrations.gate.tsx`), which awaits `settingsRepo.ensure()`
 * before any screen — and so before any sync — can run.
 */
export interface SyncDeps {
  fetchImpl: typeof fetch;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  readToken: () => Promise<string | undefined>;
  fetchClientInfo: (
    token: string,
    fetchImpl?: typeof fetch,
  ) => Promise<{
    accounts: MonobankAccount[];
    jars?: MonobankJar[];
  }>;
  fetchStatement: (
    token: string,
    accountId: string,
    fromSeconds: number,
    toSeconds: number,
    fetchImpl?: typeof fetch,
  ) => Promise<MonobankStatementItem[]>;
  /**
   * The user-created account to (re)target this sync at. When set, the account
   * is marked `institution: 'monobank'` once `fetchClientInfo` succeeds (see
   * `markMonobankAccount`), and every synced holding lands under it. When
   * absent, the sync targets the already-connected Monobank account.
   */
  targetAccountId?: string;
  listAccounts: () => Promise<AccountRow[]>;
  updateAccount: (accountId: string, patch: Partial<AccountRow>) => Promise<unknown>;
  listHoldingsByAccount: (accountId: string) => Promise<HoldingRow[]>;
  upsertHolding: (holding: MonobankHolding) => Promise<unknown>;
  /** Resolves the number of rows actually INSERTED — a refreshed row is not one. */
  addTransactions: (transactions: NewTransaction[]) => Promise<number>;
  getLastSyncAt: () => Promise<number | null>;
  setLastSyncAt: (timestamp: number) => Promise<unknown>;
}

const defaultDeps: SyncDeps = {
  fetchImpl: fetch,
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  readToken,
  fetchClientInfo,
  fetchStatement,
  listAccounts: async () => accountsRepo.listQuery(),
  updateAccount: (accountId, patch) => accountsRepo.update(accountId, patch),
  listHoldingsByAccount: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  upsertHolding: (holding) => holdingsRepo.upsertMonobank(holding),
  addTransactions: (transactions) => transactionsRepo.addManyDedup(transactions),
  getLastSyncAt: async () => (await settingsRepo.getQuery()).at(0)?.lastSyncAt ?? null,
  setLastSyncAt: (timestamp) => settingsRepo.setLastSyncAt(timestamp),
};

export const mapStatementItem = (
  item: MonobankStatementItem,
  holdingId: string,
): NewTransaction => ({
  holdingId,
  amountMinorUnits: item.amount,
  time: item.time * 1000,
  description: item.description ?? '',
  mcc: item.mcc,
  // A pending authorization is imported like any other item, flagged so a
  // reader can tell its provisional amount from a settled one; the settled
  // re-fetch refreshes this row through `addManyDedup`'s upsert.
  hold: item.hold ?? false,
  counterIban: item.counterIban ?? null,
  category: categoryForMcc(item.mcc),
  comment: item.comment ?? null,
  source: 'monobank',
  externalId: item.id,
});

export const mapAccountToHolding = (
  account: MonobankAccount,
  monobankAccountId: string,
): NewHolding => {
  const currency = currencyFromCode(account.currencyCode);
  if (!currency) {
    throw new Error(
      i18n.t('accountDetail.unsupportedCurrencyCode', { code: account.currencyCode }),
    );
  }
  return {
    accountId: monobankAccountId,
    name: account.maskedPan?.[0] ?? account.type,
    type: 'card',
    currency,
    balanceMinorUnits: account.balance,
    metadata: { monobankId: account.id, iban: account.iban, maskedPan: account.maskedPan },
  };
};

const mapJarToHolding = (jar: MonobankJar, monobankAccountId: string): NewHolding => {
  const currency = currencyFromCode(jar.currencyCode);
  if (!currency) {
    throw new Error(i18n.t('accountDetail.unsupportedCurrencyCode', { code: jar.currencyCode }));
  }
  return {
    accountId: monobankAccountId,
    name: jar.title,
    type: 'jar',
    currency,
    balanceMinorUnits: jar.balance,
    metadata: { monobankId: jar.id },
  };
};

/** Metadata shape we rely on to re-associate a synced holding with its source id. */
type HoldingMetadata = { monobankId?: string } | null;

const monobankIdOf = (metadata: unknown): string | undefined =>
  (metadata as HoldingMetadata)?.monobankId;

/**
 * Resolve the account this sync targets, WITHOUT writing anything. With a
 * `targetAccountId` (the Connect action), validate the one-connection-per-
 * institution invariant and return it — the caller marks it `institution:
 * 'monobank'` only once `fetchClientInfo` has actually succeeded (see
 * `markMonobankAccount`). Without a `targetAccountId`, reuse the
 * already-connected Monobank account. If neither is available there is
 * nothing to sync into — the new model requires the user to create and
 * connect an account first, so we surface a clear error rather than silently
 * minting a stray 'Monobank' account.
 */
// `useSyncAction` (src/screens/use-sync.ts) surfaces this thrown message's
// `.message` verbatim as the account-detail screen's error `<Text>` (see
// account-detail.screen.tsx), so it genuinely needs to be localized, not left
// as a diagnostic-only string. This module has no React context of its own,
// so it reads the i18next instance directly (the same pattern as
// `src/screens/grid-interaction.ts`) rather than threading a `t` prop through
// every sync call site. 'Monobank' itself is a brand name and is not
// translated (matching every other Monobank-branded catalog entry).
const resolveMonobankAccountId = async (deps: SyncDeps): Promise<string> => {
  const accounts = await deps.listAccounts();
  if (deps.targetAccountId !== undefined) {
    const target = accounts.find((account) => account.id === deps.targetAccountId);
    if (!target) {
      throw new Error(i18n.t('accountDetail.noMonobankConnection'));
    }
    // The personal Monobank API is a single connection: at most one account may
    // be institution=monobank at a time. Re-connecting the SAME account is an
    // idempotent re-sync and stays allowed; a DIFFERENT already-connected
    // account is rejected so its cards/jars are never imported twice (which
    // would double-count net worth).
    const otherConnected = accounts.find((account) => {
      return account.institution === 'monobank' && account.id !== deps.targetAccountId;
    });
    if (otherConnected) {
      throw new Error(i18n.t('accountDetail.monobankAlreadyConnected'));
    }
    return deps.targetAccountId;
  }
  const existing = accounts.find((account) => account.institution === 'monobank');
  if (!existing) {
    throw new Error(i18n.t('accountDetail.noMonobankConnection'));
  }
  return existing.id;
};

/**
 * Mark the account `institution: 'monobank'`. Called ONLY after
 * `fetchClientInfo` has resolved: marking it up front (the previous
 * behaviour) left a failed connect — a wrong token, an offline device or a
 * 429 — permanently half-connected, since the account row is what every
 * other screen keys off of (detail screen shows Disconnect instead of the
 * token field, every other account's Connect is hidden, the account cannot
 * be deleted). `src/crypto-sync/sync.ts`'s `runBalanceSync` already orders
 * it this way. A re-sync (no `targetAccountId`) targets an already-marked
 * account, so this is a no-op then.
 */
const markMonobankAccount = async (deps: SyncDeps, accountId: string): Promise<void> => {
  if (deps.targetAccountId !== undefined) {
    await deps.updateAccount(accountId, { institution: 'monobank' });
  }
};

const upsertHoldings = async (
  deps: SyncDeps,
  accountId: string,
  accounts: MonobankAccount[],
  jars: MonobankJar[] | undefined,
): Promise<void> => {
  // A Monobank user with no cards/jars gets those fields omitted from the
  // /personal/client-info payload, so they arrive undefined. Default to an
  // empty list so the sync never crashes iterating an absent collection.
  for (const account of accounts ?? []) {
    await deps.upsertHolding({
      ...mapAccountToHolding(account, accountId),
      monobankId: account.id,
    });
  }
  for (const jar of jars ?? []) {
    await deps.upsertHolding({ ...mapJarToHolding(jar, accountId), monobankId: jar.id });
  }
};

/**
 * Pull every statement item for one bank account within [fromSeconds,
 * toSeconds], honouring the API's 31-day window and 500-item cap. The 1-req/60s
 * rate limit is NOT this function's to own — it is per token, not per account,
 * so every request here goes through the caller-supplied `gate` that `runSync`
 * shares across client-info and every other card. Monobank returns items
 * newest-first, so when a response hits the cap we narrow the ceiling to the
 * earliest item's own second and keep paging backwards — NOT one second
 * before it: any item sharing that exact second that did not fit in the page
 * would otherwise be excluded from every later window and never imported.
 * The resulting one-second overlap is free — the `(source, external_id)`
 * unique index makes a re-fetched item idempotent (an upsert since T-16, a
 * skip before it). When a response does not hit the cap we step to the
 * previous 31-day window instead.
 */
const fetchAllStatements = async (
  deps: SyncDeps,
  gate: RequestGate,
  token: string,
  monobankAccountId: string,
  fromSeconds: number,
  toSeconds: number,
): Promise<MonobankStatementItem[]> => {
  const collected: MonobankStatementItem[] = [];
  let windowTo = toSeconds;

  while (windowTo > fromSeconds) {
    const windowFrom = Math.max(fromSeconds, windowTo - MAX_WINDOW_SECONDS);

    await gate.wait();

    const items = await deps.fetchStatement(
      token,
      encodeURIComponent(monobankAccountId),
      windowFrom,
      windowTo,
      deps.fetchImpl,
    );
    collected.push(...items);
    const hitCap = items.length >= MAX_ITEMS_PER_RESPONSE;

    if (hitCap) {
      // On a capped page the next ceiling is the earliest item's own second,
      // not one second before it (see the doc comment above).
      const earliestItemSecond = Math.min(...items.map((item) => item.time));
      // Guard: if the earliest item's second is not strictly earlier than the
      // window just queried, the whole capped page shares that ceiling
      // second — reusing it verbatim would re-issue the identical query
      // forever. 500 items landing in a single second is pathological, but
      // the loop must still terminate, so step one second further back for
      // just this iteration.
      windowTo = earliestItemSecond < windowTo ? earliestItemSecond : windowTo - 1;
    } else {
      // Non-capped page: step to the previous 31-day window. `windowFrom` was
      // already the inclusive floor of the window just queried, so
      // subtracting avoids re-querying that exact second unnecessarily.
      windowTo = windowFrom - 1;
    }
  }
  return collected;
};

// Every fetched item is handed to `addManyDedup`, which upserts on
// `(source, external_id)`. There is deliberately no JS-side "already known"
// filter: it dropped a re-fetched item BEFORE the database saw it, so a held
// item's provisional amount could never be refreshed to its settled value.
// Doing it in SQL is also what makes the refresh atomic.
const mapFetched = (items: MonobankStatementItem[], holdingId: string): NewTransaction[] =>
  items.map((item) => mapStatementItem(item, holdingId));

const importAccount = async (
  deps: SyncDeps,
  gate: RequestGate,
  token: string,
  accountId: string,
  account: MonobankAccount,
  fromSeconds: number,
  toSeconds: number,
): Promise<number> => {
  const holdings = await deps.listHoldingsByAccount(accountId);
  const holding = holdings.find((candidate) => monobankIdOf(candidate.metadata) === account.id);

  if (!holding) {
    return 0;
  }

  const items = await fetchAllStatements(deps, gate, token, account.id, fromSeconds, toSeconds);
  const fetched = mapFetched(items, holding.id);

  if (fetched.length === 0) {
    return 0;
  }

  // The count is the repository's, not this list's length: a re-fetched item
  // refreshes an existing row rather than adding one, and the user is told how
  // many transactions were IMPORTED.
  return deps.addTransactions(fetched);
};

type SyncResult = { importedTransactions: number };

/**
 * Module-level single-flight lock. Monobank's rate limit is per TOKEN, and all
 * three sync entry points — `useAutoSync` (app open), `useSyncAll`
 * (pull-to-refresh) and `useSync` (the manual button) — drive the one connected
 * token, so two overlapping runs collide into 429s (the reported "inconsistent"
 * symptom). While a run is in flight, every new trigger JOINS (awaits) it and
 * observes its result instead of starting a second concurrent run; the lock
 * releases the instant the run settles — success OR failure — so the next
 * trigger starts a fresh run.
 *
 * This guards CONCURRENCY only and is complementary to, NOT a replacement for,
 * the per-invocation 60s request gate in `./throttle`: that gate paces requests
 * WITHIN a single run to respect the per-token interval; this lock stops two
 * runs existing at once. Both invariants are load-bearing — see kiko-architecture.
 *
 * Join (not queue) semantics are safe because the three triggers are equivalent
 * syncs of the same token: `useAutoSync`/`useSyncAll` only fire for an
 * ALREADY-connected account, so there is no competing run when the first-time
 * Connect (a `targetAccountId` sync) executes, and a re-sync joining an
 * in-flight run of the same connected token yields exactly the result it would
 * have computed itself.
 */
let inFlightSync: Promise<SyncResult> | null = null;

export const runSync = (overrides: Partial<SyncDeps> = {}): Promise<SyncResult> => {
  if (inFlightSync) {
    return inFlightSync;
  }
  const run = runSyncInner(overrides);
  inFlightSync = run;
  const release = (): void => {
    if (inFlightSync === run) {
      inFlightSync = null;
    }
  };
  // Release on both settle paths; the returned `run` still carries the real
  // result/rejection to the caller (and to every joined trigger).
  run.then(release, release);
  return run;
};

const runSyncInner = async (overrides: Partial<SyncDeps> = {}): Promise<SyncResult> => {
  const deps: SyncDeps = { ...defaultDeps, ...overrides };
  const token = await deps.readToken();
  if (!token) {
    throw new Error(i18n.t('accountDetail.noMonobankToken'));
  }

  const accountId = await resolveMonobankAccountId(deps);

  // ONE gate for this whole invocation: Monobank's 1-req/60s limit is per
  // TOKEN, so client-info and every card's statement pages share it.
  const gate = createRequestGate({
    intervalMs: RATE_LIMIT_MS,
    now: deps.now,
    sleep: deps.sleep,
  });

  await gate.wait();
  const { accounts, jars } = await deps.fetchClientInfo(token, deps.fetchImpl);
  await markMonobankAccount(deps, accountId);
  await upsertHoldings(deps, accountId, accounts, jars);

  const toSeconds = Math.floor(deps.now() / 1000);
  const lastSyncAt = await deps.getLastSyncAt();
  const fromSeconds = lastSyncAt
    ? Math.floor(lastSyncAt / 1000)
    : toSeconds - DEFAULT_LOOKBACK_SECONDS;

  let importedTransactions = 0;
  const failures: Error[] = [];
  for (const account of accounts) {
    try {
      importedTransactions += await importAccount(
        deps,
        gate,
        token,
        accountId,
        account,
        fromSeconds,
        toSeconds,
      );
    } catch (error) {
      // Isolate a per-card failure: a transient 429/timeout on one card must no
      // longer stop every LATER card in the same run from importing (the old
      // fail-fast loop aborted the whole sync on the first throw — a direct
      // cause of the reported inconsistency). The cards that DID import already
      // persisted their rows durably — each `importAccount` -> `addTransactions`
      // runs in its own `db.transaction()` — so their data is safe regardless.
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  if (failures.length > 0) {
    // Partial failure: do NOT advance the shared cursor, so the failed card's
    // window is re-covered on the next run. A re-fetch is idempotent — the
    // (source, external_id) upsert refreshes an existing row rather than
    // inserting a duplicate — so nothing already imported is lost or
    // re-imported (`addTransactions` reports 0 new for a re-fetched item).
    // Surface the failure so the caller shows an error and the user retries.
    //
    // SCOPED DOWN: a per-CARD cursor would also spare the cards that already
    // finished from being re-fetched next run, but Kiko stores a single global
    // `settings.lastSyncAt` and the holdings' JSON metadata is rewritten
    // wholesale by the client-info upsert, so a correct per-card cursor needs a
    // schema/metadata change beyond this change's minimal, safe scope. The
    // dedup layer already guarantees the correctness invariant; only the
    // network re-fetch cost is left on the table. See the task report.
    throw failures[0];
  }

  // The cursor is the ceiling this run actually QUERIED, not the clock at loop
  // end. `deps.now()` here left every transaction between `toSeconds` and the
  // end of the loop permanently unqueried — one throttle sleep per page, per
  // card, each a silent hole in imported history (the balance still came out
  // right, because it is overwritten from /client-info). Advanced ONLY on a
  // fully clean run (see the partial-failure branch above).
  await deps.setLastSyncAt(toSeconds * 1000);
  return { importedTransactions };
};
