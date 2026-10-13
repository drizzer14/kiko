import { DAY_MS } from '@kiko/dates';
import { minOf } from '@kiko/numbers';
import { i18n } from '@kiko/i18n/init';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { accountsRepo } from '@kiko/accounts';
import { syncStateRepo } from '@kiko/sync-state';
import { transactionsRepo } from '@kiko/transactions/repo';
import { statementFromOf } from '@kiko/holdings/holding-metadata';
import { holdingsRepo, type MonobankHolding } from '@kiko/holdings/repo';
import type { AccountRow, HoldingRow, SyncStateRow, TransactionRow } from '@kiko/db';

import {
  beginProgressSession,
  commitHolding,
  commitWork,
  endProgressSession,
  registerWork,
  setFastPhaseDone,
} from '../sync-status';
import { readToken } from '../token';
import { categoryForMcc } from '../mcc-category';
import { currencyFromCode } from '../currency-code';
import { fetchClientInfo, fetchStatement } from '../client';
import { createRequestGate, type RequestGate } from '../throttle';
import type { MonobankAccount, MonobankJar, MonobankStatementItem } from '../monobank-types';

type NewHolding = Pick<HoldingRow, 'accountId' | 'name' | 'type' | 'currency'> &
  Partial<Pick<HoldingRow, 'balanceMinorUnits' | 'metadata' | 'sortOrder'>>;

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
const FULL_FETCH_INTERVAL_MS = DAY_MS;

/**
 * The `accountsRepo` methods the sync calls directly. The whole repo module is
 * injected (production wires the real one; a test wires an in-memory double), so
 * there is no per-method wrapper to keep in step with it.
 */
interface SyncAccountsRepo {
  listQuery: () => PromiseLike<AccountRow[]>;
  update: (accountId: string, patch: Partial<AccountRow>) => Promise<unknown>;
}

/**
 * The `holdingsRepo` methods the sync calls directly.
 *
 * - `upsertMonobankMany` writes every card/jar of one client-info snapshot in a
 *   SINGLE transaction, so the reactive `holdings` callback fires ONCE for the
 *   fast phase rather than once per card (a tight N+M burst that starved the JS
 *   thread and stuttered the pull spinner).
 * - `setSyncedBalance` advances one card's crash-safe statement-import marker
 *   (`holdings.syncedBalanceMinorUnits`). Called ONLY after a card's statement
 *   fetch+import commits, so the marker never leads the imported data: an
 *   interrupted run leaves it behind and the next run re-imports the card. The
 *   balance-diff skip compares against THIS marker, not `holdings.balanceMinorUnits`
 *   (the display balance `upsertMonobankMany` overwrites up front every run).
 * - `closeManyBySync` stamps `closedAt` AND the sync-close mark
 *   (`syncClosedFromMs`) on a set of holdings in ONE transaction. The sync calls
 *   it ONLY on a COMPLETE, clean full-fetch run to reconcile away a holding
 *   Monobank omits from its response (a closed card, a deleted jar); never on a
 *   partial/failed/empty response — see the guarded close block in `runSyncInner`.
 *   It is not the user's `closeMany`, which writes no mark, so a user-closed
 *   holding never reopens (see `reconcileClosedHoldings`).
 * - `clearStatementFrom` drops a reopened card's or jar's `statementFromMs` once its
 *   widened statement import committed, right after `setSyncedBalance`.
 */
interface SyncHoldingsRepo {
  listByAccountQuery: (accountId: string) => PromiseLike<HoldingRow[]>;
  upsertMonobankMany: (holdings: MonobankHolding[]) => Promise<unknown>;
  setSyncedBalance: (holdingId: string, balance: Money) => Promise<unknown>;
  closeManyBySync: (holdingIds: string[], fromMs: number) => Promise<unknown>;
  clearStatementFrom: (holdingId: string) => Promise<unknown>;
}

/**
 * The `transactionsRepo` methods the sync calls directly. `addManyDedup` resolves
 * the number of rows actually INSERTED — a refreshed row is not one, and neither
 * is a statement-import row it adopted in place.
 * `holdingIdsWithHoldQuery` yields the DISTINCT holding ids that still carry an
 * outstanding Monobank hold (a pending authorization); such a card is fetched
 * even when its balance is unchanged, since a same-amount hold→settled refresh
 * does not move the balance.
 */
interface SyncTransactionsRepo {
  addManyDedup: (transactions: NewTransaction[]) => Promise<number>;
  holdingIdsWithHoldQuery: () => PromiseLike<{ holdingId: string }[]>;
}

/** The sync_state columns the sync reads out of `syncStateRepo.getQuery`. */
type SyncStateSnapshot = Pick<
  SyncStateRow,
  'lastSyncAt' | 'lastFullSyncAt' | 'failedSyncMonobankIds'
>;

/**
 * The `syncStateRepo` methods the sync calls directly. The Monobank cursor is now
 * PER CONNECTION: every read and write is keyed by the resolved account id, so a
 * second Monobank connection can never share or corrupt another's cursor (see the
 * `syncState` table comment in `db/schema.ts`). The sync reads that account's row
 * through `getQuery(accountId)` and derives its three cursors from it —
 * `lastSyncAt` (the statement cursor), `lastFullSyncAt` (the periodic full-fetch
 * marker) and `failedSyncMonobankIds` (the force-retry set). `ensure(accountId)`
 * creates the row if absent so a setter always has a row to update. The setters:
 *
 * - `setLastSyncAt` advances the statement cursor, ONLY on a fully clean run.
 * - `setLastSyncDisplayAt` stamps the DISPLAY "last synced" time — decoupled from
 *   the cursor — on every run that REACHED Monobank with at least one card
 *   succeeding (INCLUDING a partial failure), so the user sees a fresh time even
 *   when the cursor deliberately stays put to re-cover a failed card.
 * - `setLastFullSyncAt` stamps the last-full-fetch time; GRADUATED (advanced
 *   to this run's ceiling) only on a fully clean full-fetch run — a partial
 *   failure must not graduate it, or the failed card's own retry would widen
 *   to this just-advanced marker and lose whatever window the failed run
 *   itself was covering. A failed full fetch with no anchor at all yet (a
 *   true first sync) still ANCHORS it, to this run's own from-cursor rather
 *   than its ceiling — see `resolveFullSyncAtToPersist`'s own doc.
 * - `setFailedSyncMonobankIds` persists the force-fetch set for the NEXT run,
 *   stored as null when empty. Written on BOTH the clean and the partial-failure
 *   path, before the partial-failure throw.
 */
