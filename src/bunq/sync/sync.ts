import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { type BunqHolding, holdingsRepo } from '@kiko/holdings/repo';
import { syncStateRepo } from '@kiko/sync-state/sync-state.repo';
import { transactionsRepo } from '@kiko/transactions/repo';

import type { Currency } from '../../currency/currency';
import { isCurrency } from '../../currency/currency';
import { Money } from '../../currency/money';
import type { AccountRow, HoldingRow, SyncStateRow, TransactionRow } from '../../db/schema';
import { i18n } from '../../i18n';
import {
  beginProgressSession,
  commitHolding,
  commitWork,
  endProgressSession,
  registerWork,
  setFastPhaseDone,
} from '../../monobank/sync-status';
import { createRequestGate, type RequestGate } from '../../monobank/throttle';
import type { BunqCrypto, BunqMonetaryAccount, BunqPayment } from '../bunq.types';
import {
  fetchMonetaryAccounts,
  fetchPayments,
  installClient,
  openSession,
  registerDevice,
  SESSION_REFRESH_MARGIN_MS,
  type BunqPaymentsPage,
  type BunqSession,
  type BunqSessionResult,
} from '../client';
import { defaultBunqCrypto } from '../crypto';
import {
  type BunqContext,
  type BunqCredentials,
  readApiKey,
  readContext,
  saveContext,
} from '../credentials';

type NewHolding = Pick<HoldingRow, 'accountId' | 'name' | 'type' | 'currency'> &
  Partial<Pick<HoldingRow, 'balanceMinorUnits' | 'metadata' | 'sortOrder'>>;

type NewTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time' | 'source'> &
  Partial<Pick<TransactionRow, 'description' | 'counterIban' | 'externalId'>>;

/**
 * bunq's per-credential READ rate limit, in one named constant per the task
 * brief. TODO(VERIFY LIVE): the coordinator's live verification pass reports
 * read-endpoint limits of roughly 70-140 requests per 30 seconds — 500ms (2
 * req/s) is a conservative pacing pick within that documented range, not a
 * quoted exact number. This is DISTINCT from `/session-server`'s own, far
 * stricter rate limit (~1 req/30s), which this engine respects by CACHING
 * the session instead of pacing it — see `ensureBunqContext` below.
 */
const BUNQ_RATE_LIMIT_MS = 500;
/** First-sync lookback when no previous sync timestamp is stored. */
const DEFAULT_LOOKBACK_SECONDS = 31 * 24 * 60 * 60;
/**
 * Payment-page walk backstop per account, AND a FAIL-CLOSED data-completeness
 * boundary — not merely an infinite-loop guard. bunq's list endpoint has no
 * server-side date filter (CONFIRMED, coordinator's verification pass), so
 * `fetchAllPaymentsSince` below pages backward until it reaches `sinceMs`.
 * Reaching this cap BEFORE the incremental floor is a genuine
 * data-completeness failure, not a benign stop: `fetchAllPaymentsSince`
 * THROWS in that case rather than returning a truncated set, so the caller
 * never advances `sync_state.lastSyncAt` past a window it did not actually
 * finish reading (see that function's own doc comment).
 * TODO(VERIFY LIVE): if a real account's payment volume genuinely exceeds
 * this cap within one incremental window, implement forward/`newer_id`
 * paging so a huge first window can be covered across multiple syncs
 * instead of needing one run to walk it all.
 */
const MAX_PAYMENT_PAGES = 50;

/**
 * The `accountsRepo` methods the sync calls directly — mirrors
 * Monobank/PrivatBank's `SyncAccountsRepo`.
 */
interface SyncAccountsRepo {
  listQuery: () => PromiseLike<AccountRow[]>;
  update: (accountId: string, patch: Partial<AccountRow>) => Promise<unknown>;
}

