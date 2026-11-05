import { i18n } from '@kiko/i18n/init';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { logFailure } from '@kiko/diagnostics';
import type { Currency } from '@kiko/currency/currency';
import { syncedAtOf } from '@kiko/holdings/holding-metadata';
import { exchangeStateDepsOf } from '@kiko/crypto-sync/exchange/walk';
import { appearMinorUnitsOf } from '@kiko/crypto-sync/exchange/amounts';
import { keyExpiryOf } from '@kiko/crypto-sync/exchange/history-status';
import either, { bifold, bifoldMap, bifoldr, isLeft } from 'fnts/either';
import type { ExchangeCredentials } from '@kiko/crypto-sync/exchange/credentials';
import { type ExchangeStatePatch, parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';

import type { BalanceProvider, ProviderBalance } from '../provider';

import {
  type BybitFundCoin,
  type BybitKeyInfo,
  BybitRateLimitError,
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
import { bybitCoolingFailure, bybitFailureOf } from './bybit.failure-text';
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
  /** The end of the key the account's state holds, which a refusal is read against. */
  readExpiredAtMs: (accountId: string) => Promise<number | undefined>;
  fetchKeyInfo: WalletFetch<BybitKeyInfo>;
  fetchUnifiedBalance: WalletFetch<BybitUnifiedCoin[]>;
  fetchFundBalance: WalletFetch<BybitFundCoin[]>;
};

const readStoredExpiredAtMs = async (accountId: string): Promise<number | undefined> =>
  keyExpiryOf(parseExchangeState(await exchangeStateDepsOf('bybit').readExchangeState(accountId)))
    ?.expiredAtMs;

export const defaultBybitDeps: BybitDeps = {
  fetchImpl: fetch,
  now: () => Date.now(),
  readCredentials: readBybitCredentials,
  readExpiredAtMs: readStoredExpiredAtMs,
  fetchKeyInfo,
  fetchUnifiedBalance,
  fetchFundBalance,
};

/**
 * What one tolerant wallet's attempt came to: its read, or none on a failure. A failure never
 * writes a holding for the wallet, a zero included, and the account always says the wallet was not
 * read. `refused` is set when Bybit refused the key for this wallet (code 10005), which the
 * account shows with its cause; any other failure shows as a wallet not read.
 */
type WalletOutcome = { read?: WalletRead; refused: boolean };

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

      return { refused: isPermissionRefusal(error) };
    },
    (walletRead): WalletOutcome => ({ read: walletRead, refused: false }),
  );
};

/**
 * The key check goes first. A key refused as expired fails the sync at once, since no read can
 * pass, and shows as the localized text of its class. A rate refusal or a 403 fails it too: the
 * client has cooled the account, so no read follows, and a sync that returned no balance would
 * report success with its cause hidden. Any other failure of it is logged and tolerated, because
 * the balance reads that follow answer for themselves. A tolerated failure gives no key info, so
 * the stored end stays.
 */
const checkKey = async (
  deps: BybitDeps,
  apiKey: string,
  secret: string,
  options: BybitReadOptions,
): Promise<BybitKeyInfo | undefined> => {
  const attempt = await either<unknown, BybitKeyInfo>(() =>
    deps.fetchKeyInfo(apiKey, secret, options),
  );

  if (!isLeft(attempt)) {
    return bifoldr(attempt);
  }

  const error: unknown = bifold(attempt);

  if (
    error instanceof BybitRateLimitError ||
    (error instanceof BybitRefusalError && error.refusal === 'expired')
  ) {
    throw bybitFailureOf(error);
  }

  logFailure('[bybit sync] the key check failed', error);

  return undefined;
};

/** The `bybitAsset` match keys already present among a target's holdings. */
const existingBybitKeys = (holdings: HoldingRow[]): Set<string> =>
  new Set(holdings.flatMap((holding) => foldMap(maybe(bybitKeyOf(holding)), (key) => [key]) ?? []));

