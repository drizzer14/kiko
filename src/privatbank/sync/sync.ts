import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { holdingsRepo, type PrivatbankHolding } from '@kiko/holdings/repo';
import { syncStateRepo } from '@kiko/sync-state/sync-state.repo';
import { transactionsRepo } from '@kiko/transactions/repo';

import { type Currency, currencyScale, isCurrency } from '../../currency/currency';
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
import { fetchAccounts, fetchStatement, type RequestOptions } from '../client';
import { readCredentials } from '../credentials';
import type {
  PrivatbankAccount,
  PrivatbankStatementItem,
  PrivatbankStatementPage,
} from '../privatbank.types';

type NewHolding = Pick<HoldingRow, 'accountId' | 'name' | 'type' | 'currency'> &
  Partial<Pick<HoldingRow, 'balanceMinorUnits' | 'metadata' | 'sortOrder'>>;

type NewTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time' | 'source'> &
  Partial<Pick<TransactionRow, 'description' | 'counterIban' | 'externalId'>>;

/**
 * VERIFIED (task-6 brief, official AutoClient doc): the statement endpoint
 * has NO documented max date-range window — paging within one window is
 * driven by the response's `followId`/`exist_next_page` cursor (see
 * `fetchAllStatements` below), not a date cap. This 31-day value is
 * therefore kept only as this client's own PAGING CHUNK SIZE (how wide a
 * single window's [from, to] span is before this engine steps to the next
 * chunk), reusing Monobank's ceiling as a reasonable default — not a
 * confirmed AutoClient limit, and not something the API enforces.
 */
const MAX_WINDOW_SECONDS = 31 * 24 * 60 * 60;
/**
 * PrivatBank's per-credential rate limit, in one named constant per the task
 * brief. VERIFIED (official AutoClient doc): no more than 1 request per
 * second. This is a stated RECOMMENDATION, not a hard 429 cap — the bounded
 * `PrivatbankRateLimitError` retry wrapper (`src/privatbank/client/`) stays
 * as the safety net for whatever the server actually enforces.
 */
const PRIVATBANK_RATE_LIMIT_MS = 1_000;
/** First-sync lookback when no previous sync timestamp is stored. */
const DEFAULT_LOOKBACK_SECONDS = MAX_WINDOW_SECONDS;
/**
 * Statement page-follow backstop PER WINDOW CHUNK, AND a FAIL-CLOSED
 * data-completeness boundary — not merely an infinite-loop guard. Mirrors
 * bunq's `MAX_PAYMENT_PAGES` (`src/bunq/sync/sync.ts`): reaching this cap
 * while `exist_next_page` is still `true` is a genuine data-completeness
 * failure, so `fetchAllStatements` THROWS rather than returning a truncated
 * set — see that function's own doc comment.
 */
const MAX_STATEMENT_PAGES = 50;
/**
 * Balance-envelope page-follow backstop — task-6 brief: "If the balance
 * envelope also paginates via exist_next_page, page it the same way." A
 * lower cap than `MAX_STATEMENT_PAGES` because a balance listing (one row
 * per connected account) is expected to be far smaller than a transaction
 * history.
 */
const MAX_BALANCE_PAGES = 20;

/**
 * The `accountsRepo` methods the sync calls directly — mirrors Monobank's
 * `SyncAccountsRepo`.
 */
interface SyncAccountsRepo {
  listQuery: () => PromiseLike<AccountRow[]>;
  update: (accountId: string, patch: Partial<AccountRow>) => Promise<unknown>;
}

/**
 * The `holdingsRepo` methods the sync calls directly. `upsertPrivatbankMany`
 * writes every account of one AutoClient snapshot in a SINGLE transaction, so
 * the reactive `holdings` callback fires ONCE for the fast phase rather than
 * once per account — mirrors Monobank's `upsertMonobankMany`.
 */
