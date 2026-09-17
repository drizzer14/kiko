import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { holdingsRepo, type StarlingHolding } from '@kiko/holdings/repo';
import { syncStateRepo } from '@kiko/sync-state/sync-state.repo';
import { transactionsRepo } from '@kiko/transactions/repo';

import type { Currency } from '../../currency/currency';
import { isCurrency } from '../../currency/currency';
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
import { fetchAccounts, fetchBalance, fetchFeedChangedSince } from '../client';
import { readToken } from '../token';
import type { StarlingAccount, StarlingBalance, StarlingFeedItem } from '../starling.types';

type NewHolding = Pick<HoldingRow, 'accountId' | 'name' | 'type' | 'currency'> &
  Partial<Pick<HoldingRow, 'balanceMinorUnits' | 'metadata' | 'sortOrder'>>;

type NewTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time' | 'source'> &
  Partial<Pick<TransactionRow, 'description' | 'externalId'>>;

/**
 * Starling's per-token READ rate limit, in one named constant per the task
 * brief. VERIFIED (5 req/s) — TODO(VERIFY LIVE) on the exact figure
 * (verify-in-portal). The REAL binding constraint is a 1000-requests/DAY
 * cap, far stricter than this per-second pace: this engine relies on the
 * `changesSince` INCREMENTAL feed endpoint and must NEVER re-fetch a whole
 * account's history every sync, or a single backfill would burn the entire
 * daily budget in one run.
 */
const STARLING_RATE_LIMIT_MS = 250;
/** First-sync lookback when no previous sync timestamp is stored. */
const DEFAULT_LOOKBACK_MS = 31 * 24 * 60 * 60 * 1000;

/**
 * The `accountsRepo` methods the sync calls directly — mirrors
 * Monobank's/PrivatBank's/bunq's `SyncAccountsRepo`.
 */
interface SyncAccountsRepo {
  listQuery: () => PromiseLike<AccountRow[]>;
  update: (accountId: string, patch: Partial<AccountRow>) => Promise<unknown>;
}

/**
 * The `holdingsRepo` methods the sync calls directly. `upsertStarlingMany`
 * writes every account of one `/accounts` snapshot (with each account's
 * freshly fetched balance) in a SINGLE transaction, so the reactive
 * `holdings` callback fires ONCE for the fast phase rather than once per
 * account — mirrors Monobank's/PrivatBank's/bunq's own bulk upserts.
 */
interface SyncHoldingsRepo {
  listByAccountQuery: (accountId: string) => PromiseLike<HoldingRow[]>;
  upsertStarlingMany: (holdings: StarlingHolding[]) => Promise<unknown>;
}

/**
 * The `transactionsRepo` methods the sync calls directly. `addManyDedup`
 * resolves the number of rows actually INSERTED — a refreshed row is not
 * one.
 */
interface SyncTransactionsRepo {
  addManyDedup: (transactions: NewTransaction[]) => Promise<number>;
}

/** The sync_state columns this simplified engine reads — deliberately just the one cursor, mirroring PrivatBank's/bunq's Phase 1 engine. */
type SyncStateSnapshot = Pick<SyncStateRow, 'lastSyncAt'>;

/**
 * The `syncStateRepo` methods the sync calls directly. `ensure(accountId)`
 * creates the row if absent so a setter always has a row to update.
 * `setLastSyncAt` advances the `changesSince` cursor, ONLY on a fully clean
 * run (Global Constraints' fail-closed rule).
 */
interface SyncSyncStateRepo {
  getQuery: (accountId: string) => PromiseLike<SyncStateSnapshot[]>;
  ensure: (accountId: string) => Promise<unknown>;
  setLastSyncAt: (accountId: string, timestamp: number) => Promise<unknown>;
}

/**
 * The injectable seams of this pipeline — mirrors Monobank's/PrivatBank's/
 * bunq's `SyncDeps` shape (network, clock, delay, and the repos, all
 * injected so tests run instantly against fakes).
 */