interface SyncSyncStateRepo {
  getQuery: (accountId: string) => PromiseLike<SyncStateSnapshot[]>;
  ensure: (accountId: string) => Promise<unknown>;
  setLastSyncAt: (accountId: string, timestamp: number) => Promise<unknown>;
  setLastSyncDisplayAt: (accountId: string, timestamp: number) => Promise<unknown>;
  setLastFullSyncAt: (accountId: string, timestamp: number) => Promise<unknown>;
  setFailedSyncMonobankIds: (accountId: string, ids: string[] | null) => Promise<unknown>;
}

/**
 * The injectable seams of the sync pipeline. Network, clock and delay are
 * injected so tests run instantly with fakes and never touch the real API
 * or wait on a real timer; the underlying repositories are injected as
 * objects so a test can drive an in-memory double instead of the native
 * op-sqlite repos, and the sync calls their methods directly rather than
 * through a hand-mirrored wrapper surface.
 *
 * There is deliberately no `gate` seam here: `runSync` builds its rate-limit
 * gate from `now`/`sleep`, which are already injectable, so a test needs no
 * extra seam to control it — and a `gate` dep would let a test accidentally
 * share one gate across two `runSync` calls, which is exactly the per-token
 * scoping the gate exists to get right (see `./throttle`).
 *
 * There is deliberately no settings-row-creation seam here either: the
 * single settings row (id = 1) is guaranteed to exist by the app-boot migrations
 * gate (`src/migration/migrations.gate.tsx`), which awaits `settingsRepo.ensure()`
 * before any screen — and so before any sync — can run. The PER-CONNECTION
 * `sync_state` cursor row is NOT guaranteed by boot the same way (a fresh Connect
 * creates the account only then), so `runSyncInner` calls
 * `syncStateRepo.ensure(accountId)` itself right after resolving the target, so a
 * cursor row always exists before any read or setter.
 */
export interface SyncDeps {
  fetchImpl: typeof fetch;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  /**
   * Read the token for the RESOLVED target account. The Monobank token is now
   * PER CONNECTION (`serviceFor(accountId)` in `./token`), so `runSyncInner`
   * resolves the target account id FIRST, then reads its own token — one
   * connection's token can never gate or corrupt another's.
   */
  readToken: (accountId: string) => Promise<string | undefined>;
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
  accountsRepo: SyncAccountsRepo;
  holdingsRepo: SyncHoldingsRepo;
  transactionsRepo: SyncTransactionsRepo;
  syncStateRepo: SyncSyncStateRepo;
}

const defaultDeps: SyncDeps = {
  fetchImpl: fetch,
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  readToken,
  fetchClientInfo,
  fetchStatement,
  accountsRepo,
  holdingsRepo,
  transactionsRepo,
  syncStateRepo,
};

// The per-connection `sync_state` row is ensured to exist by `runSyncInner`
// before any read, so `.at(0)` is that account's row; each reader defaults a null
// column the way the sync expects. Kept as module helpers (not inlined into
// `runSyncInner`) so the optional-chaining/`??` reads do not inflate that
// function's cognitive complexity.
const readLastSyncAt = async (deps: SyncDeps, accountId: string): Promise<number | null> =>
  (await deps.syncStateRepo.getQuery(accountId)).at(0)?.lastSyncAt ?? null;

const readLastFullSyncAt = async (deps: SyncDeps, accountId: string): Promise<number | null> =>
  (await deps.syncStateRepo.getQuery(accountId)).at(0)?.lastFullSyncAt ?? null;

const readFailedSyncIds = async (deps: SyncDeps, accountId: string): Promise<string[]> =>
  (await deps.syncStateRepo.getQuery(accountId)).at(0)?.failedSyncMonobankIds ?? [];

const readHoldingIdsWithHold = async (deps: SyncDeps): Promise<string[]> =>
  (await deps.transactionsRepo.holdingIdsWithHoldQuery()).map((row) => row.holdingId);

/** The force-fetch set is persisted as null when empty (see `syncStateRepo`). */
const failedIdsToPersist = (ids: string[]): string[] | null => (ids.length > 0 ? ids : null);

