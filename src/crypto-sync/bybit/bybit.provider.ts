import { match } from 'ts-pattern';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { logFailure } from '@kiko/diagnostics';
import type { Currency } from '@kiko/currency/currency';
import either, { bifold, bifoldMap, isLeft } from 'fnts/either';
import { appearMinorUnitsOf } from '@kiko/crypto-sync/exchange/amounts';
import type { ExchangeStatePatch } from '@kiko/crypto-sync/exchange/walk-state';
import type { ExchangeCredentials } from '@kiko/crypto-sync/exchange/credentials';

import type { BalanceProvider, ProviderBalance } from '../provider';

import {
  type BybitFundCoin,
  type BybitReadOptions,
  BybitRefusalError,
  type BybitUnifiedCoin,
  fetchFundBalance,
  fetchKeyInfo,
  fetchUnifiedBalance,
} from './bybit.client';
import {
  type BybitWallet,
  bybitKeyOf,
  coinHoldingName,
  holdingKeyOf,
  partsOfHoldingKey,
} from './bybit.holding-keys';
import { isBybitCoolingDown } from './bybit.cooldown';
import { readBybitCredentials } from './bybit.credentials';
import { fundReadOf, unifiedReadOf, type WalletRead } from './bybit.balance-read';

type WalletFetch<Body> = (
  apiKey: string,
  secret: string,
  options?: BybitReadOptions,
) => Promise<Body>;

export type BybitDeps = {
  fetchImpl: typeof fetch;
  now: () => number;
  readCredentials: (accountId: string) => Promise<ExchangeCredentials | undefined>;
  fetchKeyInfo: WalletFetch<unknown>;
  fetchUnifiedBalance: WalletFetch<BybitUnifiedCoin[]>;
  fetchFundBalance: WalletFetch<BybitFundCoin[]>;
};

export const defaultBybitDeps: BybitDeps = {
  fetchImpl: fetch,
  now: () => Date.now(),
  readCredentials: readBybitCredentials,
  fetchKeyInfo,
  fetchUnifiedBalance,
  fetchFundBalance,
};

/** The Keychain holds no pair for the account, so no read can be signed. */
export class BybitNoCredentialsError extends Error {
  constructor() {
    super('Bybit credentials missing');
    this.name = 'BybitNoCredentialsError';
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that
    // `instanceof` relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, BybitNoCredentialsError.prototype);
  }
}

/**
 * What one tolerant wallet's attempt came to: its read, or a failure. A failure never writes a
 * holding for the wallet, a zero included. `refused` is set when Bybit refused the key for this
 * wallet (code 10005), which the account shows by name.
 */
type WalletOutcome = { kind: 'read'; read: WalletRead } | { kind: 'failed'; refused: boolean };

const isPermissionRefusal = (error: unknown): boolean =>
  error instanceof BybitRefusalError && error.refusal === 'permission';

const walletOutcome = async (
  wallet: BybitWallet,
  read: () => Promise<WalletRead>,
): Promise<WalletOutcome> => {
  const attempt = await either<unknown, WalletRead>(read);

  return bifoldMap(
    attempt,
    (error): WalletOutcome => {
      logFailure(`[bybit sync] skipped the ${wallet} wallet`, error);

      return { kind: 'failed', refused: isPermissionRefusal(error) };
    },
    (walletRead): WalletOutcome => ({ kind: 'read', read: walletRead }),
  );
};

const readOfOutcome = (outcome: WalletOutcome): WalletRead | undefined =>
  match(outcome)
    .returnType<WalletRead | undefined>()
    .with({ kind: 'read' }, ({ read }) => read)
    .with({ kind: 'failed' }, () => undefined)
    .exhaustive();

const refusedWalletsOf = (outcome: WalletOutcome, wallet: BybitWallet): BybitWallet[] =>
  match(outcome)
    .returnType<BybitWallet[]>()
    .with({ kind: 'failed', refused: true }, () => [wallet])
    .otherwise(() => []);

/**
 * The key check goes first. A key refused as expired fails the sync at once, since no read can
 * pass; any other failure of it is logged and tolerated, because the balance reads that follow
 * answer for themselves.
 */
const checkKey = async (
  deps: BybitDeps,
  apiKey: string,
  secret: string,
  options: BybitReadOptions,
): Promise<void> => {
  const attempt = await either<unknown, unknown>(() => deps.fetchKeyInfo(apiKey, secret, options));

  if (!isLeft(attempt)) {
    return;
  }

  const error: unknown = bifold(attempt);

  if (error instanceof BybitRefusalError && error.refusal === 'expired') {
    throw error;
  }

  logFailure('[bybit sync] the key check failed', error);
};

/** The `bybitAsset` match keys already present among a target's holdings. */
const existingBybitKeys = (holdings: HoldingRow[]): Set<string> =>
  new Set(holdings.flatMap((holding) => foldMap(maybe(bybitKeyOf(holding)), (key) => [key]) ?? []));

/** The coins that already have a holding in `wallet`. */
const heldCoinsOf = (wallet: BybitWallet, existingKeys: ReadonlySet<string>): Currency[] =>
  [...existingKeys].flatMap((key) => {
    const parts = partsOfHoldingKey(key);

    return parts?.wallet === wallet ? [parts.code] : [];
  });

const holdingOf = (
  currency: Currency,
  wallet: BybitWallet,
  balanceMinorUnits: number,
): ProviderBalance => ({
  currency,
  balanceMinorUnits,
  metadataKey: holdingKeyOf(currency, wallet),
  name: coinHoldingName(currency, wallet),
});

/**
 * One line per refused coin, so a holding left at a stale balance shows in the log. It names the
 * wallet only: the coin and its amount are the user's data, which the log never carries.
 */