export interface SyncDeps {
  fetchImpl: typeof fetch;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  /**
   * Read the PAT for the RESOLVED target account. The token is PER
   * CONNECTION (`serviceFor(accountId)` in `../token`), so `runSyncInner`
   * resolves the target account id FIRST, then reads its own token — one
   * connection's token can never gate or corrupt another's.
   */
  readToken: (accountId: string) => Promise<string | undefined>;
  fetchAccounts: (token: string, fetchImpl?: typeof fetch) => Promise<StarlingAccount[]>;
  fetchBalance: (
    token: string,
    accountUid: string,
    fetchImpl?: typeof fetch,
  ) => Promise<StarlingBalance>;
  fetchFeedChangedSince: (
    token: string,
    accountUid: string,
    categoryUid: string,
    changesSinceIso: string,
    fetchImpl?: typeof fetch,
  ) => Promise<StarlingFeedItem[]>;
  /**
   * The user-created account to (re)target this sync at. When set, the
   * account is marked `institution: 'starling'` once `fetchAccounts`
   * succeeds (see `markStarlingAccount`), and every synced holding lands
   * under it. When absent, the sync targets the already-connected Starling
   * account.
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
  fetchAccounts,
  fetchBalance,
  fetchFeedChangedSince,
  accountsRepo,
  holdingsRepo,
  transactionsRepo,
  syncStateRepo,
};

const readLastSyncAt = async (deps: SyncDeps, accountId: string): Promise<number | null> =>
  (await deps.syncStateRepo.getQuery(accountId)).at(0)?.lastSyncAt ?? null;

/**
 * Starling's currency mapping. CONFIRMED: an account's `currency` is an
 * alpha-ISO-4217 code (e.g. `'GBP'`), validated directly against the
 * `Currency` union — `undefined` for an unrepresentable currency, mirroring
 * `currencyFromPrivatbankCode`/`currencyFromBunqCode`.
 */
const currencyFromStarlingCode = (code: string): Currency | undefined =>
  isCurrency(code) ? code : undefined;

/**
 * A Starling account in a currency Kiko cannot represent is SILENTLY
 * EXCLUDED from net worth rather than crashing the whole sync — mirrors
 * PrivatBank's/bunq's `isUnrepresentableCurrency`.
 */
const isUnrepresentableCurrency = (code: string, id: string): boolean => {
  if (currencyFromStarlingCode(code) !== undefined) {
    return false;
  }

  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) surface an account Kiko cannot represent so a dev can tell whether one is a user's real sync blocker
  console.warn('[starling sync] skipping holding: unrepresentable currency', { code, id });

  return true;
};

const STARLING_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * CONFIRMED format: a Starling `transactionTime` is ISO 8601. Returns
 * `Number.NaN` on an unparseable value; a caller must never persist a NaN
 * time.
 */
const parseStarlingTime = (value: string): number => {
  if (!STARLING_TIME_PATTERN.test(value)) {
    return Number.NaN;
  }

  const time = Date.parse(value);

  return Number.isNaN(time) ? Number.NaN : time;
};

/**
 * FAIL CLOSED (Global Constraints): a malformed feed-item date or a
 * non-finite amount must never silently persist a `NaN`
 * `time`/`amountMinorUnits` — a NaN time corrupts every `ORDER BY time DESC`
 * read, and a NaN amount corrupts money parity. Throwing here propagates out
 * of `runSyncInner`: the whole run fails, `sync_state.lastSyncAt` never
 * advances past the malformed item, so a retry re-covers it idempotently
 * once the underlying data (or this parser) is fixed — a real ledger row is
 * never silently dropped.
 */
export const mapFeedItem = (
  item: StarlingFeedItem,
  holdingId: string,
  accountId: string,
): NewTransaction => {
  const time = parseStarlingTime(item.transactionTime);

  if (Number.isNaN(time)) {
    throw new Error(
      i18n.t('accountDetail.invalidStarlingFeedDate', {
        accountId,
        itemId: item.feedItemUid,
        value: item.transactionTime,
      }),
    );
  }

  if (!Number.isFinite(item.amount.minorUnits)) {
    throw new Error(
      i18n.t('accountDetail.invalidStarlingFeedAmount', {
        accountId,
        itemId: item.feedItemUid,
        value: String(item.amount.minorUnits),
      }),
    );
  }

  return {
    holdingId,
    // minorUnits is an INTEGER — maps straight onto Kiko's Money minor-units
    // model, NO decimal parsing. A negated `minorUnits` on an OUT payment
    // (the task brief's ONE named sign rule).
    amountMinorUnits: item.direction === 'OUT' ? -item.amount.minorUnits : item.amount.minorUnits,
    time,
    description: item.reference ?? item.counterPartyName ?? '',
    source: 'starling',
    // NAMESPACED per connection, same rule as every other native provider
    // (Global Constraints): `${accountId}:${feedItemUid}` keeps the GLOBAL
    // `(source, external_id)` unique index disjoint across every connection
    // of every provider.
    externalId: `${accountId}:${item.feedItemUid}`,
  };
};

/**
 * The holding balance is settled money ONLY — a ONE named choice (task
 * brief), kept as a one-line switch so a future change to
 * `effectiveBalance` (which additionally includes anything still pending)
 * is a single-line edit.
 */
const clearedBalanceMinorUnits = (balance: StarlingBalance): number =>
  balance.clearedBalance.minorUnits;

