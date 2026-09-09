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
import { setSyncing, setSyncProgress } from './sync-status';
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
 * How stale the last FULL statement fetch may get before the next sync forces
 * another one (24h). The steady-state sync SKIPS a card whose /client-info
 * balance is unchanged since the last sync — but a net-zero same-window
 * transaction pair (a +X and a -X landing in one sync window) leaves the
 * balance untouched, so the skip would never fetch either row. This interval
 * bounds that worst-case miss window: at least once a day every card is fetched
 * regardless of balance, so such a pair is recovered within a day.
 */
const FULL_FETCH_INTERVAL_MS = 24 * 60 * 60 * 1000;

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
  /**
   * Upsert every card/jar of one client-info snapshot in a SINGLE transaction,
   * so the reactive `holdings` callback fires ONCE for the fast phase rather
   * than once per card (a tight N+M burst that starved the JS thread and
   * stuttered the pull spinner). See `holdingsRepo.upsertMonobankMany`.
   */
  upsertHoldings: (holdings: MonobankHolding[]) => Promise<unknown>;
  /**
   * Advance one card's crash-safe statement-import marker
   * (`holdings.syncedBalanceMinorUnits`) to the balance whose statements were
   * just imported. Called ONLY after a card's statement fetch+import commits, so
   * the marker never leads the imported data: an interrupted run leaves it
   * behind and the next run re-imports the card. The balance-diff skip compares
   * against THIS marker, not `holdings.balanceMinorUnits` (the display balance
   * `upsertHolding` overwrites up front every run).
   */
  setSyncedBalance: (holdingId: string, balanceMinorUnits: number) => Promise<unknown>;
  /** Resolves the number of rows actually INSERTED — a refreshed row is not one. */
  addTransactions: (transactions: NewTransaction[]) => Promise<number>;
  getLastSyncAt: () => Promise<number | null>;
  setLastSyncAt: (timestamp: number) => Promise<unknown>;
  /**
   * Stamp the DISPLAY "last synced" timestamp — decoupled from the statement
   * cursor (`setLastSyncAt`). Written on every run that REACHED Monobank with at
   * least one card succeeding (INCLUDING a partial failure), regardless of
   * whether any new rows imported, so the user sees a fresh time even when the
   * cursor deliberately stays put to re-cover a failed card. The crash-safe
   * marker (`syncedBalanceMinorUnits`) makes a still-pending card re-fetch next
   * run, so stamping on any success is honest, not falsely current.
   */
  setLastSyncDisplayAt: (timestamp: number) => Promise<unknown>;
  /**
   * Read the epoch-ms timestamp of the last FULL statement fetch (every card
   * fetched regardless of balance), or `null` if one has never run. Drives the
   * balance-diff skip's periodic safety net (see `FULL_FETCH_INTERVAL_MS`).
   */
  getLastFullSyncAt: () => Promise<number | null>;
  /**
   * Stamp the last-full-fetch timestamp (epoch ms). Written only after a fully
   * clean full-fetch run, so a partial failure re-attempts the full fetch next
   * run.
   */
  setLastFullSyncAt: (timestamp: number) => Promise<unknown>;
  /**
   * The DISTINCT holding ids that still carry an outstanding Monobank hold (a
   * pending authorization). Such a card is fetched even when its balance is
   * unchanged, because a same-amount hold→settled refresh does not move the
   * balance.
   */
  getHoldingIdsWithHold: () => Promise<string[]>;
  /**
   * The Monobank account ids whose statement fetch FAILED on the LAST run
   * (`settings.failedSyncMonobankIds`, or an empty set when null). The next run
   * force-fetches exactly these, regardless of balance, so one flaky card does
   * not strand the whole account in daily full-fetch mode — the fix for a
   * partial failure that would otherwise never graduate `lastFullSyncAt`.
   */
  getFailedSyncIds: () => Promise<string[]>;
  /**
   * Persist the force-fetch set for the NEXT run: the ids still present in
   * client-info that either failed this run or failed a prior run and were not
   * re-fetched clean. Stored as null when empty (see
   * `settingsRepo.setFailedSyncMonobankIds`). Written on BOTH the clean and the
   * partial-failure path, before the partial-failure throw.
   */
  setFailedSyncIds: (ids: string[]) => Promise<unknown>;
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
  upsertHoldings: (holdings) => holdingsRepo.upsertMonobankMany(holdings),
  setSyncedBalance: (holdingId, balanceMinorUnits) =>
    holdingsRepo.setSyncedBalance(holdingId, balanceMinorUnits),
  addTransactions: (transactions) => transactionsRepo.addManyDedup(transactions),
  getLastSyncAt: async () => (await settingsRepo.getQuery()).at(0)?.lastSyncAt ?? null,
  setLastSyncAt: (timestamp) => settingsRepo.setLastSyncAt(timestamp),
  setLastSyncDisplayAt: (timestamp) => settingsRepo.setLastSyncDisplayAt(timestamp),
  getLastFullSyncAt: async () => (await settingsRepo.getQuery()).at(0)?.lastFullSyncAt ?? null,
  setLastFullSyncAt: (timestamp) => settingsRepo.setLastFullSyncAt(timestamp),
  getHoldingIdsWithHold: async () =>
    (await transactionsRepo.holdingIdsWithHoldQuery()).map((row) => row.holdingId),
  getFailedSyncIds: async () => (await settingsRepo.getQuery()).at(0)?.failedSyncMonobankIds ?? [],
  setFailedSyncIds: (ids) => settingsRepo.setFailedSyncMonobankIds(ids.length > 0 ? ids : null),
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