/**
 * The `holdingsRepo` methods the sync calls directly. `upsertBunqMany` writes
 * every account of one `/monetary-account` snapshot in a SINGLE transaction,
 * so the reactive `holdings` callback fires ONCE for the fast phase rather
 * than once per account — mirrors Monobank's `upsertMonobankMany` /
 * PrivatBank's `upsertPrivatbankMany`.
 */
interface SyncHoldingsRepo {
  listByAccountQuery: (accountId: string) => PromiseLike<HoldingRow[]>;
  upsertBunqMany: (holdings: BunqHolding[]) => Promise<unknown>;
}

/**
 * The `transactionsRepo` methods the sync calls directly. `addManyDedup`
 * resolves the number of rows actually INSERTED — a refreshed row is not
 * one.
 */
interface SyncTransactionsRepo {
  addManyDedup: (transactions: NewTransaction[]) => Promise<number>;
}

/** The sync_state columns this simplified engine reads — deliberately just the one cursor, mirroring PrivatBank's Phase 1 engine. */
type SyncStateSnapshot = Pick<SyncStateRow, 'lastSyncAt'>;

interface SyncSyncStateRepo {
  getQuery: (accountId: string) => PromiseLike<SyncStateSnapshot[]>;
  ensure: (accountId: string) => Promise<unknown>;
  setLastSyncAt: (accountId: string, timestamp: number) => Promise<unknown>;
}

/**
 * The injectable seams of this pipeline — mirrors Monobank's/PrivatBank's
 * `SyncDeps` shape (network, clock, delay, the repos, all injected so tests
 * run instantly against fakes), PLUS the crypto seam and the handshake
 * primitives the injected-`BunqCrypto` design requires (task brief).
 */
export interface SyncDeps {
  fetchImpl: typeof fetch;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  crypto: BunqCrypto;
  /** Read the API key for the RESOLVED target account — mirrors PrivatBank's per-connection `readCredentials`. */
  readApiKey: (accountId: string) => Promise<BunqCredentials | undefined>;
  readContext: (accountId: string) => Promise<BunqContext | undefined>;
  saveContext: (accountId: string, context: BunqContext) => Promise<void>;
  installClient: (
    crypto: BunqCrypto,
    fetchImpl?: typeof fetch,
  ) => Promise<{ installationToken: string; privateKeyPem: string; publicKeyPem: string }>;
  registerDevice: (
    installationToken: string,
    apiKey: string,
    fetchImpl?: typeof fetch,
  ) => Promise<string>;
  openSession: (
    input: {
      installationToken: string;
      apiKey: string;
      privateKeyPem: string;
      crypto: BunqCrypto;
    },
    fetchImpl?: typeof fetch,
  ) => Promise<BunqSessionResult>;
  fetchMonetaryAccounts: (
    session: BunqSession,
    fetchImpl?: typeof fetch,
  ) => Promise<BunqMonetaryAccount[]>;
  fetchPayments: (
    session: BunqSession,
    monetaryAccountId: string,
    fetchImpl?: typeof fetch,
    olderId?: string,
  ) => Promise<BunqPaymentsPage>;
  /**
   * The user-created account to (re)target this sync at. When set, the
   * account is marked `institution: 'bunq'` once `fetchMonetaryAccounts`
   * succeeds (see `markBunqAccount`), and every synced holding lands under
   * it. When absent, the sync targets the already-connected bunq account.
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
  crypto: defaultBunqCrypto,
  readApiKey,
  readContext,
  saveContext,
  installClient,
  registerDevice,
  openSession,
  fetchMonetaryAccounts,
  fetchPayments,
  accountsRepo,
  holdingsRepo,
  transactionsRepo,
  syncStateRepo,
};

const readLastSyncAt = async (deps: SyncDeps, accountId: string): Promise<number | null> =>
  (await deps.syncStateRepo.getQuery(accountId)).at(0)?.lastSyncAt ?? null;

/**
 * bunq's currency mapping. CONFIRMED (coordinator's live verification pass):
 * a monetary account's `balance.currency` is an alpha-ISO-4217 code (e.g.
 * `'EUR'`), validated directly against the `Currency` union — `undefined`
 * for an unrepresentable currency, mirroring
 * `currencyFromPrivatbankCode`/`isUnrepresentableCurrency` in
 * `src/privatbank/sync/sync.ts`.
 */
const currencyFromBunqCode = (code: string): Currency | undefined =>
  isCurrency(code) ? code : undefined;

/**
 * A bunq monetary account in a currency Kiko cannot represent is SILENTLY
 * EXCLUDED from net worth rather than crashing the whole sync — mirrors
 * PrivatBank's `isUnrepresentableCurrency`.
 */
const isUnrepresentableCurrency = (code: string, id: string): boolean => {
  if (currencyFromBunqCode(code) !== undefined) {
    return false;
  }

  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) surface an account Kiko cannot represent so a dev can tell whether one is a user's real sync blocker
  console.warn('[bunq sync] skipping holding: unrepresentable currency', { code, id });