export const mapAccountToHolding = (
  account: StarlingAccount,
  starlingAccountId: string,
  balance: StarlingBalance,
): NewHolding => {
  const currency = currencyFromStarlingCode(account.currency);

  if (!currency) {
    throw new Error(
      i18n.t('accountDetail.unsupportedStarlingCurrency', { code: account.currency }),
    );
  }

  return {
    accountId: starlingAccountId,
    // The account name/IBAN are NOT in the `/accounts` response — they live
    // on a separate account-details/identifiers endpoint this v1 slice does
    // not call (TODO(VERIFY LIVE): fetch it for the real display name/IBAN
    // in a later slice). A sensible localized default stands in for now.
    name: i18n.t('accountDetail.starlingAccountName'),
    type: 'card',
    currency,
    balanceMinorUnits: clearedBalanceMinorUnits(balance),
    // `starlingCategory` is the feed's `categoryUid` — kept so a later run
    // can page this account's feed without re-fetching `/accounts`.
    metadata: { starlingCategory: account.defaultCategory },
  };
};

/** Metadata shape used to re-associate a synced holding with its source id. */
type HoldingMetadata = { starlingId?: string } | null;

const starlingIdOf = (metadata: unknown): string | undefined =>
  (metadata as HoldingMetadata)?.starlingId;

const indexByStarlingId = (holdings: HoldingRow[]): Map<string, HoldingRow> => {
  const map = new Map<string, HoldingRow>();

  for (const holding of holdings) {
    const starlingId = starlingIdOf(holding.metadata);

    if (starlingId !== undefined) {
      map.set(starlingId, holding);
    }
  }

  return map;
};

/**
 * Resolve the account this sync targets, WITHOUT writing anything — mirrors
 * `resolvePrivatbankAccountId`/`resolveBunqAccountId`. With a
 * `targetAccountId` (the Connect action), validate the target exists and
 * return it — the caller marks it `institution: 'starling'` only once
 * `fetchAccounts` has actually succeeded (see `markStarlingAccount`).
 * Without one, reuse the FIRST connected Starling account.
 */
const resolveStarlingAccountId = async (deps: SyncDeps): Promise<string> => {
  const accounts = await deps.accountsRepo.listQuery();

  if (deps.targetAccountId !== undefined) {
    const target = accounts.find((account) => account.id === deps.targetAccountId);

    if (!target) {
      throw new Error(i18n.t('accountDetail.noStarlingConnection'));
    }

    return deps.targetAccountId;
  }

  const existing = accounts.find((account) => account.institution === 'starling');

  if (!existing) {
    throw new Error(i18n.t('accountDetail.noStarlingConnection'));
  }

  return existing.id;
};

/**
 * Mark the account `institution: 'starling'`. Called ONLY after
 * `fetchAccounts` has resolved — mirrors `markPrivatbankAccount`'s/
 * `markBunqAccount`'s ordering, so a failed connect (a wrong token, an
 * offline device) never leaves the account half-connected.
 */
const markStarlingAccount = async (deps: SyncDeps, accountId: string): Promise<void> => {
  if (deps.targetAccountId !== undefined) {
    await deps.accountsRepo.update(accountId, { institution: 'starling' });
  }
};

/**
 * Fetch every representable account's balance and build its holding —
 * DELIBERATELY FLAT (no per-account fault isolation, the "simplest of the
 * four" per the task brief): a single account's balance-fetch failure
 * aborts the whole run rather than being caught and skipped, the same way a
 * `fetchAccounts` failure already does. The whole snapshot then upserts in
 * ONE `db.transaction()` (`upsertStarlingMany`), so nothing partial ever
 * commits.
 */
const fetchHoldingsForAccounts = async (
  deps: SyncDeps,
  gate: RequestGate,
  token: string,
  starlingAccountId: string,
  accounts: StarlingAccount[],
): Promise<StarlingHolding[]> => {
  const holdings: StarlingHolding[] = [];

  for (const account of accounts) {
    if (isUnrepresentableCurrency(account.currency, account.accountUid)) {
      continue;
    }

    await gate.wait();
    const balance = await deps.fetchBalance(token, account.accountUid, deps.fetchImpl);
    holdings.push({
      ...mapAccountToHolding(account, starlingAccountId, balance),
      starlingId: account.accountUid,
    });
  }

  return holdings;
};

/**
 * Fetch, filter to SETTLED, map, and import one account's feed since
 * `changesSinceIso`, then advance the shared progress bar by one unit —
 * extracted from `runSyncInner`'s loop so that function stays under the
 * project's cognitive-complexity budget (mirrors why Monobank's/
 * PrivatBank's/bunq's own loop bodies live in their own helpers).
 * DELIBERATELY FLAT — no per-account try/catch; a failure here propagates
 * straight out of `runSyncInner`, matching `fetchHoldingsForAccounts`
 * above.
 */