const upsertAllHoldings = async (
  deps: SyncDeps,
  accountId: string,
  accounts: MonobankAccount[],
  jars: MonobankJar[] | undefined,
): Promise<void> => {
  // Collect every representable card/jar and upsert them in ONE batched write,
  // so the reactive `holdings` callback fires ONCE for the whole fast phase. The
  // per-card write loop this replaced fanned out N+M separate transactions in a
  // tight burst at sync start, and each reactive fire re-ran the Home screen's
  // O(n) render — starving the JS thread and stuttering the pull spinner.
  const holdings: MonobankHolding[] = [];

  // A Monobank user with no cards/jars gets those fields omitted from the
  // /personal/client-info payload, so they arrive undefined. Default to an
  // empty list so the sync never crashes iterating an absent collection.
  for (const account of accounts ?? []) {
    // A card/jar in a currency Kiko cannot represent (anything other than
    // UAH/USD/EUR) is SILENTLY EXCLUDED from net worth rather than crashing the
    // whole sync. The mappers below throw `unsupportedCurrencyCode` on such a
    // currency; calling them here — outside the per-card statement try/catch —
    // meant one foreign sub-account (a multi-currency card, a FOP account, a
    // foreign jar) aborted the entire run before any card imported or the
    // cursor advanced, stranding the user in a permanent "cannot sync". Skipping
    // the unrepresentable holding is strictly better than a total failure: every
    // representable card still syncs. Guard BEFORE the mapper so it is never
    // reached for an unsupported currency (it keeps throwing for every OTHER
    // caller).
    if (currencyFromCode(account.currencyCode) === undefined) {
      // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) surface a sub-account Kiko cannot represent so a dev can tell whether one is a user's real sync blocker
      console.warn('[monobank sync] skipping holding: unrepresentable currency', {
        currencyCode: account.currencyCode,
        id: account.id,
      });
      continue;
    }
    holdings.push({ ...mapAccountToHolding(account, accountId), monobankId: account.id });
  }
  for (const jar of jars ?? []) {
    // Same unrepresentable-currency carve-out as the accounts loop above: a
    // foreign-currency jar is excluded from net worth, not a fatal error.
    if (currencyFromCode(jar.currencyCode) === undefined) {
      // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) surface a sub-account Kiko cannot represent so a dev can tell whether one is a user's real sync blocker
      console.warn('[monobank sync] skipping holding: unrepresentable currency', {
        currencyCode: jar.currencyCode,
        id: jar.id,
      });
      continue;
    }
    holdings.push({ ...mapJarToHolding(jar, accountId), monobankId: jar.id });
  }

  await deps.upsertHoldings(holdings);
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

/** Index a run's holdings by their Monobank id, skipping any without one. */
const indexByMonobankId = (holdings: HoldingRow[]): Map<string, HoldingRow> => {
  const map = new Map<string, HoldingRow>();
  for (const holding of holdings) {
    const monobankId = monobankIdOf(holding.metadata);
    if (monobankId !== undefined) {
      map.set(monobankId, holding);
    }
  }
  return map;
};

/**
 * Whether this run fetches EVERY card regardless of balance: the first sync
 * ever, a run with no prior full fetch, or one whose last full fetch is older
 * than `FULL_FETCH_INTERVAL_MS`. `!lastSyncAt` short-circuits before `now()` is
 * read, so a first sync never depends on the clock.
 */
const shouldFullFetch = (
  now: () => number,
  lastSyncAt: number | null,
  lastFullSyncAt: number | null,
): boolean =>
  !lastSyncAt || lastFullSyncAt == null || now() - lastFullSyncAt >= FULL_FETCH_INTERVAL_MS;

/**
 * The balance-diff skip predicate: skip a card's statement fetch only when this
 * is NOT a full fetch, the card is NOT in the force-retry set (a card whose
 * fetch failed on a prior run), its /client-info balance equals the CRASH-SAFE
 * marker (`holdings.syncedBalanceMinorUnits` — the balance through which its
 * statements were last SUCCESSFULLY imported, read before this run's upsert),
 * and it carries no outstanding hold.
 *
 * The comparison is against the marker, NOT `holdings.balanceMinorUnits`. That
 * display balance is overwritten by `upsertHoldings` at the START of every run,
 * before the statement loop: a run that committed a card's new balance up front
 * and was then interrupted (app background/kill) before importing its statements
 * left `balanceMinorUnits` == /client-info, so a display-balance comparison
 * skipped the card forever and its transactions never imported (until the 24h
 * full fetch). The marker advances ONLY after a card's statements commit, so an
 * interrupted card's marker stays behind and this predicate re-fetches it. A
 * NULL marker (never synced through — a fresh column on upgrade, or a holding
 * that never completed a statement import) never equals a balance, so the card
 * is fetched, which also recovers any card the old bug had stranded.
 *
 * A held card is always fetched because a same-amount hold→settled refresh does
 * not move the balance; a force-retry card is always fetched so a transient
 * failure cannot strand it once its balance settles unchanged.
 */
const isBalanceDiffSkip = (
  account: MonobankAccount,
  holding: HoldingRow,
  context: {
    isFullFetch: boolean;
    priorHoldingByMonobankId: Map<string, HoldingRow>;
    holdIds: Set<string>;
    failedSet: Set<string>;
  },
): boolean => {
  if (context.isFullFetch) {
    return false;
  }
  if (context.failedSet.has(account.id)) {
    return false;
  }
  const priorSynced = context.priorHoldingByMonobankId.get(account.id)?.syncedBalanceMinorUnits;
  const balanceUnchanged = priorSynced != null && priorSynced === account.balance;
  return balanceUnchanged && !context.holdIds.has(holding.id);
};

/**
 * Order the statement-fetch queue CHANGED-FIRST, so a genuinely-active card
 * imports in the earliest 60s slot even when it sits LAST in client-info order.
 * The serial per-token gate fetches one card per ~60s; a run interrupted (app
 * background/kill) partway through the loop otherwise starves a just-changed
 * last card — the reported missing-today-transaction bug. Three stable groups:
 *
 * 0. the card's /client-info balance differs from its PRIOR STORED balance
 *    (real recent activity). The signal is the prior STORED balance, NOT the
 *    crash-safe marker, so it discriminates even on the NULL-marker recovery
 *    build where every marker is null.
 * 1. the card holds an outstanding authorization, or is in the force-retry set.
 * 2. the rest (recovery/unchanged).
 *
 * `Array.prototype.sort` is stable, so cards within one group keep their
 * client-info order. This changes ONLY the fetch order — which cards are fetched
 * (the balance-diff skip) is decided unchanged inside the loop.
 */
type SkipContext = {
  isFullFetch: boolean;
  priorHoldingByMonobankId: Map<string, HoldingRow>;
  holdIds: Set<string>;
  failedSet: Set<string>;
};

const orderStatementQueue = (
  accounts: MonobankAccount[],
  context: {
    priorHoldingByMonobankId: Map<string, HoldingRow>;
    holdingByMonobankId: Map<string, HoldingRow>;
    holdIds: Set<string>;
    failedSet: Set<string>;
  },
): MonobankAccount[] => {
  const priority = (account: MonobankAccount): number => {
    const prior = context.priorHoldingByMonobankId.get(account.id);
    if (prior != null && prior.balanceMinorUnits !== account.balance) {
      return 0;
    }
    const holding = context.holdingByMonobankId.get(account.id);
    if ((holding != null && context.holdIds.has(holding.id)) || context.failedSet.has(account.id)) {
      return 1;
    }
    return 2;
  };

  return [...accounts].sort((a, b) => priority(a) - priority(b));
};

/**
 * Partition the (already changed-first ordered) accounts into the cards that
 * WILL be fetched this run and a skipped count, so the caller knows the
 * determinate-progress denominator BEFORE the serial fetch loop starts. A
 * missing holding is nothing to import into (matches `importAccount`'s own
 * guard); a balance-diff-skipped card is a successful no-op. The `toFetch`
 * order is preserved, so the changed-first queue still holds.
 */
const selectCardsToFetch = (
  orderedAccounts: MonobankAccount[],
  holdingByMonobankId: Map<string, HoldingRow>,
  skipContext: SkipContext,
): { toFetch: { account: MonobankAccount; holding: HoldingRow }[]; skipped: number } => {
  const toFetch: { account: MonobankAccount; holding: HoldingRow }[] = [];
  let skipped = 0;
  for (const account of orderedAccounts) {
    const holding = holdingByMonobankId.get(account.id);
    if (!holding) {
      continue;
    }
    if (isBalanceDiffSkip(account, holding, skipContext)) {
      skipped += 1;
      continue;
    }
    toFetch.push({ account, holding });
  }

  return { toFetch, skipped };
};

/**
 * The force-fetch set to persist for the NEXT run, pure and total for testing.
 * Starts from the prior failed set, drops every id that SUCCEEDED this run, adds
 * every id that FAILED this run, and keeps only ids still present in client-info
 * (`currentIds`) so a card the user removed is pruned rather than force-fetched
 * forever. Order of the returned array is not significant.
 */
export const nextFailedSet = (
  prior: string[],
  succeeded: string[],
  failed: string[],
  currentIds: Set<string>,
): string[] => {
  const succeededSet = new Set(succeeded);
  const result = new Set<string>();
  for (const id of prior) {
    if (!succeededSet.has(id) && currentIds.has(id)) {
      result.add(id);
    }
  }
  for (const id of failed) {
    if (currentIds.has(id)) {
      result.add(id);
    }
  }
  return [...result];
};

/** Order-insensitive equality of two id sets, to skip a redundant persist. */
const sameIdSet = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  const set = new Set(a);
  return b.every((id) => set.has(id));
};