const logRefusal = (wallet: BybitWallet): void => {
  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) a refused coin amount, wallet only
  console.warn('[bybit sync] a coin amount was refused', { wallet });
};

/**
 * Append one wallet's holdings to the batch, one per coin. Only a read that succeeded gets here:
 * a wallet whose read failed has no holding in the batch, so each stays at its last balance.
 * - coin REFUSED or BORROWED: omit that coin's holding alone, for the same reason.
 * - holding ALREADY exists: write it, a zero included, and a coin the good read does not list
 *   is a zero: a wallet the user emptied is zeroed, never left stale and never archived.
 * - no holding yet: write it only from the coin's dust threshold up.
 */
const appendWallet = (
  batch: ProviderBalance[],
  wallet: BybitWallet,
  read: WalletRead,
  existingKeys: ReadonlySet<string>,
): void => {
  const { balances, refused, borrowed } = read;
  const coins = new Set([...balances.keys(), ...heldCoinsOf(wallet, existingKeys)]);

  refused.forEach(() => {
    logRefusal(wallet);
  });

  for (const currency of [...coins].filter((coin) => !refused.has(coin) && !borrowed.has(coin))) {
    const balanceMinorUnits = balances.get(currency) ?? 0;

    if (
      existingKeys.has(holdingKeyOf(currency, wallet)) ||
      balanceMinorUnits >= appearMinorUnitsOf(currency)
    ) {
      batch.push(holdingOf(currency, wallet, balanceMinorUnits));
    }
  }
};

const sortedTickers = (tickers: readonly string[]): string[] => [...new Set(tickers)].sort();

type ReadWallets = {
  unified: WalletRead;
  /** Absent when the FUND read failed. */
  fund: WalletRead | undefined;
  /** The wallets Bybit refused the key for. */
  refused: BybitWallet[];
  syncedAt: number;
};

/**
 * The state writes of one read. Every list is written wallet by wallet: a wallet that read
 * replaces its own entries, and one that failed keeps its stored ones, plus the refused mark
 * when Bybit refused the key for it. The not-tracked list is replaced only by a read of both
 * wallets, since a failed wallet knows nothing of its coins.
 */
const statePatchesOf = ({
  unified,
  fund,
  refused,
  syncedAt,
}: ReadWallets): ExchangeStatePatch[] => {
  const untracked =
    foldMap(maybe(fund), (read): ExchangeStatePatch[] => [
      {
        kind: 'coinList',
        coins: 'untrackedCoins',
        list: 'balance',
        tickers: sortedTickers([...unified.untracked, ...read.untracked]),
      },
    ]) ?? [];

  return [
    ...untracked,
    {
      kind: 'oversizedBalance',
      wallets: {
        unified: sortedTickers([...unified.refused]),
        ...foldMap(maybe(fund), (read) => ({ fund: sortedTickers([...read.refused]) })),
      },
      complete: fund !== undefined,
    },
    {
      kind: 'balanceNotes',
      wallets: {
        unified: { borrowed: sortedTickers([...unified.borrowed]) },
        ...foldMap(maybe(fund), (read) => ({
          fund: { borrowed: sortedTickers([...read.borrowed]) },
        })),
      },
      refused,
    },
    { kind: 'balanceSyncedAt', value: syncedAt },
  ];
};

// The id joins `BalanceProviderId` when the provider is wired into the sync; until then the
// provider is typed by its own id.
export const bybitProvider: Omit<BalanceProvider<BybitDeps>, 'id'> & { id: 'bybit' } = {
  id: 'bybit',
  metadataField: 'bybitAsset',
  fetchBalances: async (deps, target) => {
    // Checked before even reading credentials, so a cooling account makes no request. Returning
    // no balances, never throwing, keeps the balance sync from failing on a cooldown that a walk
    // set.
    if (isBybitCoolingDown(target.accountId, deps.now())) {
      return { balances: [] };
    }

    const credentials = await deps.readCredentials(target.accountId);

    if (credentials === undefined) {
      throw new BybitNoCredentialsError();
    }

    const { apiKey, secret } = credentials;
    // The account is what a rate refusal puts in cooldown: a read without it still works and
    // only loses the cooldown, so every read below passes it.
    const options: BybitReadOptions = {
      fetchImpl: deps.fetchImpl,
      now: deps.now,
      accountId: target.accountId,
    };

    await checkKey(deps, apiKey, secret, options);

    // A rate refusal the check tolerated has cooled the account: the next read would break it.
    if (isBybitCoolingDown(target.accountId, deps.now())) {
      return { balances: [] };
    }

    // UNIFIED must succeed: it is the connection's proof of life, so its failure fails the sync
    // and nothing is written. A read that threw never gets past this line, so an empty list
    // below is a wallet that answered and holds nothing.
    const unified = unifiedReadOf(await deps.fetchUnifiedBalance(apiKey, secret, options));
    const fundOutcome = await walletOutcome('fund', async () =>
      fundReadOf(await deps.fetchFundBalance(apiKey, secret, options)),
    );
    const fund = readOfOutcome(fundOutcome);

    const balances: ProviderBalance[] = [];
    const existingKeys = existingBybitKeys(target.holdings);

    appendWallet(balances, 'unified', unified, existingKeys);

    if (fund !== undefined) {
      appendWallet(balances, 'fund', fund, existingKeys);
    }

    // The patches are returned, not written: the write needs the account marked as Bybit's,
    // which a first Connect does only after this read.
    return {
      balances,
      exchangeState: statePatchesOf({
        unified,
        fund,
        refused: refusedWalletsOf(fundOutcome, 'fund'),
        syncedAt: deps.now(),
      }),
    };
  },
};