interface SyncHoldingsRepo {
  listByAccountQuery: (accountId: string) => PromiseLike<HoldingRow[]>;
  upsertPrivatbankMany: (holdings: PrivatbankHolding[]) => Promise<unknown>;
}

/**
 * The `transactionsRepo` methods the sync calls directly. `addManyDedup`
 * resolves the number of rows actually INSERTED — a refreshed row is not
 * one.
 */
interface SyncTransactionsRepo {
  addManyDedup: (transactions: NewTransaction[]) => Promise<number>;
}

/** The sync_state columns this simplified engine reads. Deliberately just the
 * one cursor — no `lastFullSyncAt`/`failedSyncMonobankIds` equivalent, since
 * this engine has no full-fetch graduation or force-retry set (plan Phase 1:
 * "deliberately simpler"). */
type SyncStateSnapshot = Pick<SyncStateRow, 'lastSyncAt'>;

/**
 * The `syncStateRepo` methods the sync calls directly. `ensure(accountId)`
 * creates the row if absent so a setter always has a row to update.
 * `setLastSyncAt` advances the statement cursor, ONLY on a fully clean run
 * (Global Constraints' fail-closed rule).
 */
interface SyncSyncStateRepo {
  getQuery: (accountId: string) => PromiseLike<SyncStateSnapshot[]>;
  ensure: (accountId: string) => Promise<unknown>;
  setLastSyncAt: (accountId: string, timestamp: number) => Promise<unknown>;
}

/**
 * The injectable seams of this pipeline — mirrors Monobank's `SyncDeps`
 * shape (network, clock, delay, and the repos, all injected so tests run
 * instantly against fakes). `readCredentials`/`fetchAccounts`/`fetchStatement`
 * now take a plain `string` token (task-6 brief: the AutoClient credential is
 * a SINGLE `token` header, not a `{ token, clientId }` pair).
 */
export interface SyncDeps {
  fetchImpl: typeof fetch;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  /**
   * Read the token for the RESOLVED target account. The token is PER
   * CONNECTION (`serviceFor(accountId)` in `../credentials`), so
   * `runSyncInner` resolves the target account id FIRST, then reads its own
   * token — one connection's credentials can never gate or corrupt
   * another's.
   */
  readCredentials: (accountId: string) => Promise<string | undefined>;
  fetchAccounts: (
    token: string,
    fetchImpl?: typeof fetch,
    options?: RequestOptions,
  ) => ReturnType<typeof fetchAccounts>;
  fetchStatement: (
    token: string,
    accountId: string,
    fromSeconds: number,
    toSeconds: number,
    fetchImpl?: typeof fetch,
    options?: RequestOptions,
  ) => Promise<PrivatbankStatementPage>;
  /**
   * The user-created account to (re)target this sync at. When set, the
   * account is marked `institution: 'privatbank'` once `fetchAccounts`
   * succeeds (see `markPrivatbankAccount`), and every synced holding lands
   * under it. When absent, the sync targets the already-connected PrivatBank
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
  readCredentials,
  fetchAccounts,
  fetchStatement,
  accountsRepo,
  holdingsRepo,
  transactionsRepo,
  syncStateRepo,
};

const readLastSyncAt = async (deps: SyncDeps, accountId: string): Promise<number | null> =>
  (await deps.syncStateRepo.getQuery(accountId)).at(0)?.lastSyncAt ?? null;

/**
 * PrivatBank's currency mapping — validated directly against the `Currency`
 * union, `undefined` for an unrepresentable currency (mirrors
 * `isUnrepresentableCurrency` in `src/monobank/sync/sync.ts`).
 */
const currencyFromPrivatbankCode = (code: string): Currency | undefined =>
  isCurrency(code) ? code : undefined;

/**
 * A PrivatBank account in a currency Kiko cannot represent is SILENTLY
 * EXCLUDED from net worth rather than crashing the whole sync — mirrors
 * Monobank's `isUnrepresentableCurrency`.
 */
const isUnrepresentableCurrency = (code: string, id: string): boolean => {
  if (currencyFromPrivatbankCode(code) !== undefined) {
    return false;
  }

  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) surface an account Kiko cannot represent so a dev can tell whether one is a user's real sync blocker
  console.warn('[privatbank sync] skipping holding: unrepresentable currency', { code, id });