/**
 * The inclusive from-second of this run's statement window. On a full fetch the
 * cursor is `lastFullSyncAt` (the last time ALL cards were queried); on an
 * incremental run it is `lastSyncAt` (the statement cursor). See the call site
 * in `runSyncInner` for why the full fetch must widen back to `lastFullSyncAt`.
 * A null cursor (the first sync, when both are null) falls back to the default
 * lookback below the queried ceiling.
 */
const fromCursorSeconds = (
  isFullFetch: boolean,
  lastSyncAt: number | null,
  lastFullSyncAt: number | null,
  toSeconds: number,
): number => {
  const cursor = isFullFetch ? lastFullSyncAt : lastSyncAt;
  return cursor ? Math.floor(cursor / 1000) : toSeconds - DEFAULT_LOOKBACK_SECONDS;
};

/**
 * The inclusive from-second of ONE card's statement window. A card whose
 * crash-safe marker is NULL or BEHIND its /client-info balance — unimported
 * activity, or the NULL-marker recovery build — widens back to the
 * `lastFullSyncAt` cursor, re-covering a transaction older than the incremental
 * `lastSyncAt` (the cursor advances on every clean run, including runs that skip
 * whole cards, so a stranded older transaction sits behind it). A card on a full
 * fetch widens the same way. A normally-in-sync card (marker == balance) keeps
 * the narrow incremental cursor. Shares the null-cursor fallback in
 * `fromCursorSeconds`.
 */