  return true;
};

const BUNQ_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/;

/**
 * CONFIRMED format (coordinator's live verification pass): a bunq
 * `Payment.created`/`updated` timestamp is `'YYYY-MM-DD HH:MM:SS.ffffff'`,
 * UTC. Returns `Number.NaN` on an unparseable value; a caller must never
 * persist a NaN time.
 */
const parseBunqTimestamp = (value: string): number => {
  const match = BUNQ_TIMESTAMP_PATTERN.exec(value);

  if (!match) {
    return Number.NaN;
  }

  const [, year, month, day, hour, minute, second, fraction] = match;
  const milliseconds = fraction ? Math.round(Number(`0.${fraction}`) * 1000) : 0;

  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    milliseconds,
  );
};

/**
 * FAIL CLOSED (Global Constraints): a malformed payment date or amount must
 * never silently persist a `NaN` `time`/`amountMinorUnits` — mirrors
 * PrivatBank's `mapStatementItem`. Throwing here lets the per-account fault
 * isolation in `runSyncInner` catch it: the account's whole run fails,
 * `institution` stays whatever it already was, and `sync_state.lastSyncAt`
 * never advances past the malformed item, so a retry re-covers it
 * idempotently once the underlying data (or this parser) is fixed.
 */
export const mapPaymentItem = (
  item: BunqPayment,
  holdingId: string,
  accountId: string,
  currency: Currency,
): NewTransaction => {
  const time = parseBunqTimestamp(item.created);

  if (Number.isNaN(time)) {
    throw new Error(
      i18n.t('accountDetail.invalidBunqPaymentDate', {
        accountId,
        itemId: String(item.id),
        value: item.created,
      }),
    );
  }

  const amountMajor = Number.parseFloat(item.amount.value);

  if (!Number.isFinite(amountMajor)) {
    throw new Error(
      i18n.t('accountDetail.invalidBunqPaymentAmount', {
        accountId,
        itemId: String(item.id),
        value: item.amount.value,
      }),
    );
  }

  return {
    holdingId,
    amountMinorUnits: Money.fromMajor(currency, amountMajor).minorUnits,
    time,
    description: item.description ?? '',
    counterIban: item.counterparty_alias?.iban ?? null,
    source: 'bunq',
    // NAMESPACED per connection, same rule as Monobank/PrivatBank (Global
    // Constraints): `${accountId}:${paymentId}` keeps the GLOBAL
    // `(source, external_id)` unique index disjoint across every connection
    // of every provider.
    externalId: `${accountId}:${item.id}`,
  };
};