  return true;
};

const STATEMENT_DATETIME_PATTERN = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/;

/**
 * Kyiv's assumed UTC offset for `monthIndex` (0-indexed): EEST (+3h, summer
 * DST) April through October, EET (+2h, standard) the rest of the year — a
 * MONTH-boundary approximation of Ukraine's EU-aligned DST calendar (the
 * real transition falls on the last Sunday of March/October), not an
 * exact-day-and-hour calculation. See the module-tree's single
 * `TODO(VERIFY LIVE)` in `client/privatbank.client.ts`'s `requestOnce` — the
 * exact timezone `DATE_TIME_DAT_OD_TIM_P` is reported in is still
 * unconfirmed against a live response.
 */
const kyivOffsetHoursForMonth = (monthIndex: number): number =>
  monthIndex >= 3 && monthIndex <= 9 ? 3 : 2;

/**
 * VERIFIED format (task-6 brief): a statement's `DATE_TIME_DAT_OD_TIM_P` is
 * `'DD.MM.YYYY HH:MM:SS'` (DOTS — distinct from the request's own
 * `startDate`/`endDate`, which use dashes). Assumed Kyiv LOCAL time — see
 * `kyivOffsetHoursForMonth`'s own doc comment. Returns `Number.NaN` on an
 * unparseable value; a caller must never persist a NaN time.
 */
const parsePrivatbankDateTime = (value: string): number => {
  const match = STATEMENT_DATETIME_PATTERN.exec(value);

  if (!match) {
    return Number.NaN;
  }

  const [, day, month, year, hour, minute, second] = match;
  const monthIndex = Number(month) - 1;
  const offsetHours = kyivOffsetHoursForMonth(monthIndex);

  return Date.UTC(
    Number(year),
    monthIndex,
    Number(day),
    Number(hour) - offsetHours,
    Number(minute),
    Number(second),
  );
};

const DECIMAL_AMOUNT_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Convert PrivatBank's decimal-string MAJOR-units amount (`SUM`/`balance`)
 * to integer minor units WITHOUT floating-point multiplication — per the
 * task brief ("never parseFloat"), this is string-integer math only: pad or
 * truncate the fractional part to the currency's own decimal scale, then
 * read the concatenated whole+fraction digits as one integer.
 * `Money.fromMajor` (`src/currency/money/money.ts`) is not reused here
 * because it multiplies a FLOAT by the scale factor — an acceptable
 * precision for values Monobank/bunq already hand over as JS numbers, but
 * not the byte-for-byte guarantee this decimal STRING deserves. Returns
 * `undefined` on anything that is not a plain (optionally signed) decimal
 * number string.
 */
const parseDecimalMajorToMinorUnits = (value: string, currency: Currency): number | undefined => {
  const match = DECIMAL_AMOUNT_PATTERN.exec(value.trim());

  if (!match) {
    return undefined;
  }

  const [, sign, whole, fraction = ''] = match;
  const scale = currencyScale[currency];
  const fractionDigits = fraction.padEnd(scale, '0').slice(0, scale);
  const minorUnits = Number(`${sign}${whole}${fractionDigits}`);

  return Number.isFinite(minorUnits) ? minorUnits : undefined;
};

/**
 * VERIFIED (task-6 brief): `REF`+`REFN` together are the doc's confirmed
 * unique dedup key — `ID` is also present as a fallback but unused here.
 */
const dedupKey = (item: PrivatbankStatementItem): string => `${item.REF}${item.REFN}`;