const importStarlingAccount = async (
  deps: SyncDeps,
  gate: RequestGate,
  token: string,
  accountId: string,
  account: StarlingAccount,
  holding: HoldingRow,
  changesSinceIso: string,
): Promise<number> => {
  await gate.wait();
  const items = await deps.fetchFeedChangedSince(
    token,
    account.accountUid,
    account.defaultCategory,
    changesSinceIso,
    deps.fetchImpl,
  );
  // Booked lines only — PENDING/DECLINED items are skipped, never mapped.
  const settled = items.filter((item) => item.status === 'SETTLED');
  const mapped = settled.map((item) => mapFeedItem(item, holding.id, accountId));

  if (mapped.length === 0) {
    return 0;
  }

  // The count is the repository's, not this list's length: a re-fetched
  // item refreshes an existing row rather than adding one.
  return deps.transactionsRepo.addManyDedup(mapped);
};

type SyncResult = { importedTransactions: number };

/**
 * Module-level PER-ACCOUNT single-flight lock — mirrors Monobank's/
 * PrivatBank's/bunq's own `inFlightSyncs`. A small local `Map`, NOT shared
 * with any of theirs: every provider's account ids are disjoint, so nothing
 * is gained by sharing one map, and this keeps every engine fully
 * independent per the task's constraint not to touch another provider's
 * module.
 */
const inFlightSyncs = new Map<string, Promise<SyncResult>>();

export const runSync = (overrides: Partial<SyncDeps> = {}): Promise<SyncResult> => {
  const key = overrides.targetAccountId ?? 'institution:starling';
  const joined = inFlightSyncs.get(key);

  if (joined) {
    return joined;
  }

  // Enter the shared progress SESSION (reused cross-provider from
  // `src/monobank/sync-status`) the instant this run acquires the lock,
  // mirroring `runSync` in `src/privatbank/sync/sync.ts`/`src/bunq/sync/sync.ts`.
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

  // Resolve the target account FIRST — the token is keyed by that account
  // id, so the account must be known before it can be read.
  const accountId = await resolveStarlingAccountId(deps);
  // Ensure this connection's `sync_state` cursor row exists before any read
  // or setter below. Idempotent.
  await deps.syncStateRepo.ensure(accountId);

  const token = await deps.readToken(accountId);

  if (!token) {
    throw new Error(i18n.t('accountDetail.noStarlingToken'));
  }

  // The run's own start time IS the new `changesSince` cursor (advanced only
  // on a fully clean run, below) — captured BEFORE any network call so a
  // change that lands mid-run is never missed by the next sync's window.
  const runStartMs = deps.now();

  // ONE gate for this whole invocation, shared by the accounts call, every
  // account's balance fetch, and every account's feed fetch — mirrors
  // Monobank's/PrivatBank's/bunq's per-run gate.
  const gate = createRequestGate({
    intervalMs: STARLING_RATE_LIMIT_MS,
    now: deps.now,
    sleep: deps.sleep,
  });

  await gate.wait();
  const accounts = await deps.fetchAccounts(token, deps.fetchImpl);
  // Mark `institution: 'starling'` ONLY after that fetch succeeded — never
  // before (Global Constraints' fail-closed rule).
  await markStarlingAccount(deps, accountId);

  const holdings = await fetchHoldingsForAccounts(deps, gate, token, accountId, accounts);
  await deps.holdingsRepo.upsertStarlingMany(holdings);
  // The FAST phase is done: accounts and balances are fetched and committed
  // — the pull-to-refresh spinner ends here, decoupled from the slower
  // per-account feed loop that follows.
  setFastPhaseDone(true);

  const holdingByStarlingId = indexByStarlingId(
    await deps.holdingsRepo.listByAccountQuery(accountId),
  );

  const lastSyncAt = await readLastSyncAt(deps, accountId);
  const changesSinceIso = lastSyncAt
    ? new Date(lastSyncAt).toISOString()
    : new Date(runStartMs - DEFAULT_LOOKBACK_MS).toISOString();

  const representable = accounts.filter(
    (account) => !isUnrepresentableCurrency(account.currency, account.accountUid),
  );

  if (representable.length > 0) {
    registerWork(representable.length, representable.length);
  }

  let importedTransactions = 0;

  for (const account of representable) {
    const holding = holdingByStarlingId.get(account.accountUid);

    if (!holding) {
      continue;
    }

    importedTransactions += await importStarlingAccount(
      deps,
      gate,
      token,
      accountId,
      account,
      holding,
      changesSinceIso,
    );
    commitWork();
    commitHolding();
  }

  // Advanced ONLY on a fully clean run — an earlier throw (a fetch failure,
  // a malformed feed item) propagates straight out of this function and
  // this line is never reached, leaving the cursor exactly where it was.
  await deps.syncStateRepo.setLastSyncAt(accountId, runStartMs);

  return { importedTransactions };
};