export const mapAccountToHolding = (
  account: BunqMonetaryAccount,
  bunqAccountId: string,
): NewHolding => {
  const currency = currencyFromBunqCode(account.currency);

  if (!currency) {
    throw new Error(i18n.t('accountDetail.unsupportedBunqCurrency', { code: account.currency }));
  }

  // TODO(VERIFY LIVE): confirm the literal alias `type` value is exactly
  // 'IBAN' (see `BunqMonetaryAccount`'s own doc comment, `../bunq.types`).
  const iban = account.alias?.find((alias) => alias.type === 'IBAN')?.value;

  return {
    accountId: bunqAccountId,
    name: account.description ?? iban ?? String(account.id),
    type: 'card',
    currency,
    balanceMinorUnits: Money.fromMajor(currency, Number.parseFloat(account.balance.value))
      .minorUnits,
    metadata: { bunqId: String(account.id), iban },
  };
};

/** Metadata shape used to re-associate a synced holding with its source id. */
type HoldingMetadata = { bunqId?: string } | null;

const bunqIdOf = (metadata: unknown): string | undefined => (metadata as HoldingMetadata)?.bunqId;

const indexByBunqId = (holdings: HoldingRow[]): Map<string, HoldingRow> => {
  const map = new Map<string, HoldingRow>();

  for (const holding of holdings) {
    const bunqId = bunqIdOf(holding.metadata);

    if (bunqId !== undefined) {
      map.set(bunqId, holding);
    }
  }

  return map;
};

/**
 * Resolve the account this sync targets, WITHOUT writing anything — mirrors
 * `resolvePrivatbankAccountId`. With a `targetAccountId` (the Connect
 * action), validate the target exists and return it — the caller marks it
 * `institution: 'bunq'` only once `fetchMonetaryAccounts` has actually
 * succeeded (see `markBunqAccount`). Without one, reuse the FIRST connected
 * bunq account.
 */
const resolveBunqAccountId = async (deps: SyncDeps): Promise<string> => {
  const accounts = await deps.accountsRepo.listQuery();

  if (deps.targetAccountId !== undefined) {
    const target = accounts.find((account) => account.id === deps.targetAccountId);

    if (!target) {
      throw new Error(i18n.t('accountDetail.noBunqConnection'));
    }

    return deps.targetAccountId;
  }

  const existing = accounts.find((account) => account.institution === 'bunq');

  if (!existing) {
    throw new Error(i18n.t('accountDetail.noBunqConnection'));
  }

  return existing.id;
};

/**
 * Mark the account `institution: 'bunq'`. Called ONLY after
 * `fetchMonetaryAccounts` has resolved — mirrors `markPrivatbankAccount`'s
 * ordering, so a failed connect (an invalid API key, an offline device)
 * never leaves the account half-connected.
 */
const markBunqAccount = async (deps: SyncDeps, accountId: string): Promise<void> => {
  if (deps.targetAccountId !== undefined) {
    await deps.accountsRepo.update(accountId, { institution: 'bunq' });
  }
};

const upsertAllHoldings = async (
  deps: SyncDeps,
  accountId: string,
  accounts: BunqMonetaryAccount[],
): Promise<void> => {
  const holdings: BunqHolding[] = [];

  for (const account of accounts) {
    if (isUnrepresentableCurrency(account.currency, String(account.id))) {
      continue;
    }

    holdings.push({ ...mapAccountToHolding(account, accountId), bunqId: String(account.id) });
  }

  await deps.holdingsRepo.upsertBunqMany(holdings);
};

/**
 * Whether a cached session is still safely usable — see
 * `SESSION_REFRESH_MARGIN_MS`'s doc comment (`../client/bunq.client.ts`).
 */
const isSessionValid = (context: BunqContext, now: number): boolean =>
  context.sessionExpiresAt - SESSION_REFRESH_MARGIN_MS > now;

