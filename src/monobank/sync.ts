import { pipe } from 'fnts';

import type { AccountRow, HoldingRow, TransactionRow } from '../db/schema';
import { accountsRepo } from '../repositories/accounts.repo';
import { holdingsRepo } from '../repositories/holdings.repo';
import { settingsRepo } from '../repositories/settings.repo';
import { transactionsRepo } from '../repositories/transactions.repo';
import { currencyFromCode } from './currency-code';
import { fetchClientInfo, fetchStatement } from './monobank.client';
import type { MonobankAccount, MonobankJar, MonobankStatementItem } from './monobank.types';
import { readToken } from './token';

type NewHolding = Pick<HoldingRow, 'accountId' | 'name' | 'type' | 'currency'> &
  Partial<Pick<HoldingRow, 'balanceMinorUnits' | 'metadata' | 'sortOrder'>>;

type MonobankHolding = NewHolding & { monobankId: string };

type NewTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time' | 'source'> &
  Partial<Pick<TransactionRow, 'description' | 'category' | 'mcc' | 'comment' | 'externalId'>>;

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
    jars: MonobankJar[];
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
   * is marked `institution: 'monobank'` and every synced holding lands under
   * it. When absent, the sync targets the already-connected Monobank account.
   */
  targetAccountId?: string;
  listAccounts: () => Promise<AccountRow[]>;
  updateAccount: (accountId: string, patch: Partial<AccountRow>) => Promise<unknown>;
  listHoldingsByAccount: (accountId: string) => Promise<HoldingRow[]>;
  upsertHolding: (holding: MonobankHolding) => Promise<unknown>;
  listTransactionsByHolding: (holdingId: string) => Promise<TransactionRow[]>;
  addTransactions: (transactions: NewTransaction[]) => Promise<unknown>;
  ensureSettings: () => Promise<unknown>;
  getLastSyncAt: () => Promise<number | null>;
  setLastSyncAt: (timestamp: number) => Promise<unknown>;
}