/** A holding with a Bybit key and the stamp of a read, which a disconnect drops. */
const isReadBybitHolding = (holding: HoldingRow): boolean =>
  bybitKeyOf(holding) !== undefined && syncedAtOf(holding.metadata) !== null;

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
 * - coin REFUSED, BORROWED or held for an OPEN ORDER: omit that coin's holding alone, for the same
 *   reason: a held coin keeps its last balance, and a coin with none gets none.
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
  const { balances, refused, borrowed, openOrder } = read;
  const coins = new Set([...balances.keys(), ...heldCoinsOf(wallet, existingKeys)]);
  const setAside = (coin: Currency): boolean =>
    refused.has(coin) || borrowed.has(coin) || openOrder.has(coin);

  refused.forEach(() => {
    logRefusal(wallet);
  });

  for (const currency of [...coins].filter((coin) => !setAside(coin))) {
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

/** The patch of a good key read, which replaces the stored end; a failed read gives none. */
const keyExpiryPatchesOf = (
  info: BybitKeyInfo | undefined,
  readAtMs: number,
): ExchangeStatePatch[] =>
  foldMap(maybe(info), ({ expiredAtMs, deadlineDay }): ExchangeStatePatch[] => [
    { kind: 'keyExpiry', expiredAtMs, deadlineDay, readAtMs },
  ]) ?? [];

type ReadWallets = {
  unified: WalletRead;
  /** Absent when the FUND read failed. */
  fund: WalletRead | undefined;
  /** The wallets Bybit refused the key for. */
  refused: BybitWallet[];
  /** The wallets whose read failed for any other reason. */
  notRead: BybitWallet[];
  /** Absent when the key check failed, so the stored end stays. */
  keyInfo: BybitKeyInfo | undefined;
  syncedAt: number;
};

/**
 * The state writes of one read. Every note is written wallet by wallet: a wallet that read
 * replaces its own entry, the coins it could not read too, and one that failed keeps its stored
 * one, plus the mark of its cause: refused when Bybit refused the key for it, else not read. No
 * oversized list is written: a refused coin is a note, so the text can say why. The not-tracked
 * list is replaced only by a read of both wallets, since a failed wallet knows nothing of its
 * coins.
 */
const statePatchesOf = ({
  unified,
  fund,
  refused,
  notRead,
  keyInfo,
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
      kind: 'balanceNotes',
      wallets: {
        unified: {
          borrowed: [...unified.borrowed],
          openOrder: [...unified.openOrder],
          refusedCoins: [...unified.refused],
        },
        ...foldMap(maybe(fund), (read) => ({
          fund: { borrowed: [...read.borrowed], refusedCoins: [...read.refused] },
        })),
      },
      refused,
      notRead,
    },
    ...keyExpiryPatchesOf(keyInfo, syncedAt),
    { kind: 'balanceSyncedAt', value: syncedAt },
  ];
};

export const bybitProvider: BalanceProvider<BybitDeps> = {
  id: 'bybit',
  metadataField: 'bybitAsset',
  datesBalance: true,
  fetchBalances: async (deps, target) => {
    // Checked before even reading credentials, so a cooling account makes no request. An account
    // with a stamped Bybit holding returns no balances, never throwing, so a later sync inside the
    // cooldown leaves its stamp and balances as they were. With no stamp, nothing proves a read of
    // Bybit: an empty answer would let a first connect that the cooldown stopped report success
    // with no text, so it fails with the refusal's text instead. A disconnect keeps the holdings
    // and drops their stamp, so a kept one proves no read of the key stored now.
    if (isBybitCoolingDown(target.accountId, deps.now())) {
      if (!target.holdings.some(isReadBybitHolding)) {
        throw bybitCoolingFailure();
      }

      return { balances: [] };
    }

    const credentials = await deps.readCredentials(target.accountId);

    if (credentials === undefined) {
      throw new Error(i18n.t('accountDetail.noBybitCredentials'));
    }

    const { apiKey, secret } = credentials;
    const expiredAtMs = await deps.readExpiredAtMs(target.accountId);
    // The account is what a rate refusal puts in cooldown: a read without it still works and
    // only loses the cooldown, so every read below passes it. The stored end of the key turns a
    // refusal that says only "no" past that end into the expired class.
    const options: BybitReadOptions = {
      fetchImpl: deps.fetchImpl,
      now: deps.now,
      accountId: target.accountId,
      ...foldMap(maybe(expiredAtMs), (value) => ({ expiredAtMs: value })),
    };

    const keyInfo = await checkKey(deps, apiKey, secret, options);

    // UNIFIED must succeed: it is the connection's proof of life, so its failure fails the sync
    // and nothing is written. A read that threw never gets past this line, so an empty list
    // below is a wallet that answered and holds nothing.
    const unified = unifiedReadOf(
      await deps.fetchUnifiedBalance(apiKey, secret, options).catch((error: unknown) => {
        throw bybitFailureOf(error);
      }),
    );
    const fundOutcome = await walletOutcome('fund', async () =>
      fundReadOf(await deps.fetchFundBalance(apiKey, secret, options)),
    );
    const { read: fund } = fundOutcome;

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
        refused: fundOutcome.refused ? ['fund'] : [],
        notRead: fund === undefined && !fundOutcome.refused ? ['fund'] : [],
        keyInfo,
        syncedAt: deps.now(),
      }),
    };
  },
};