/**
 * Ensure a live bunq session for `accountId`, running only as much of the
 * handshake as is actually needed. CONFIRMED (coordinator's live
 * verification pass): `/session-server` has a far stricter rate limit
 * (~1 req/30s) than the read endpoints, so this must never re-run the FULL
 * handshake per sync:
 *  - a cached, still-valid session is reused as-is (no network call at all);
 *  - a cached session that has EXPIRED re-opens the session ONLY, reusing
 *    the already-registered installation token + keypair (no re-install, no
 *    re-registering the device);
 *  - with NO cached context at all (the first-ever connect), the full
 *    installation -> device-server -> session-server handshake runs once,
 *    threading each returned token into the next call, and the result is
 *    cached for every later sync.
 */
const ensureBunqContext = async (
  deps: SyncDeps,
  accountId: string,
  apiKey: string,
): Promise<BunqContext> => {
  const stored = await deps.readContext(accountId);

  if (stored && isSessionValid(stored, deps.now())) {
    return stored;
  }

  if (stored) {
    const session = await deps.openSession(
      {
        installationToken: stored.installationToken,
        apiKey,
        privateKeyPem: stored.privateKeyPem,
        crypto: deps.crypto,
      },
      deps.fetchImpl,
    );
    const refreshed: BunqContext = {
      ...stored,
      sessionToken: session.sessionToken,
      sessionExpiresAt: deps.now() + session.sessionTtlSeconds * 1000,
      userId: session.userId,
    };
    await deps.saveContext(accountId, refreshed);

    return refreshed;
  }

  const { installationToken, privateKeyPem, publicKeyPem } = await deps.installClient(
    deps.crypto,
    deps.fetchImpl,
  );
  const deviceId = await deps.registerDevice(installationToken, apiKey, deps.fetchImpl);
  const session = await deps.openSession(
    { installationToken, apiKey, privateKeyPem, crypto: deps.crypto },
    deps.fetchImpl,
  );
  const context: BunqContext = {
    privateKeyPem,
    publicKeyPem,
    installationToken,
    deviceId,
    sessionToken: session.sessionToken,
    sessionExpiresAt: deps.now() + session.sessionTtlSeconds * 1000,
    userId: session.userId,
  };
  await deps.saveContext(accountId, context);

  return context;
};

/**
 * Pull every payment for one bunq monetary account whose `created` is at or
 * after `sinceMs`, paging BACKWARD with bunq's `older_id` cursor.
 * CONFIRMED (coordinator's live verification pass): the payment list has NO
 * server-side date filter, so this client-side floor is the only thing that
 * bounds an incremental sync. Payments are read newest-first (each page's
 * `older_id` moves further into the past), so the FIRST payment older than
 * `sinceMs` means every later item on this page — and every later page — is
 * even older; the walk stops there rather than reading full history every
 * run. An UNPARSEABLE `created` is deliberately still collected (not
 * dropped) so `mapPaymentItem`'s fail-closed throw catches it downstream,
 * the same guarantee PrivatBank's own date parser gives a malformed
 * statement.
 *
 * FAIL CLOSED (Global Constraints): reaching `MAX_PAYMENT_PAGES` WITHOUT
 * ever reaching the incremental floor — bunq still reports older,
 * still-in-window payments beyond the cap — throws rather than returning
 * the partial set collected so far. Returning a truncated set here would
 * let `runSyncInner` treat the window as fully read and advance
 * `sync_state.lastSyncAt` past it, silently dropping the oldest in-window
 * payments with no retry ever covering them again. Throwing instead lets
 * the per-account fault isolation in `runSyncInner` catch it: the account's
 * run fails, `institution`/the cursor stay exactly as they were, and the
 * SAME window is retried idempotently next run — the same guarantee a
 * fetch failure or a malformed payment already gets.
 */