/**
 * FAIL CLOSED (Global Constraints): a malformed statement date or amount
 * must never silently persist a `NaN` `time`/`amountMinorUnits` — a NaN time
 * corrupts every `ORDER BY time DESC` read, and a NaN amount corrupts money
 * parity. Throwing here (rather than skipping the item) lets the per-account
 * fault isolation in `runSyncInner` catch it: the account's whole run fails,
 * `institution` stays whatever it already was, and `sync_state.lastSyncAt`
 * never advances past the malformed window, so a retry re-covers it
 * idempotently once the underlying data (or this parser) is fixed — a real
 * ledger row is never silently dropped.
 */
export const mapStatementItem = (
  item: PrivatbankStatementItem,
  holdingId: string,
  accountId: string,
  currency: Currency,
): NewTransaction => {
  const time = parsePrivatbankDateTime(item.DATE_TIME_DAT_OD_TIM_P);

  if (Number.isNaN(time)) {
    throw new Error(
      i18n.t('accountDetail.invalidPrivatbankStatementDate', {
        accountId,
        itemId: dedupKey(item),
        value: item.DATE_TIME_DAT_OD_TIM_P,
      }),
    );
  }

  const magnitude = parseDecimalMajorToMinorUnits(item.SUM, currency);

  if (magnitude === undefined) {
    throw new Error(
      i18n.t('accountDetail.invalidPrivatbankStatementAmount', {
        accountId,
        itemId: dedupKey(item),
        value: item.SUM,
      }),
    );
  }

  // VERIFIED (task-6 brief): the sign comes from TRANTYPE ('C' credit/+, 'D'
  // debit/-), NEVER from SUM itself — SUM is an unsigned magnitude.
  const amountMinorUnits = item.TRANTYPE === 'D' ? -Math.abs(magnitude) : Math.abs(magnitude);

  return {
    holdingId,
    amountMinorUnits,
    time,
    description: item.OSND ?? '',
    counterIban: item.AUT_CNTR_ACC ?? null,
    source: 'privatbank',
    // NAMESPACED per connection, same rule as Monobank (Global Constraints):
    // `${accountId}:${REF}${REFN}` keeps the GLOBAL `(source, external_id)`
    // unique index disjoint across every connection of every provider.
    externalId: `${accountId}:${dedupKey(item)}`,
  };
};

export const mapAccountToHolding = (
  account: PrivatbankAccount,
  privatbankAccountId: string,
): NewHolding => {
  const currency = currencyFromPrivatbankCode(account.CCY);

  if (!currency) {
    throw new Error(i18n.t('accountDetail.unsupportedPrivatbankCurrency', { code: account.CCY }));
  }

  const balanceMinorUnits = parseDecimalMajorToMinorUnits(account.balance, currency);

  // FAIL CLOSED (Global Constraints, "no fabricated balance"): an
  // unparseable balance must never silently persist as 0 — throw, exactly
  // like a malformed statement item, so the per-account fault isolation in
  // `runSyncInner` freezes the cursor instead of writing a wrong balance.
  if (balanceMinorUnits === undefined) {
    throw new Error(
      i18n.t('accountDetail.invalidPrivatbankBalanceAmount', {
        accountId: privatbankAccountId,
        acc: account.acc,
        value: account.balance,
      }),
    );
  }

  return {
    accountId: privatbankAccountId,
    // No friendly account name is modeled on `PrivatbankAccount` (see its
    // own doc comment) — every holding is named after its account number.
    name: account.acc,
    type: 'card',
    currency,
    balanceMinorUnits,
    metadata: { privatbankId: account.acc, iban: account.acc },
  };
};

/** Metadata shape used to re-associate a synced holding with its source id. */
type HoldingMetadata = { privatbankId?: string } | null;

const privatbankIdOf = (metadata: unknown): string | undefined =>
  (metadata as HoldingMetadata)?.privatbankId;

const indexByPrivatbankId = (holdings: HoldingRow[]): Map<string, HoldingRow> => {
  const map = new Map<string, HoldingRow>();

  for (const holding of holdings) {
    const privatbankId = privatbankIdOf(holding.metadata);

    if (privatbankId !== undefined) {
      map.set(privatbankId, holding);
    }
  }

  return map;
};