const defaultDeps: SyncDeps = {
  fetchImpl: fetch,
  now: () => Date.now(),
  sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  readToken,
  fetchClientInfo,
  fetchStatement,
  listAccounts: async () => accountsRepo.listQuery(),
  updateAccount: (accountId, patch) => accountsRepo.update(accountId, patch),
  listHoldingsByAccount: async accountId => holdingsRepo.listByAccountQuery(accountId),
  upsertHolding: holding => holdingsRepo.upsertMonobank(holding),
  listTransactionsByHolding: async holdingId => transactionsRepo.listByHoldingQuery(holdingId),
  addTransactions: transactions => transactionsRepo.addManyDedup(transactions),
  ensureSettings: () => settingsRepo.ensure(),
  getLastSyncAt: async () => (await settingsRepo.getQuery()).at(0)?.lastSyncAt ?? null,
  setLastSyncAt: timestamp => settingsRepo.setLastSyncAt(timestamp),
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
    throw new Error(`Unsupported Monobank currency code: ${account.currencyCode}`);
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
    throw new Error(`Unsupported Monobank currency code: ${jar.currencyCode}`);
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
 * Resolve the account this sync writes into. With a `targetAccountId`, mark
 * that user-created account `institution: 'monobank'` (the Connect action) and
 * return it. Without one, reuse the already-connected Monobank account. If
 * neither is available there is nothing to sync into — the new model requires
 * the user to create and connect an account first, so we surface a clear error
 * rather than silently minting a stray 'Monobank' account.
 */
const ensureMonobankAccount = async (deps: SyncDeps): Promise<string> => {
  const accounts = await deps.listAccounts();
  if (deps.targetAccountId !== undefined) {
    const target = accounts.find(account => account.id === deps.targetAccountId);
    if (!target) {
      throw new Error('No Monobank account connected');
    }
    // The personal Monobank API is a single connection: at most one account may
    // be institution=monobank at a time. Re-connecting the SAME account is an
    // idempotent re-sync and stays allowed; a DIFFERENT already-connected
    // account is rejected so its cards/jars are never imported twice (which
    // would double-count net worth).
    const otherConnected = accounts.find(
      account => account.institution === 'monobank' && account.id !== deps.targetAccountId,
    );
    if (otherConnected) {
      throw new Error('A Monobank account is already connected');
    }
    await deps.updateAccount(deps.targetAccountId, { institution: 'monobank' });
    return deps.targetAccountId;
  }
  const existing = accounts.find(account => account.institution === 'monobank');
  if (!existing) {
    throw new Error('No Monobank account connected');
  }
  return existing.id;
};

const upsertHoldings = async (
  deps: SyncDeps,
  accountId: string,
  accounts: MonobankAccount[],
  jars: MonobankJar[],
): Promise<void> => {
  for (const account of accounts) {
    await deps.upsertHolding({
      ...mapAccountToHolding(account, accountId),
      monobankId: account.id,
    });
  }
  for (const jar of jars) {
    await deps.upsertHolding({ ...mapJarToHolding(jar, accountId), monobankId: jar.id });
  }
};

/**
 * Pull every statement item for one bank account within [fromSeconds,
 * toSeconds], honouring the API's 31-day window, 500-item cap and 1-req/60s
 * rate limit. Monobank returns items newest-first, so when a response hits
 * the cap we narrow the ceiling to just before the earliest item and keep
 * paging backwards; otherwise we step to the previous 31-day window.
 */
const fetchAllStatements = async (
  deps: SyncDeps,
  token: string,
  monobankAccountId: string,
  fromSeconds: number,
  toSeconds: number,
): Promise<MonobankStatementItem[]> => {
  const collected: MonobankStatementItem[] = [];
  let windowTo = toSeconds;
  let isFirstRequest = true;
  while (windowTo > fromSeconds) {
    const windowFrom = Math.max(fromSeconds, windowTo - MAX_WINDOW_SECONDS);
    if (!isFirstRequest) {
      await deps.sleep(RATE_LIMIT_MS);
    }
    isFirstRequest = false;
    const items = await deps.fetchStatement(
      token,
      encodeURIComponent(monobankAccountId),
      windowFrom,
      windowTo,
      deps.fetchImpl,
    );
    collected.push(...items);
    const hitCap = items.length >= MAX_ITEMS_PER_RESPONSE;
    windowTo = hitCap ? Math.min(...items.map(item => item.time)) - 1 : windowFrom - 1;
  }
  return collected;
};

const freshTransactions = (
  items: MonobankStatementItem[],
  holdingId: string,
  existing: TransactionRow[],
): NewTransaction[] => {
  const knownExternalIds = new Set(existing.map(transaction => transaction.externalId));
  const buildFresh = pipe(
    (list: MonobankStatementItem[]) => list.map(item => mapStatementItem(item, holdingId)),
    (mapped: NewTransaction[]) =>
      mapped.filter(transaction => !knownExternalIds.has(transaction.externalId ?? null)),
  );
  return buildFresh(items);
};

const importAccount = async (
  deps: SyncDeps,
  token: string,
  accountId: string,
  account: MonobankAccount,
  fromSeconds: number,
  toSeconds: number,
): Promise<number> => {
  const holdings = await deps.listHoldingsByAccount(accountId);
  const holding = holdings.find(candidate => monobankIdOf(candidate.metadata) === account.id);
  if (!holding) {
    return 0;
  }
  const items = await fetchAllStatements(deps, token, account.id, fromSeconds, toSeconds);
  const existing = await deps.listTransactionsByHolding(holding.id);
  const fresh = freshTransactions(items, holding.id, existing);
  if (fresh.length > 0) {
    await deps.addTransactions(fresh);
  }
  return fresh.length;
};

export const runSync = async (
  overrides: Partial<SyncDeps> = {},
): Promise<{ importedTransactions: number }> => {
  const deps: SyncDeps = { ...defaultDeps, ...overrides };
  const token = await deps.readToken();
  if (!token) {
    throw new Error('No Monobank token found; connect an account before syncing');
  }

  await deps.ensureSettings();
  const accountId = await ensureMonobankAccount(deps);
  const { accounts, jars } = await deps.fetchClientInfo(token, deps.fetchImpl);
  await upsertHoldings(deps, accountId, accounts, jars);

  const toSeconds = Math.floor(deps.now() / 1000);
  const lastSyncAt = await deps.getLastSyncAt();
  const fromSeconds = lastSyncAt
    ? Math.floor(lastSyncAt / 1000)
    : toSeconds - DEFAULT_LOOKBACK_SECONDS;

  let importedTransactions = 0;
  for (const account of accounts) {
    importedTransactions += await importAccount(
      deps,
      token,
      accountId,
      account,
      fromSeconds,
      toSeconds,
    );
  }

  await deps.setLastSyncAt(deps.now());
  return { importedTransactions };
};