const fromSecondsForCard = (
  account: MonobankAccount,
  prior: HoldingRow | undefined,
  context: {
    isFullFetch: boolean;
    lastSyncAt: number | null;
    lastFullSyncAt: number | null;
    toSeconds: number;
  },
): number => {
  const priorSynced = prior?.syncedBalanceMinorUnits;
  const markerBehind = priorSynced == null || priorSynced !== account.balance;

  return fromCursorSeconds(
    context.isFullFetch || markerBehind,
    context.lastSyncAt,
    context.lastFullSyncAt,
    context.toSeconds,
  );
};

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
  // Light the transient "syncing" signal the instant this run acquires the
  // lock — before any network/DB work — so every reactive indicator
  // (`useSyncStatus`) shows it for the whole run. A trigger that JOINS an
  // in-flight run takes the early `return inFlightSync` above and never
  // reaches here, so it neither re-lights nor prematurely clears the flag; the
  // flag is cleared only when the ACTUAL run settles, in `release` below.
  setSyncing(true);
  // Reset the determinate progress signal at the START of the run — before the
  // total is known — so the transactions-list bar shows nothing until the skip
  // decision publishes a real total.
  setSyncProgress({ completed: 0, total: 0 });
  const release = (): void => {
    if (inFlightSync === run) {
      inFlightSync = null;
    }
    setSyncing(false);
    // Clear the progress signal when the run settles (success OR failure), so
    // the bar hides.
    setSyncProgress({ completed: 0, total: 0 });
  };
  // Release on both settle paths; the returned `run` still carries the real
  // result/rejection to the caller (and to every joined trigger).
  run.then(release, release);
  return run;
};