/**
 * Resolve the account this sync targets, WITHOUT writing anything — mirrors
 * `resolveMonobankAccountId`. With a `targetAccountId` (the Connect action),
 * validate the target exists and return it — the caller marks it
 * `institution: 'privatbank'` only once `fetchAccounts` has actually
 * succeeded (see `markPrivatbankAccount`). Without one, reuse the FIRST
 * connected PrivatBank account.
 */
const resolvePrivatbankAccountId = async (deps: SyncDeps): Promise<string> => {
  const accounts = await deps.accountsRepo.listQuery();

  if (deps.targetAccountId !== undefined) {
    const target = accounts.find((account) => account.id === deps.targetAccountId);

    if (!target) {
      throw new Error(i18n.t('accountDetail.noPrivatbankConnection'));
    }

    return deps.targetAccountId;
  }

  const existing = accounts.find((account) => account.institution === 'privatbank');

  if (!existing) {
    throw new Error(i18n.t('accountDetail.noPrivatbankConnection'));
  }

  return existing.id;
};

/**
 * Mark the account `institution: 'privatbank'`. Called ONLY after
 * `fetchAccounts` has resolved — mirrors `markMonobankAccount`'s ordering,
 * so a failed connect (a wrong token, an offline device) never leaves the
 * account half-connected.
 */
const markPrivatbankAccount = async (deps: SyncDeps, accountId: string): Promise<void> => {
  if (deps.targetAccountId !== undefined) {
    await deps.accountsRepo.update(accountId, { institution: 'privatbank' });
  }
};

const upsertAllHoldings = async (
  deps: SyncDeps,
  accountId: string,
  accounts: PrivatbankAccount[],
): Promise<void> => {
  const holdings: PrivatbankHolding[] = [];

  for (const account of accounts) {
    if (isUnrepresentableCurrency(account.CCY, account.acc)) {
      continue;
    }

    holdings.push({ ...mapAccountToHolding(account, accountId), privatbankId: account.acc });
  }

  await deps.holdingsRepo.upsertPrivatbankMany(holdings);
};

/**
 * Pull every balance entry from `/api/statements/balance`, following
 * `next_page_id` as the next request's `followId` WHILE `exist_next_page`
 * stays `true` — task-6 brief: "If the balance envelope also paginates via
 * exist_next_page, page it the same way [as the statement endpoint]."
 *
 * FAIL CLOSED (Global Constraints, mirrors `fetchAllStatements` below): a
 * page that reports more items (`exist_next_page: true`) but carries no
 * `next_page_id` to follow, or a run that exhausts `MAX_BALANCE_PAGES`
 * before `exist_next_page` goes false, THROWS rather than silently treating
 * the page(s) collected so far as the complete balance listing — that would
 * let the caller mark `institution` and commit a partial, wrong net-worth
 * snapshot.
 */
const fetchAllAccounts = async (
  deps: SyncDeps,
  gate: RequestGate,
  token: string,
): Promise<PrivatbankAccount[]> => {
  const collected: PrivatbankAccount[] = [];
  let followId: string | undefined;

  for (let page = 0; page < MAX_BALANCE_PAGES; page += 1) {
    await gate.wait();

    const response = await deps.fetchAccounts(token, deps.fetchImpl, { followId });

    collected.push(...response.balances);

    if (!response.exist_next_page) {
      return collected;
    }

    if (response.next_page_id === undefined) {
      throw new Error(i18n.t('accountDetail.privatbankBalancePageTruncated'));
    }

    followId = response.next_page_id;
  }

  throw new Error(
    i18n.t('accountDetail.privatbankBalancePageCapReached', { maxPages: MAX_BALANCE_PAGES }),
  );
};