const fetchAllPaymentsSince = async (
  deps: SyncDeps,
  gate: RequestGate,
  session: BunqSession,
  bunqAccountId: string,
  sinceMs: number,
): Promise<BunqPayment[]> => {
  const collected: BunqPayment[] = [];
  let olderId: string | undefined;

  for (let page = 0; page < MAX_PAYMENT_PAGES; page += 1) {
    await gate.wait();

    const { payments, nextOlderId } = await deps.fetchPayments(
      session,
      bunqAccountId,
      deps.fetchImpl,
      olderId,
    );

    if (payments.length === 0) {
      return collected;
    }

    let reachedFloor = false;

    for (const payment of payments) {
      const createdAt = parseBunqTimestamp(payment.created);

      if (Number.isNaN(createdAt) || createdAt >= sinceMs) {
        collected.push(payment);
        continue;
      }

      reachedFloor = true;
      break;
    }

    if (reachedFloor || nextOlderId === undefined) {
      return collected;
    }

    olderId = nextOlderId;
  }

  throw new Error(
    i18n.t('accountDetail.bunqPaymentPageCapReached', {
      accountId: bunqAccountId,
      maxPages: MAX_PAYMENT_PAGES,
    }),
  );
};

/**
 * Fetch, map, and import one account's payments, then advance the shared
 * progress bar by one unit — extracted from `runSyncInner`'s loop so that
 * function stays under the project's cognitive-complexity budget (mirrors
 * `importPrivatbankAccount`). Returns the imported count; the caller
 * isolates a per-account failure.
 */
const importBunqAccount = async (
  deps: SyncDeps,
  gate: RequestGate,
  session: BunqSession,
  accountId: string,
  account: BunqMonetaryAccount,
  holding: HoldingRow,
  sinceMs: number,
): Promise<number> => {
  const currency = currencyFromBunqCode(account.currency);

  // Unreachable in practice — the caller already filters to representable
  // accounts only — but keeps `mapPaymentItem`'s `currency` argument
  // non-optional rather than asserted.
  if (!currency) {
    return 0;
  }

  const payments = await fetchAllPaymentsSince(deps, gate, session, String(account.id), sinceMs);
  const mapped = payments.map((payment) =>
    mapPaymentItem(payment, holding.id, accountId, currency),
  );

  if (mapped.length === 0) {
    return 0;
  }

  // The count is the repository's, not this list's length: a re-fetched
  // item refreshes an existing row rather than adding one.
  return deps.transactionsRepo.addManyDedup(mapped);
};

type SyncResult = { importedTransactions: number };

/**
 * Module-level PER-ACCOUNT single-flight lock — mirrors Monobank's
 * `inFlightSyncs`/PrivatBank's own. A small local `Map`, NOT shared with
 * either — the providers' account ids are disjoint, so nothing is gained by
 * sharing one map, and this keeps every engine fully independent per the
 * task's constraint not to touch Monobank's or PrivatBank's modules.
 */
const inFlightSyncs = new Map<string, Promise<SyncResult>>();

export const runSync = (overrides: Partial<SyncDeps> = {}): Promise<SyncResult> => {
  const key = overrides.targetAccountId ?? 'institution:bunq';
  const joined = inFlightSyncs.get(key);

  if (joined) {
    return joined;
  }

  // Enter the shared progress SESSION (reused cross-provider from
  // `src/monobank/sync-status`) the instant this run acquires the lock,
  // mirroring `runSync` in `src/privatbank/sync/sync.ts`.
  beginProgressSession();
  setFastPhaseDone(false);
  const run = runSyncInner(overrides);
  inFlightSyncs.set(key, run);
  const release = (): void => {
    if (inFlightSyncs.get(key) === run) {
      inFlightSyncs.delete(key);
    }

    endProgressSession();
    setFastPhaseDone(false);
  };

  run.then(release, release);
  return run;
};