const runSyncInner = async (overrides: Partial<SyncDeps> = {}): Promise<SyncResult> => {
  const deps: SyncDeps = { ...defaultDeps, ...overrides };
  const startedAt = deps.now();
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

  // Capture each card/jar's PRIOR stored holding BEFORE `upsertHoldings`
  // overwrites `holdings.balanceMinorUnits` from this run's /client-info. That
  // column already IS "the balance as of the last sync" for a Monobank holding
  // (the sync rewrites it every run), so the balance-diff skip needs no new
  // column — but it must be read before the upsert clobbers it.
  const priorHoldingByMonobankId = indexByMonobankId(await deps.listHoldingsByAccount(accountId));

  await upsertAllHoldings(deps, accountId, accounts, jars);

  // The CURRENT holdings, after the upsert: this run's authoritative
  // monobankId → holding map, giving each card's holding id (needed for the
  // outstanding-hold carve-out) and confirming the holding exists. `holdIds` is
  // the set of holding ids that still carry an outstanding Monobank hold.
  const holdingByMonobankId = indexByMonobankId(await deps.listHoldingsByAccount(accountId));
  const holdIds = new Set(await deps.getHoldingIdsWithHold());

  // The cards force-fetched this run because their statement fetch FAILED last
  // run — fetched regardless of balance (see `isBalanceDiffSkip`). The raw prior
  // array is kept for the end-of-run diff that decides whether to re-persist.
  const priorFailedIds = await deps.getFailedSyncIds();
  const failedSet = new Set(priorFailedIds);

  const toSeconds = Math.floor(deps.now() / 1000);
  const lastSyncAt = await deps.getLastSyncAt();

  // Full-fetch decision: fetch EVERY card regardless of balance on the first
  // sync ever, when a full fetch has never run, or once the last one is older
  // than `FULL_FETCH_INTERVAL_MS`. Otherwise the balance-diff skip applies per
  // card below. Computed BEFORE the window because it widens the from-cursor.
  const lastFullSyncAt = await deps.getLastFullSyncAt();
  const isFullFetch = shouldFullFetch(deps.now, lastSyncAt, lastFullSyncAt);

  // Order the queue CHANGED-FIRST so a genuinely-active card imports in the
  // earliest 60s slot even when it sits last in client-info order — a run
  // interrupted partway through the serial gated loop would otherwise starve it.
  // This changes only the ORDER; the balance-diff skip below still decides which
  // cards are actually fetched. See `orderStatementQueue`.
  const orderedAccounts = orderStatementQueue(accounts, {
    priorHoldingByMonobankId,
    holdingByMonobankId,
    holdIds,
    failedSet,
  });

  let importedTransactions = 0;
  const succeededIds: string[] = [];
  const failedIds: string[] = [];
  const failures: Error[] = [];

  // The cards that WILL be fetched this run, changed-first, with the skipped
  // count — decided BEFORE the serial fetch loop so the progress denominator is
  // known up front. See `selectCardsToFetch`.
  const { toFetch, skipped } = selectCardsToFetch(orderedAccounts, holdingByMonobankId, {
    isFullFetch,
    priorHoldingByMonobankId,
    holdIds,
    failedSet,
  });
  const fetched = toFetch.length;

  // Publish the total now that the non-skipped set is decided; `completed` rises
  // as each card's statements import. The transactions-list progress bar
  // (`useSyncProgress`) renders `completed / total`.
  setSyncProgress({ completed: 0, total: toFetch.length });

  let completed = 0;
  for (const { account, holding } of toFetch) {
    // Per-card from-window: a behind/NULL-marker card (or any card on a full
    // fetch) widens back to `lastFullSyncAt` to re-cover a transaction older than
    // the incremental cursor; a normally-in-sync card keeps the narrow
    // `lastSyncAt` cursor. See `fromSecondsForCard`.
    const fromSeconds = fromSecondsForCard(account, priorHoldingByMonobankId.get(account.id), {
      isFullFetch,
      lastSyncAt,
      lastFullSyncAt,
      toSeconds,
    });
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
      // Advance the crash-safe marker ONLY now that this card's statements have
      // committed. `upsertHoldings` already wrote `balanceMinorUnits` (the
      // display balance) up front, but the balance-diff skip compares against
      // THIS marker instead — so a run interrupted after the up-front balance
      // write but before this point leaves the marker behind, and the next run
      // re-imports the card rather than skipping it on a matching display
      // balance. Written even when the card had zero new items: the card was
      // still successfully fetched THROUGH this balance, so it is safe to skip
      // next run while it stays unchanged.
      await deps.setSyncedBalance(holding.id, account.balance);
      succeededIds.push(account.id);
      // One card's statements have committed: advance the determinate bar.
      completed += 1;
      setSyncProgress({ completed, total: toFetch.length });
    } catch (error) {
      // Isolate a per-card failure: a transient 429/timeout on one card must no
      // longer stop every LATER card in the same run from importing (the old
      // fail-fast loop aborted the whole sync on the first throw — a direct
      // cause of the reported inconsistency). The cards that DID import already
      // persisted their rows durably — each `importAccount` -> `addTransactions`
      // runs in its own `db.transaction()` — so their data is safe regardless.
      // The failed id is force-fetched next run (see the end-of-run sequence).
      failures.push(error instanceof Error ? error : new Error(String(error)));
      failedIds.push(account.id);
    }
  }

  // Diagnostic reached on BOTH the clean and the partial-failure path (it sits
  // before the throw below): surfaces each run's fetch/skip/failure counts and
  // wall-clock cost so a dev can tell whether a card is stuck in daily
  // full-fetch mode instead of the fast balance-diff path. No __DEV__ guard —
  // one line per sync is negligible, and it must be visible from a real device
  // log. The two-arg form with a plain object does NOT log any secret (no token,
  // no statement contents), so it clears the secret-log rule.
  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) one-line per-run sync summary (counts only, no secrets) so a dev can see whether the balance-diff skip is engaging on-device
  console.warn('[monobank sync] done', {
    isFullFetch,
    cards: accounts.length,
    fetched,
    skipped,
    failures: failures.length,
    elapsedMs: deps.now() - startedAt,
  });

  // Move the DISPLAY "last synced" stamp whenever this run REACHED Monobank
  // successfully — i.e. at least one card synced without error — regardless of
  // whether any new rows imported. The label means "Last sync", not "last
  // import": a clean re-sync that fetched every card but found nothing new is
  // still a real, successful sync and must refresh the time the user sees.
  //
  // Gated on "≥1 card succeeded" (`failures.length < accounts.length`), not on
  // an unconditional stamp: a TOTAL failure (every card errored) never reached
  // any statement, so it must NOT announce a fresh "Last sync". A PARTIAL
  // success (some cards imported, one failed) still stamps — this sits BEFORE
  // the partial-failure `throw` below. This is decoupled from the statement
  // cursor (`setLastSyncAt`), which advances only on a fully clean run.
  //
  // Stamping on ANY success does NOT re-introduce the false-current bug: the
  // crash-safe marker (`syncedBalanceMinorUnits`, BUG A fix 1) makes a
  // still-pending card RE-FETCH next run rather than being skipped, so "Last
  // sync" tracking the last reached-Monobank run is honest. Stamping only on a
  // fully clean run would instead FREEZE "Last sync" whenever one card fails
  // persistently, which is the outcome the user rejected.
  if (failures.length < accounts.length) {
    await deps.setLastSyncDisplayAt(deps.now());
  }

  // Persist the force-fetch set for the NEXT run BEFORE the partial-failure
  // throw, so a failed card is re-fetched next run even though the cursor stays
  // put. `nextFailedSet` drops the ids that succeeded this run, adds the ones
  // that failed, and prunes any no longer in client-info. Written only when it
  // actually changed, to avoid a redundant transaction on the common (all-clean)
  // path where both sets are empty.
  const currentIds = new Set(accounts.map((account) => account.id));
  const newFailedIds = nextFailedSet(priorFailedIds, succeededIds, failedIds, currentIds);
  if (!sameIdSet(priorFailedIds, newFailedIds)) {
    await deps.setFailedSyncIds(newFailedIds);
  }

  // GRADUATE the full-fetch marker EVEN ON A PARTIAL FAILURE — the key R6-1
  // change. This now runs BEFORE the throw below, so a full fetch where one card
  // failed still advances `lastFullSyncAt` and does NOT get stuck re-running a
  // slow N×60s full fetch every time (which starved the balance-diff skip once
  // the marker aged past `FULL_FETCH_INTERVAL_MS`). Nothing is lost: the failed
  // card is force-fetched next run via `failedSyncMonobankIds`, and because the
  // cursor (`setLastSyncAt` below) stays put on a partial failure, that
  // force-fetch derives its window from the un-advanced `lastSyncAt` and
  // re-covers the failed card's window; dedup keeps it idempotent. Stamped with
  // the queried ceiling (`toSeconds * 1000`), matching `setLastSyncAt`'s
  // convention, so the next full fetch resumes precisely where this one ended.
  if (isFullFetch) {
    await deps.setLastFullSyncAt(toSeconds * 1000);
  }

  if (failures.length > 0) {
    // Partial failure: do NOT advance the shared cursor, so the failed card's
    // window is re-covered on the next run. A re-fetch is idempotent — the
    // (source, external_id) upsert refreshes an existing row rather than
    // inserting a duplicate — so nothing already imported is lost or
    // re-imported (`addTransactions` reports 0 new for a re-fetched item).
    // Surface the failure so the caller shows an error and the user retries.
    // Everything above (display stamp, failed-set persist, full-fetch
    // graduation) already ran, so the failed card is force-fetched next run
    // without stranding the account in permanent full-fetch mode.
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