/**
 * Pull every statement item for one PrivatBank account within [fromSeconds,
 * toSeconds], chunked at `MAX_WINDOW_SECONDS` per request (the simplified
 * engine's own paging-chunk-size choice, unrelated to a real API limit — see
 * `MAX_WINDOW_SECONDS`'s own doc comment). WITHIN each chunk, REAL
 * PAGINATION follows `next_page_id` as the next request's `followId` WHILE
 * `exist_next_page` stays `true` (task-6 brief — this replaces the interim
 * fail-closed throw a previous review pass added here).
 *
 * FAIL CLOSED (Global Constraints, mirrors bunq's `fetchAllPaymentsSince`
 * page-cap throw): a page that reports more items (`exist_next_page: true`)
 * but carries no `next_page_id` to follow CANNOT be safely continued —
 * treating it as the whole window would let the caller advance
 * `sync_state.lastSyncAt` past data this run never actually read, silently
 * dropping it forever. The same is true of exhausting
 * `MAX_STATEMENT_PAGES` while `exist_next_page` is still `true` — a genuine
 * data-completeness failure, not a benign stop. Both THROW rather than
 * returning a truncated set: the per-account fault isolation in
 * `runSyncInner` catches it, the cursor never advances, and the SAME window
 * is retried idempotently next run.
 */
const fetchAllStatements = async (
  deps: SyncDeps,
  gate: RequestGate,
  token: string,
  privatbankAccountId: string,
  fromSeconds: number,
  toSeconds: number,
): Promise<PrivatbankStatementItem[]> => {
  const collected: PrivatbankStatementItem[] = [];
  let windowFrom = fromSeconds;

  while (windowFrom < toSeconds) {
    const windowTo = Math.min(toSeconds, windowFrom + MAX_WINDOW_SECONDS);
    let followId: string | undefined;

    for (let page = 0; ; page += 1) {
      if (page >= MAX_STATEMENT_PAGES) {
        throw new Error(
          i18n.t('accountDetail.privatbankStatementPageCapReached', {
            accountId: privatbankAccountId,
            maxPages: MAX_STATEMENT_PAGES,
          }),
        );
      }

      await gate.wait();

      const statementPage = await deps.fetchStatement(
        token,
        privatbankAccountId,
        windowFrom,
        windowTo,
        deps.fetchImpl,
        { followId },
      );

      collected.push(...statementPage.transactions);

      if (!statementPage.exist_next_page) {
        break;
      }

      if (statementPage.next_page_id === undefined) {
        throw new Error(
          i18n.t('accountDetail.privatbankStatementPageTruncated', {
            accountId: privatbankAccountId,
          }),
        );
      }

      followId = statementPage.next_page_id;
    }

    windowFrom = windowTo;
  }

  return collected;
};

/**
 * Fetch, map, and import one account's statement items, then advance the
 * shared progress bar by one unit — extracted from `runSyncInner`'s loop so
 * that function stays under the project's cognitive-complexity budget
 * (mirrors why Monobank's own loop body lives in `fetchCardWithProgress`).
 * Returns the imported count; the caller isolates a per-account failure.
 */
const importPrivatbankAccount = async (
  deps: SyncDeps,
  gate: RequestGate,
  token: string,
  accountId: string,
  account: PrivatbankAccount,
  holding: HoldingRow,
  fromSeconds: number,
  toSeconds: number,
): Promise<number> => {
  const currency = currencyFromPrivatbankCode(account.CCY);

  // Unreachable in practice — the caller already filters to representable
  // accounts only — but keeps `mapStatementItem`'s `currency` argument
  // non-optional rather than asserted.
  if (!currency) {
    return 0;
  }

  const items = await fetchAllStatements(deps, gate, token, account.acc, fromSeconds, toSeconds);
  const mapped = items.map((item) => mapStatementItem(item, holding.id, accountId, currency));

  if (mapped.length === 0) {
    return 0;
  }

  // The count is the repository's, not this list's length: a re-fetched item
  // refreshes an existing row rather than adding one.
  return deps.transactionsRepo.addManyDedup(mapped);
};

type SyncResult = { importedTransactions: number };