export const mapStatementItem = (
  item: MonobankStatementItem,
  holdingId: string,
  accountId: string,
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
  // NAMESPACED per connection: `${accountId}:${statementId}`. Monobank
  // statement ids are globally unique, but the GLOBAL `(source, external_id)`
  // unique index (schema.ts) is shared with Binance, whose deposit/withdrawal
  // ids are only PER-ACCOUNT unique — so once more than one connection per
  // provider is allowed, a bare id would let one connection's upsert refresh
  // another's row. Prefixing by the holding's account id keeps every
  // connection's keyspace disjoint. Migration 0029 backfills existing rows to
  // this exact form, so a re-sync of a pre-migration row matches in place.
  externalId: `${accountId}:${item.id}`,
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
 * `targetAccountId` (the Connect action), validate the target exists and return
 * it — the caller marks it `institution: 'monobank'` only once `fetchClientInfo`
 * has actually succeeded (see `markMonobankAccount`). Multiple Monobank
 * connections are now allowed: each has its OWN per-account token and its OWN
 * `sync_state` cursor, and its holdings match per account (`upsertByMetadataKey`
 * scopes by `accountId`), so a second connection can never import another's
 * cards or corrupt its cursor — the one-connection-per-institution invariant is
 * therefore retired here. Without a
 * `targetAccountId` (the legacy no-target path), reuse the FIRST connected
 * Monobank account; the fan-out always passes a target now, so this path only
 * serves an already-single-connection legacy caller. If neither is available
 * there is nothing to sync into — the new model requires the user to create and
 * connect an account first, so we surface a clear error rather than silently
 * minting a stray 'Monobank' account.
 */
// `useSyncAction` (src/sync/use-sync.ts) surfaces this thrown message's
// `.message` verbatim as the account-detail screen's error `<Text>` (see
// account-detail.screen.tsx), so it genuinely needs to be localized, not left
// as a diagnostic-only string. This module has no React context of its own,
// so it reads the i18next instance directly (the same pattern as
// `src/design-system/grid-interaction/grid-interaction.ts`) rather than threading a `t` prop
// through every sync call site. 'Monobank' itself is a brand name and is not
// translated (matching every other Monobank-branded catalog entry).
const resolveMonobankAccountId = async (deps: SyncDeps): Promise<string> => {
  const accounts = await deps.accountsRepo.listQuery();

  if (deps.targetAccountId !== undefined) {
    const target = accounts.find((account) => account.id === deps.targetAccountId);

    if (!target) {
      throw new Error(i18n.t('accountDetail.noMonobankConnection'));
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
    await deps.accountsRepo.update(accountId, { institution: 'monobank' });
  }
};

/**
 * A card/jar in a currency Kiko cannot represent (anything other than
 * UAH/USD/EUR) is SILENTLY EXCLUDED from net worth rather than crashing the
 * whole sync — the mappers below throw `unsupportedCurrencyCode` on such a
 * currency, so this guard must run BEFORE the mapper for every representable-
 * holding loop (it keeps throwing for every OTHER caller). Shared by the
 * accounts and jars loops in `upsertAllHoldings` below, which differ only in
 * which entity's `currencyCode`/`id` they pass in.
 */
const isUnrepresentableCurrency = (currencyCode: number, id: string): boolean => {
  if (currencyFromCode(currencyCode) !== undefined) {
    return false;
  }

  // Surface a sub-account Kiko cannot represent so a dev can tell whether one is a user's real
  // sync blocker.
  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) unrepresentable sub-account
  console.warn('[monobank sync] skipping holding: unrepresentable currency', {
    currencyCode,
    id,
  });

  return true;
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
    // Silently excluding an unrepresentable holding is strictly better than a
    // total failure: skipping here means every OTHER, representable card
    // still syncs instead of the whole run aborting on one foreign
    // sub-account. See `isUnrepresentableCurrency` above.
    if (isUnrepresentableCurrency(account.currencyCode, account.id)) {
      continue;
    }
    holdings.push({ ...mapAccountToHolding(account, accountId), monobankId: account.id });
  }

  for (const jar of jars ?? []) {
    // Same unrepresentable-currency carve-out as the accounts loop above: a
    // foreign-currency jar is excluded from net worth, not a fatal error.
    if (isUnrepresentableCurrency(jar.currencyCode, jar.id)) {
      continue;
    }
    holdings.push({ ...mapJarToHolding(jar, accountId), monobankId: jar.id });
  }

  await deps.holdingsRepo.upsertMonobankMany(holdings);
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
 * unique index makes a re-fetched item idempotent (an upsert). When a
 * response does not hit the cap we step to the previous 31-day window
 * instead.
 */
const fetchAllStatements = async (
  deps: SyncDeps,
  gate: RequestGate,
  token: string,
  monobankAccountId: string,
  fromSeconds: number,
  toSeconds: number,
  onPage?: () => void,
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
    // One statement page has been fetched — advance the determinate progress
    // bar by one work unit (the honest per-page granularity). The caller caps
    // this at the card's up-front window estimate so a capped page cannot draw
    // the fill above the card's share.
    onPage?.();
    const hitCap = items.length >= MAX_ITEMS_PER_RESPONSE;

    if (hitCap) {
      // On a capped page the next ceiling is the earliest item's own second,
      // not one second before it (see the doc comment above).
      const earliestItemSecond = minOf(items.map((item) => item.time));
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
const mapFetched = (
  items: MonobankStatementItem[],
  holdingId: string,
  accountId: string,
): NewTransaction[] => items.map((item) => mapStatementItem(item, holdingId, accountId));

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
 * Whether `lastFullSyncAt` graduates this run: a full fetch where EVERY card
 * succeeded, never a partial failure — see the call site for why.
 */
const shouldGraduateFullSync = (isFullFetch: boolean, failureCount: number): boolean =>
  isFullFetch && failureCount === 0;

/**
 * The `lastFullSyncAt` value to persist after this run, or `null` to leave it
 * unchanged. Two cases write a value:
 *
 * - A fully clean full fetch GRADUATES it to this run's ceiling
 *   (`shouldGraduateFullSync`) — the normal case.
 * - A FAILED full fetch that started with NO anchor at all (`lastFullSyncAt`
 *   was null on entry — a true first sync) still ANCHORS it, but to this
 *   run's own FROM cursor, not its ceiling. Without this, a first-ever sync
 *   that fails keeps `lastFullSyncAt` null, so every card's from-window keeps
 *   falling back to `fromCursorSeconds`' null-cursor default
 *   (`toSeconds - DEFAULT_LOOKBACK_SECONDS`) — which SLIDES FORWARD with the
 *   real clock on every retry, permanently losing however many days passed
 *   between the failed attempt and a delayed retry (the balance still looks
 *   right, since it is overwritten from client-info regardless). Anchoring
 *   the FROM the first attempt used keeps every later retry, however
 *   delayed, deriving the identical window. `lastSyncAt` staying null (it
 *   never advances on any failure) is what keeps `shouldFullFetch` forcing a
 *   full fetch on every one of those retries, so this anchor is never lost
 *   to a narrower incremental window in between. A periodic (non-first-sync)
 *   full fetch that fails never reaches this branch — it already had a real
 *   anchor before this run, which the graduation guard above already leaves
 *   untouched on failure.
 */
const resolveFullSyncAtToPersist = (
  isFullFetch: boolean,
  failureCount: number,
  lastSyncAt: number | null,
  lastFullSyncAt: number | null,
  toSeconds: number,
): number | null => {
  if (shouldGraduateFullSync(isFullFetch, failureCount)) {
    return toSeconds * 1000;
  }

  if (failureCount > 0 && lastFullSyncAt === null) {
    return fromCursorSeconds(isFullFetch, lastSyncAt, lastFullSyncAt, toSeconds) * 1000;
  }

  return null;
};

/**
 * What the statement path reads of a card or a jar: its Monobank id (the
 * statement URL segment) and its /client-info balance. A `MonobankJar` carries
 * both, so one queue serves cards and jars; see `runSyncInner` for the rule.
 */
type StatementSource = Pick<MonobankAccount, 'id' | 'balance'>;

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
 * failure cannot strand it once its balance settles unchanged. So is a card the
 * sync just reopened (its post-upsert holding carries `statementFromMs`): its
 * gap is still unimported, and a skip would leave the key lingering.
 */
const isBalanceDiffSkip = (
  account: StatementSource,
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

  if (context.failedSet.has(account.id) || statementFromOf(holding.metadata) !== null) {
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
  accounts: StatementSource[],
  context: {
    priorHoldingByMonobankId: Map<string, HoldingRow>;
    holdingByMonobankId: Map<string, HoldingRow>;
    holdIds: Set<string>;
    failedSet: Set<string>;
  },
): StatementSource[] => {
  const priority = (account: StatementSource): number => {
    const prior = context.priorHoldingByMonobankId.get(account.id);

    if (prior != null && holdingsRepo.balanceOf(prior).minorUnits !== account.balance) {
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
  orderedAccounts: StatementSource[],
  holdingByMonobankId: Map<string, HoldingRow>,
  skipContext: SkipContext,
): { toFetch: { account: StatementSource; holding: HoldingRow }[]; skipped: number } => {
  const toFetch: { account: StatementSource; holding: HoldingRow }[] = [];
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
 *
 * A card or jar the sync just reopened carries `statementFromMs` on its POST-upsert
 * `holding`: the window reaches back to it when that is earlier than the
 * normal cursor, because no run fetched the card while it was absent and the
 * closing run already moved the normal cursor past that gap. It never narrows
 * a window that is already wider.
 *
 * Known limit: that reopen window has no clamp. Monobank answers an old `from`
 * (13 months back, probed 2026-10-06) with 200, so the sync completes, but rows
 * older than the bank's own history depth may be missing without an error.
 */
const fromSecondsForCard = (
  account: StatementSource,
  prior: HoldingRow | undefined,
  holding: HoldingRow,
  context: {
    isFullFetch: boolean;
    lastSyncAt: number | null;
    lastFullSyncAt: number | null;
    toSeconds: number;
  },
): number => {
  const priorSynced = prior?.syncedBalanceMinorUnits;
  const markerBehind = priorSynced == null || priorSynced !== account.balance;
  const normal = fromCursorSeconds(
    context.isFullFetch || markerBehind,
    context.lastSyncAt,
    context.lastFullSyncAt,
    context.toSeconds,
  );

  return (
    foldMap(maybe(statementFromOf(holding.metadata)), (statementFromMs) =>
      Math.min(normal, Math.floor(statementFromMs / 1000)),
    ) ?? normal
  );
};

/**
 * The number of 31-day statement windows a card will page over `[fromSeconds,
 * toSeconds]`, known UP FRONT from the requested span. It is the card's WORK
 * weight on the determinate progress bar: a card whose from-window widens back to
 * `lastFullSyncAt` (a behind-marker or full-fetch card) weighs more than a
 * normally-in-sync card on the narrow incremental cursor. A capped page adds real
 * fetches beyond this estimate, but the caller caps the per-card commit at this
 * number so the fill never exceeds the card's share; at least one window always
 * counts.
 */
const estimateWindows = (fromSeconds: number, toSeconds: number): number =>
  Math.max(1, Math.ceil((toSeconds - fromSeconds) / MAX_WINDOW_SECONDS));

const importAccount = async (
  deps: SyncDeps,
  gate: RequestGate,
  token: string,
  accountId: string,
  account: StatementSource,
  fromSeconds: number,
  toSeconds: number,
  onPage?: () => void,
): Promise<number> => {
  const holdings = await deps.holdingsRepo.listByAccountQuery(accountId);
  const holding = holdings.find((candidate) => monobankIdOf(candidate.metadata) === account.id);

  if (!holding) {
    return 0;
  }

  const items = await fetchAllStatements(
    deps,
    gate,
    token,
    account.id,
    fromSeconds,
    toSeconds,
    onPage,
  );
  const fetched = mapFetched(items, holding.id, accountId);

  if (fetched.length === 0) {
    return 0;
  }

  // The count is the repository's, not this list's length: a re-fetched item
  // refreshes an existing row rather than adding one, and the user is told how
  // many transactions were IMPORTED.
  return deps.transactionsRepo.addManyDedup(fetched);
};

/** One source's fetch plan: its holding, its from-window, and its WORK weight. */
type CardPlan = {
  account: StatementSource;
  holding: HoldingRow;
  fromSeconds: number;
  windows: number;
};

/**
 * Fetch and import one planned card while driving the WEIGHTED progress bar: one
 * work unit per statement page (capped at the card's up-front window estimate so
 * a capped page never overshoots the card's share), then a reconcile to that
 * estimate and one holding completion once the statements commit. Advances the
 * crash-safe marker only after the import commits. Returns the imported count; the
 * caller isolates a failure.
 */
const fetchCardWithProgress = async (
  deps: SyncDeps,
  gate: RequestGate,
  token: string,
  accountId: string,
  toSeconds: number,
  card: CardPlan,
): Promise<number> => {
  let pagesCommitted = 0;
  const onPage = (): void => {
    if (pagesCommitted < card.windows) {
      pagesCommitted += 1;
      commitWork();
    }
  };

  const imported = await importAccount(
    deps,
    gate,
    token,
    accountId,
    card.account,
    card.fromSeconds,
    toSeconds,
    onPage,
  );

  await deps.holdingsRepo.setSyncedBalance(
    card.holding.id,
    Money.of(card.holding.currency, card.account.balance),
  );

  // Only after the marker: a crash between the two re-fetches the wide window,
  // which is idempotent. Skipped for a card that carries no cursor, so a plain
  // run opens no extra write per card.
  if (statementFromOf(card.holding.metadata) !== null) {
    await deps.holdingsRepo.clearStatementFrom(card.holding.id);
  }
  // Reconcile the card's work to its full up-front estimate (a card that paged
  // fewer windows than estimated still reaches its share), then complete the
  // holding for the label.
  if (pagesCommitted < card.windows) {
    commitWork(card.windows - pagesCommitted);
  }
  commitHolding();

  return imported;
};

const closeMarkFromMs = (lastFullSyncAt: number | null, toSeconds: number): number =>
  lastFullSyncAt ?? (toSeconds - DEFAULT_LOOKBACK_SECONDS) * 1000;

/**
 * On a COMPLETE, clean full fetch, close every Monobank holding under `accountId`
 * that is absent from the snapshot (a closed card, a deleted jar). Such a
 * holding is only UPSERTED while present, so without this reconciliation it
 * lingers with `closedAt = null` and its last balance, over-counting net worth
 * until some later event removes it.
 *
 * GUARDED so a partial, failed, or successful-but-empty response can NEVER close
 * a live holding — three conditions must ALL hold:
 *   1. `isFullFetch` — only the periodic complete reconciliation path;
 *   2. `failuresCount === 0` — no per-card statement failure this run (the caller
 *      already threw on a partial failure before reaching here, but the guard is
 *      kept explicit and defensive);
 *   3. the snapshot is non-empty — at least one account or jar came back, so a
 *      successful-but-empty body never wipes every holding. A network failure
 *      cannot reach here: `fetchClientInfo` throwing aborts the run earlier.
 *
 * The present set is the RAW snapshot — every account/jar id, INCLUDING an
 * unrepresentable-currency one that `upsertAllHoldings` skipped but is still
 * present, so a skipped card is never mistaken for a removed one. A holding with
 * no `monobankId` (a manual holding under a mixed account) is never closed.
 *
 * The close is MARKED (`closeManyBySync`): `markFromMs` is the `lastFullSyncAt`
 * this run READ before it graduated it, the last instant up to which every
 * present card was certainly imported (a run with no such instant falls back to
 * one default lookback below `now`). When the holding returns, the upsert
 * (`upsertByMetadataKey`) reopens exactly the rows that carry the mark, and the
 * card's first statement fetch reaches back to it (`fromSecondsForCard`): the
 * closing run moved the normal cursor past the gap, and no run fetched the
 * absent card. A holding the USER closed carries no mark and never reopens, and
 * a row that is already closed is skipped here, so the first mark is kept.
 *
 * Known limit: a holding this sync closed BEFORE the mark existed is
 * indistinguishable from a user close and stays closed. No repair is built: a
 * device check found every live card and jar already has its holding, and a
 * blanket mark could reopen a holding the user closed by hand while disconnected.
 */
const reconcileClosedHoldings = async (
  deps: SyncDeps,
  accountId: string,
  accounts: MonobankAccount[],
  jars: MonobankJar[] | undefined,
  isFullFetch: boolean,
  failuresCount: number,
  markFromMs: number,
): Promise<void> => {
  if (!(isFullFetch && failuresCount === 0 && accounts.length + (jars?.length ?? 0) > 0)) {
    return;
  }

  const present = new Set<string>([
    ...accounts.map((account) => account.id),
    ...(jars ?? []).map((jar) => jar.id),
  ]);
  const current = await deps.holdingsRepo.listByAccountQuery(accountId);
  const staleIds = current
    .filter((holding) => {
      const holdingMonobankId = monobankIdOf(holding.metadata);

      return (
        holdingMonobankId !== undefined &&
        !present.has(holdingMonobankId) &&
        holding.closedAt == null
      );
    })
    .map((holding) => holding.id);

  if (staleIds.length > 0) {
    await deps.holdingsRepo.closeManyBySync(staleIds, markFromMs);
  }
};

type SyncResult = { importedTransactions: number };

/**
 * Module-level PER-ACCOUNT single-flight lock — a `Map` keyed by the resolved
 * target account id, mirroring `inFlightBalanceSyncs` in `src/crypto-sync/sync.ts`.
 * Monobank's rate limit is per TOKEN, and all three sync entry points —
 * `useAutoSync` (app open), `useSyncAll` (pull-to-refresh) and `useSync` (the
 * manual button) — drive an account's token, so two overlapping runs for the
 * SAME account collide into 429s (the reported "inconsistent" symptom). While a
 * run is in flight for an account, every new trigger for that SAME account JOINS
 * (awaits) it and observes its result instead of starting a second concurrent
 * run; the lock releases the instant that run settles — success OR failure — so
 * the next trigger starts a fresh run.
 *
 * Keying PER ACCOUNT (not one global lock) is what lets the multi-connection
 * fan-out drive N Monobank accounts at once: two DIFFERENT accounts have
 * distinct tokens and distinct per-token rate-limit buckets, so they run
 * concurrently and safely (see `syncJobsFor`, which now passes a `targetAccountId`
 * per account). The key must be known SYNCHRONOUSLY — before any `await` — so two
 * overlapping triggers for one account cannot both slip past into their own run;
 * `runSync` therefore reads it from `overrides.targetAccountId` directly. A
 * no-target legacy call is the single connected account and shares one fixed
 * `institution:monobank` key, so its behavior is unchanged when exactly one
 * connection exists.
 *
 * This guards CONCURRENCY only and is complementary to, NOT a replacement for,
 * the per-invocation 60s request gate in `./throttle`: that gate paces requests
 * WITHIN a single run to respect the per-token interval; this lock stops two
 * runs for one account existing at once. Both invariants are load-bearing — see
 * kiko-architecture.
 *
 * Join (not queue) semantics are safe because the triggers are equivalent syncs
 * of the same account's token: `useAutoSync`/`useSyncAll` only fire for an
 * ALREADY-connected account, so there is no competing run when the first-time
 * Connect (a `targetAccountId` sync) executes, and a re-sync joining an in-flight
 * run of the same account's token yields exactly the result it would have
 * computed itself.
 */
const inFlightSyncs = new Map<string, Promise<SyncResult>>();

export const runSync = (overrides: Partial<SyncDeps> = {}): Promise<SyncResult> => {
  const key = overrides.targetAccountId ?? 'institution:monobank';
  const joined = inFlightSyncs.get(key);

  if (joined) {
    return joined;
  }
  // Enter the shared progress SESSION the instant this run acquires the lock —
  // before any network/DB work. The first contributor lights the transient
  // "syncing" signal (`useSyncStatus`) and resets the determinate progress, so
  // every reactive indicator shows the run; the session spans the whole fan-out
  // (this run plus any concurrent crypto `runBalanceSync`), so `isSyncing` and
  // the bar stay lit until the LAST path settles. A trigger that JOINS an
  // in-flight run takes the early `return joined` above and never reaches here,
  // so it neither re-enters nor prematurely leaves the session.
  beginProgressSession();
  // Reset the fast-phase-done signal at the START of the run, so a joined pull
  // observes THIS run's balance commit, not a stale one from a prior run. It
  // flips ON in `runSyncInner` once `upsertAllHoldings` commits the balances.
  setFastPhaseDone(false);
  const run = runSyncInner(overrides);
  inFlightSyncs.set(key, run);
  const release = (): void => {
    if (inFlightSyncs.get(key) === run) {
      inFlightSyncs.delete(key);
    }
    // Leave the shared progress session when the run settles (success OR
    // failure). The LAST contributor clears `isSyncing` and the progress bar.
    endProgressSession();
    // Clear the fast-phase-done signal when the run settles, so the next run
    // starts from a clean OFF state.
    setFastPhaseDone(false);
  };
  // Release on both settle paths; the returned `run` still carries the real
  // result/rejection to the caller (and to every joined trigger).
  run.then(release, release);

  return run;
};

/**
 * One sync run: client-info (the fast phase: every card and jar balance lands
 * at once), then the gated statement loop, then the cursors.
 *
 * A JAR is a statement source exactly like a card. Monobank serves
 * `/personal/statement/<jarId>/<from>/<to>` with the card row shape, so cards and
 * jars share ONE queue (`[...accounts, ...jars]`) through the unchanged order,
 * skip, window, fetch, marker and failed-set path, under the one per-token
 * request gate. A jar's rows land on its own holding, namespaced like a card's,
 * and a jar weighs its window count on the progress bar. Without them a card to
 * jar top-up left only the card's debit in the ledger, and the net-worth line
 * counted the jar's money on every day before the top-up.
 *
 * The two legs of a top-up stay two independent rows with no stored pair: the
 * statistics screen pairs a -X and a +X on two holdings of one currency within
 * two minutes at READ time (`internalTransferTransactionIds`), exactly as it does
 * for a card to card transfer, so neither leg counts as spending.
 *
 * Known limits (a user ruling, not an oversight):
 * - No backfill. A jar's window is a card's: it reaches back to `lastFullSyncAt`
 *   (a first sync: one default lookback) and never earlier, except a jar the sync
 *   closed and that returns, which reaches back to its close mark, like a card. So
 *   a jar stored before jars had statements keeps the false drop its line shows on
 *   every top-up day older than that, and the card's debit of such a top-up stays
 *   spending.
 * - A jar in a foreign currency (a USD jar paid out to a UAH card) has no
 *   same-currency partner, so its debit counts as spending. The pairing is not
 *   rate-aware; a Minor follow-up, not built.
 */
const runSyncInner = async (overrides: Partial<SyncDeps> = {}): Promise<SyncResult> => {
  const deps: SyncDeps = { ...defaultDeps, ...overrides };
  const startedAt = deps.now();

  // Resolve the target account FIRST — the token is now keyed by that account id
  // (`readToken(accountId)`), so the account must be known before its token can
  // be read. `resolveMonobankAccountId` writes nothing; it only validates the
  // target (or the already-connected account).
  const accountId = await resolveMonobankAccountId(deps);
  // Ensure this connection's `sync_state` cursor row exists before any read or
  // setter below. Idempotent (`onConflictDoNothing`): an already-connected
  // account (row created by an earlier backfill migration, or a prior run) is
  // left untouched, so its cursor is preserved.
  await deps.syncStateRepo.ensure(accountId);

  const token = await deps.readToken(accountId);

  if (!token) {
    throw new Error(i18n.t('accountDetail.noMonobankToken'));
  }

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
  const priorHoldingByMonobankId = indexByMonobankId(
    await deps.holdingsRepo.listByAccountQuery(accountId),
  );

  await upsertAllHoldings(deps, accountId, accounts, jars);

  // The FAST phase is done: client-info is fetched and the balances are
  // committed. Fire the signal now — the pull-to-refresh spinner ends here,
  // decoupled from the slow per-card statement loop that follows. The
  // determinate progress bar carries the rest of the run.
  setFastPhaseDone(true);

  // The CURRENT holdings, after the upsert: this run's authoritative
  // monobankId → holding map, giving each card's holding id (needed for the
  // outstanding-hold carve-out) and confirming the holding exists. `holdIds` is
  // the set of holding ids that still carry an outstanding Monobank hold.
  const holdingByMonobankId = indexByMonobankId(
    await deps.holdingsRepo.listByAccountQuery(accountId),
  );
  const holdIds = new Set(await readHoldingIdsWithHold(deps));

  // The cards force-fetched this run because their statement fetch FAILED last
  // run — fetched regardless of balance (see `isBalanceDiffSkip`). The raw prior
  // array is kept for the end-of-run diff that decides whether to re-persist.
  const priorFailedIds = await readFailedSyncIds(deps, accountId);
  const failedSet = new Set(priorFailedIds);

  const toSeconds = Math.floor(deps.now() / 1000);
  const lastSyncAt = await readLastSyncAt(deps, accountId);

  // Full-fetch decision: fetch EVERY card regardless of balance on the first
  // sync ever, when a full fetch has never run, or once the last one is older
  // than `FULL_FETCH_INTERVAL_MS`. Otherwise the balance-diff skip applies per
  // card below. Computed BEFORE the window because it widens the from-cursor.
  const lastFullSyncAt = await readLastFullSyncAt(deps, accountId);
  const isFullFetch = shouldFullFetch(deps.now, lastSyncAt, lastFullSyncAt);

  // The statement sources: every card, then every jar. A jar in an
  // unrepresentable currency has no holding, so `selectCardsToFetch` drops it.
  const jarSources: StatementSource[] = jars ?? [];
  const sources: StatementSource[] = [...accounts, ...jarSources];

  // Order the queue CHANGED-FIRST so a genuinely-active card imports in the
  // earliest 60s slot even when it sits last in client-info order — a run
  // interrupted partway through the serial gated loop would otherwise starve it.
  // This changes only the ORDER; the balance-diff skip below still decides which
  // sources are actually fetched. See `orderStatementQueue`.
  const orderedAccounts = orderStatementQueue(sources, {
    priorHoldingByMonobankId,
    holdingByMonobankId,
    holdIds,
    failedSet,
  });

  let importedTransactions = 0;
  const succeededIds: string[] = [];
  const failedIds: string[] = [];
  const failures: Error[] = [];

  // The sources that WILL be fetched this run, changed-first, with the skipped
  // count — decided BEFORE the serial fetch loop so the progress denominator is
  // known up front. See `selectCardsToFetch`.
  const { toFetch, skipped } = selectCardsToFetch(orderedAccounts, holdingByMonobankId, {
    isFullFetch,
    priorHoldingByMonobankId,
    holdIds,
    failedSet,
  });
  const fetched = toFetch.length;

  // Per-source fetch plan, computed UP FRONT so the weighted progress denominator
  // is known before the serial loop. Each source's from-window (a behind/NULL-marker
  // or full-fetch source widens back to `lastFullSyncAt`; a normally-in-sync one
  // keeps the narrow `lastSyncAt` cursor — see `fromSecondsForCard`) fixes its
  // statement-window count (`estimateWindows`), which is its WORK weight.
  const toFetchPlan = toFetch.map(({ account, holding }) => {
    const fromSeconds = fromSecondsForCard(
      account,
      priorHoldingByMonobankId.get(account.id),
      holding,
      { isFullFetch, lastSyncAt, lastFullSyncAt, toSeconds },
    );

    return { account, holding, fromSeconds, windows: estimateWindows(fromSeconds, toSeconds) };
  });

  // The determinate bar is WEIGHTED BY WORK: `totalWork` sums each fetched
  // source's window count, so a card or jar with a large statement history
  // occupies proportionally more of the bar. `fetched` counts the holdings for
  // the "N/M" label. A balance-diff-skipped source does NO work, so nothing is
  // pre-filled. Registered only when there is real work, so the bar never
  // appears for a no-op sync (the no-op guard). The session accumulates this into
  // any concurrent crypto run's work, so one fan-out drives one bar.
  const totalWork = toFetchPlan.reduce((sum, source) => sum + source.windows, 0);

  if (totalWork > 0) {
    registerWork(fetched, totalWork);
  }

  for (const card of toFetchPlan) {
    try {
      // `fetchCardWithProgress` advances the crash-safe marker ONLY after the
      // import commits, drives the weighted bar (one unit per page, reconciled to
      // the card's estimate), and completes the holding for the label.
      importedTransactions += await fetchCardWithProgress(
        deps,
        gate,
        token,
        accountId,
        toSeconds,
        card,
      );
      succeededIds.push(card.account.id);
    } catch (error) {
      // Isolate a per-card failure: a transient 429/timeout on one card must no
      // longer stop every LATER card in the same run from importing (the old
      // fail-fast loop aborted the whole sync on the first throw — a direct
      // cause of the reported inconsistency). The cards that DID import already
      // persisted their rows durably — each `importAccount` -> `addTransactions`
      // runs in its own `db.transaction()` — so their data is safe regardless.
      // The failed id is force-fetched next run (see the end-of-run sequence).
      failures.push(error instanceof Error ? error : new Error(String(error)));
      failedIds.push(card.account.id);
    }
  }

  // Diagnostic reached on BOTH the clean and the partial-failure path (it sits
  // before the throw below): surfaces each run's fetch/skip/failure counts and
  // wall-clock cost so a dev can tell whether a card is stuck in daily
  // full-fetch mode instead of the fast balance-diff path. No __DEV__ guard —
  // one line per sync is negligible, and it must be visible from a real device
  // log. The two-arg form with a plain object does NOT log any secret (no token,
  // no statement contents), so it clears the secret-log rule.
  // A one-line per-run sync summary (counts only, no secrets) so a dev can see whether the
  // balance-diff skip is engaging on-device.
  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) one-line per-run sync summary
  console.warn('[monobank sync] done', {
    isFullFetch,
    cards: accounts.length,
    jars: jarSources.length,
    fetched,
    skipped,
    failures: failures.length,
    elapsedMs: deps.now() - startedAt,
  });

  // Move the DISPLAY "last synced" stamp whenever this run REACHED Monobank
  // successfully — i.e. at least one source synced without error — regardless of
  // whether any new rows imported. The label means "Last sync", not "last
  // import": a clean re-sync that fetched every card but found nothing new is
  // still a real, successful sync and must refresh the time the user sees.
  //
  // Gated on "≥1 source succeeded" (`failures.length < sources.length`), not on
  // an unconditional stamp: a TOTAL failure (every card and jar errored) never
  // reached any statement, so it must NOT announce a fresh "Last sync". A PARTIAL
  // success (some sources imported, one failed) still stamps — this sits BEFORE
  // the partial-failure `throw` below. This is decoupled from the statement
  // cursor (`setLastSyncAt`), which advances only on a fully clean run.
  //
  // Stamping on ANY success never reads falsely current: the
  // crash-safe marker (`syncedBalanceMinorUnits`) makes a
  // still-pending card RE-FETCH next run rather than being skipped, so "Last
  // sync" tracking the last reached-Monobank run is honest. Stamping only on a
  // fully clean run would instead FREEZE "Last sync" whenever one card fails
  // persistently, which is the outcome the user rejected.
  if (failures.length < sources.length) {
    await deps.syncStateRepo.setLastSyncDisplayAt(accountId, deps.now());
  }

  // Persist the force-fetch set for the NEXT run BEFORE the partial-failure
  // throw, so a failed card is re-fetched next run even though the cursor stays
  // put. `nextFailedSet` drops the ids that succeeded this run, adds the ones
  // that failed, and prunes any absent from client-info. Written only when it
  // actually changed, to avoid a redundant transaction on the common (all-clean)
  // path where both sets are empty.
  const currentIds = new Set(sources.map((source) => source.id));
  const newFailedIds = nextFailedSet(priorFailedIds, succeededIds, failedIds, currentIds);

  if (!sameIdSet(priorFailedIds, newFailedIds)) {
    await deps.syncStateRepo.setFailedSyncMonobankIds(accountId, failedIdsToPersist(newFailedIds));
  }

  // The full-fetch marker to persist, if any — see `resolveFullSyncAtToPersist`'s
  // own doc for the graduate/leave-untouched/anchor cases.
  const fullSyncAtToPersist = resolveFullSyncAtToPersist(
    isFullFetch,
    failures.length,
    lastSyncAt,
    lastFullSyncAt,
    toSeconds,
  );

  if (fullSyncAtToPersist !== null) {
    await deps.syncStateRepo.setLastFullSyncAt(accountId, fullSyncAtToPersist);
  }

  if (failures.length > 0) {
    // Partial failure: do NOT advance the shared statement cursor, so the
    // failed card's window is re-covered on the next run. A re-fetch is
    // idempotent — the (source, external_id) upsert refreshes an existing
    // row rather than inserting a duplicate — so nothing already imported is
    // lost or re-imported (`addTransactions` reports 0 new for a re-fetched
    // item). Surface the failure so the caller shows an error and the user
    // retries. Everything above that must still run on a partial failure
    // (display stamp, failed-set persist, the full-fetch marker resolution)
    // already did.
    throw failures[0];
  }

  // Reconcile away holdings absent from the snapshot (a closed card, a
  // deleted jar), but ONLY on a complete, clean full fetch — see
  // `reconcileClosedHoldings` for the load-bearing guard.
  await reconcileClosedHoldings(
    deps,
    accountId,
    accounts,
    jars,
    isFullFetch,
    failures.length,
    closeMarkFromMs(lastFullSyncAt, toSeconds),
  );

  // The cursor is the ceiling this run actually QUERIED, not the clock at loop
  // end. `deps.now()` here left every transaction between `toSeconds` and the
  // end of the loop permanently unqueried — one throttle sleep per page, per
  // card, each a silent hole in imported history (the balance still came out
  // right, because it is overwritten from /client-info). Advanced ONLY on a
  // fully clean run (see the partial-failure branch above).
  await deps.syncStateRepo.setLastSyncAt(accountId, toSeconds * 1000);

  return { importedTransactions };
};