const runSyncInner = async (overrides: Partial<SyncDeps> = {}): Promise<SyncResult> => {
  const deps: SyncDeps = { ...defaultDeps, ...overrides };

  // Resolve the target account FIRST — the API key is keyed by that account
  // id, so the account must be known before it can be read.
  const accountId = await resolveBunqAccountId(deps);
  // Ensure this connection's `sync_state` cursor row exists before any read
  // or setter below. Idempotent.
  await deps.syncStateRepo.ensure(accountId);

  const credentials = await deps.readApiKey(accountId);

  if (!credentials) {
    throw new Error(i18n.t('accountDetail.noBunqCredentials'));
  }

  // The handshake (or a cheap session-only refresh) — see
  // `ensureBunqContext`'s own doc comment for why this is NOT re-run in
  // full on every sync.
  const context = await ensureBunqContext(deps, accountId, credentials.apiKey);
  const session = { sessionToken: context.sessionToken, userId: context.userId };

  // ONE gate for this whole invocation's READ calls, shared by the
  // monetary-account call and every account's payment pages — mirrors
  // Monobank's/PrivatBank's per-run gate. The handshake's own, far
  // stricter rate limit is respected by CACHING the session instead
  // (`ensureBunqContext`), not by this gate.
  const gate = createRequestGate({
    intervalMs: BUNQ_RATE_LIMIT_MS,
    now: deps.now,
    sleep: deps.sleep,
  });

  await gate.wait();
  const accounts = await deps.fetchMonetaryAccounts(session, deps.fetchImpl);
  // Mark `institution: 'bunq'` ONLY after that fetch succeeded — never
  // before (Global Constraints' fail-closed rule).
  await markBunqAccount(deps, accountId);

  await upsertAllHoldings(deps, accountId, accounts);
  // The FAST phase is done: accounts are fetched and the balances are
  // committed — the pull-to-refresh spinner ends here, decoupled from the
  // slower per-account payment loop that follows.
  setFastPhaseDone(true);

  const holdingByBunqId = indexByBunqId(await deps.holdingsRepo.listByAccountQuery(accountId));

  const toSeconds = Math.floor(deps.now() / 1000);
  const lastSyncAt = await readLastSyncAt(deps, accountId);
  const fromSeconds = lastSyncAt
    ? Math.floor(lastSyncAt / 1000)
    : toSeconds - DEFAULT_LOOKBACK_SECONDS;
  const sinceMs = fromSeconds * 1000;

  // Deliberately simpler than Monobank (plan Phase 1, mirrored from
  // PrivatBank): EVERY representable account's payments are re-fetched
  // every run — no balance-diff skip, no changed-first queue, no
  // force-retry set, no full-fetch graduation.
  const representable = accounts.filter(
    (account) => !isUnrepresentableCurrency(account.currency, String(account.id)),
  );

  if (representable.length > 0) {
    registerWork(representable.length, representable.length);
  }

  let importedTransactions = 0;
  const failures: Error[] = [];

  for (const account of representable) {
    const holding = holdingByBunqId.get(String(account.id));

    if (!holding) {
      continue;
    }

    try {
      importedTransactions += await importBunqAccount(
        deps,
        gate,
        session,
        accountId,
        account,
        holding,
        sinceMs,
      );
      commitWork();
      commitHolding();
    } catch (error) {
      // Isolate a per-account failure: one account's transient 429/timeout
      // must not stop every LATER account in the same run from importing —
      // mirrors PrivatBank's per-account fault isolation. The failed
      // account's window is simply re-covered next run because the cursor
      // below never advances past a partial failure (fail-closed).
      failures.push(error instanceof Error ? error : new Error(String(error)));
      commitWork();
      commitHolding();
    }
  }

  if (failures.length > 0) {
    // Partial failure: do NOT advance the shared cursor, so the failed
    // account's window is re-covered on the next run. A re-fetch is
    // idempotent (the `(source, external_id)` upsert), so nothing already
    // imported is lost or re-imported.
    throw failures[0];
  }

  // The cursor is the ceiling this run actually QUERIED, not the clock at
  // loop end — mirrors Monobank/PrivatBank. Advanced ONLY on a fully clean
  // run.
  await deps.syncStateRepo.setLastSyncAt(accountId, toSeconds * 1000);

  return { importedTransactions };
};