/**
 * Module-level PER-ACCOUNT single-flight lock — mirrors Monobank's
 * `inFlightSyncs`. A small local `Map`, NOT shared with Monobank's: the two
 * providers' account ids are disjoint, so nothing is gained by sharing one
 * map, and this keeps the two engines fully independent per the task's
 * constraint not to touch Monobank's module.
 */
const inFlightSyncs = new Map<string, Promise<SyncResult>>();

export const runSync = (overrides: Partial<SyncDeps> = {}): Promise<SyncResult> => {
  const key = overrides.targetAccountId ?? 'institution:privatbank';
  const joined = inFlightSyncs.get(key);

  if (joined) {
    return joined;
  }

  // Enter the shared progress SESSION (reused cross-provider from
  // `src/monobank/sync-status`, already shared with Binance) the instant this
  // run acquires the lock, mirroring `runSync` in `src/monobank/sync/sync.ts`.
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

  // Resolve the target account FIRST — the credential pair is keyed by that
  // account id, so the account must be known before it can be read.
  const accountId = await resolvePrivatbankAccountId(deps);
  // Ensure this connection's `sync_state` cursor row exists before any read
  // or setter below. Idempotent.
  await deps.syncStateRepo.ensure(accountId);

  const token = await deps.readCredentials(accountId);

  if (!token) {
    throw new Error(i18n.t('accountDetail.noPrivatbankCredentials'));
  }

  // ONE gate for this whole invocation, shared by the balance call and
  // every account's statement pages — mirrors Monobank's per-run gate.
  const gate = createRequestGate({
    intervalMs: PRIVATBANK_RATE_LIMIT_MS,
    now: deps.now,
    sleep: deps.sleep,
  });

  const accounts = await fetchAllAccounts(deps, gate, token);
  // Mark `institution: 'privatbank'` ONLY after that fetch succeeded — never
  // before (Global Constraints' fail-closed rule).
  await markPrivatbankAccount(deps, accountId);

  await upsertAllHoldings(deps, accountId, accounts);
  // The FAST phase is done: accounts are fetched and the balances are
  // committed — the pull-to-refresh spinner ends here, decoupled from the
  // slower per-account statement loop that follows.
  setFastPhaseDone(true);

  const holdingByPrivatbankId = indexByPrivatbankId(
    await deps.holdingsRepo.listByAccountQuery(accountId),
  );

  const toSeconds = Math.floor(deps.now() / 1000);
  const lastSyncAt = await readLastSyncAt(deps, accountId);
  const fromSeconds = lastSyncAt
    ? Math.floor(lastSyncAt / 1000)
    : toSeconds - DEFAULT_LOOKBACK_SECONDS;

  // Deliberately simpler than Monobank (plan Phase 1): EVERY representable
  // account's statements are re-fetched every run — no balance-diff skip, no
  // changed-first queue, no force-retry set, no full-fetch graduation.
  const representable = accounts.filter(
    (account) => !isUnrepresentableCurrency(account.CCY, account.acc),
  );

  if (representable.length > 0) {
    registerWork(representable.length, representable.length);
  }

  let importedTransactions = 0;
  const failures: Error[] = [];

  for (const account of representable) {
    const holding = holdingByPrivatbankId.get(account.acc);

    if (!holding) {
      continue;
    }

    try {
      importedTransactions += await importPrivatbankAccount(
        deps,
        gate,
        token,
        accountId,
        account,
        holding,
        fromSeconds,
        toSeconds,
      );
      commitWork();
      commitHolding();
    } catch (error) {
      // Isolate a per-account failure: one account's transient 429/timeout
      // must not stop every LATER account in the same run from importing —
      // mirrors Monobank's per-card fault isolation. The failed account's
      // window is simply re-covered next run because the cursor below never
      // advances past a partial failure (fail-closed).
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
  // loop end — mirrors Monobank. Advanced ONLY on a fully clean run.
  await deps.syncStateRepo.setLastSyncAt(accountId, toSeconds * 1000);

  return { importedTransactions };
};
