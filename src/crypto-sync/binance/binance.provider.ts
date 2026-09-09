import { Money } from '../../currency/money';
import type { BalanceProvider } from '../provider';

import {
  type BinanceAccount,
  type BinanceBalance,
  type BinanceFlexiblePosition,
  type BinanceFundingAsset,
  type BinanceLockedPosition,
  type FetchAccountOptions,
  fetchAccount,
  fetchFlexiblePosition,
  fetchFundingAsset,
  fetchLockedPosition,
} from './binance.client';
import { type BinanceCredentials, readCredentials } from './binance.credentials';

type WalletFetch<Body> = (
  apiKey: string,
  secret: string,
  options?: FetchAccountOptions,
) => Promise<Body>;

export type BinanceDeps = {
  fetchImpl: typeof fetch;
  now: () => number;
  readCredentials: () => Promise<BinanceCredentials | undefined>;
  fetchAccount: WalletFetch<BinanceAccount>;
  fetchFundingAsset: WalletFetch<BinanceFundingAsset[]>;
  fetchFlexiblePosition: WalletFetch<BinanceFlexiblePosition>;
  fetchLockedPosition: WalletFetch<BinanceLockedPosition>;
};

export const defaultBinanceDeps: BinanceDeps = {
  fetchImpl: fetch,
  now: () => Date.now(),
  readCredentials,
  fetchAccount,
  fetchFundingAsset,
  fetchFlexiblePosition,
  fetchLockedPosition,
};

/** The only asset the sync reads; every other asset in every wallet is ignored. */
const BINANCE_ASSET = 'BTC';

/** Display name of the holding the first sync creates. */
const BINANCE_HOLDING_NAME = 'Binance BTC';

/**
 * Sum a set of decimal-string BTC amounts into satoshis. Each string is
 * converted on its own and added as `Money`, so no float addition happens before
 * rounding — a value already validated as finite by `isFiniteAmount`.
 */
const sumSatoshis = (amounts: string[]): number =>
  amounts.reduce(
    (total, amount) => total.add(Money.fromMajor(BINANCE_ASSET, Number(amount))),
    Money.of(BINANCE_ASSET, 0),
  ).minorUnits;

/**
 * Whether one amount is a usable decimal STRING. `Number('x')` is `NaN`, which
 * would flow straight into a `notNull` integer column, so a non-finite value is
 * rejected before it is summed.
 */
const isFiniteAmount = (value: unknown): boolean =>
  typeof value === 'string' && Number.isFinite(Number(value));

const isBTCEntry = (entry: unknown): boolean =>
  typeof entry === 'object' &&
  entry !== null &&
  (entry as { asset?: unknown }).asset === BINANCE_ASSET;

/**
 * Whether the parsed `/api/v3/account` body carries a usable balances array.
 *
 * `fetchAccount` returns the parsed 200 body with no runtime shape check, and a
 * missing/`(?? [])` balances array turned a malformed payload into a 0-satoshi
 * balance WRITTEN OVER the stored BTC holding — a fabricated number
 * indistinguishable from a real zero. Binance answers a throttled or
 * misconfigured request with a 200-plus-error-object often enough that this is a
 * real path, not a hypothetical one.
 */
const hasBalances = (body: unknown): body is { balances: unknown[] } =>
  typeof body === 'object' &&
  body !== null &&
  'balances' in body &&
  Array.isArray((body as { balances: unknown }).balances);

/** Whether a Simple Earn body carries a usable rows array (same guard rationale). */
const hasRows = (body: unknown): body is { rows: unknown[] } =>
  typeof body === 'object' &&
  body !== null &&
  'rows' in body &&
  Array.isArray((body as { rows: unknown }).rows);

/** Spot BTC satoshis: `free + locked` per BTC balance. Throws on a malformed body. */
const spotSatoshis = (account: BinanceAccount): number => {
  if (!hasBalances(account)) {
    throw new Error('Binance account response did not contain a balances array');
  }

  const btcBalances = account.balances.filter((balance): balance is BinanceBalance =>
    isBTCEntry(balance),
  );

  for (const balance of btcBalances) {
    if (!isFiniteAmount(balance.free) || !isFiniteAmount(balance.locked)) {
      throw new Error('Binance balance contained a non-numeric free/locked amount');
    }
  }

  return btcBalances.reduce((sum, balance) => sum + sumSatoshis([balance.free, balance.locked]), 0);
};

/** Funding BTC satoshis: `free + locked + freeze + withdrawing` per BTC row. */
const fundingSatoshis = (assets: BinanceFundingAsset[]): number => {
  if (!Array.isArray(assets)) {
    throw new Error('Binance funding response was not an array');
  }

  const btcAssets = assets.filter((asset): asset is BinanceFundingAsset => isBTCEntry(asset));

  for (const asset of btcAssets) {
    const fields = [asset.free, asset.locked, asset.freeze, asset.withdrawing];
    if (fields.some((field) => !isFiniteAmount(field))) {
      throw new Error('Binance funding balance contained a non-numeric amount');
    }
  }

  return btcAssets.reduce(
    (sum, asset) => sum + sumSatoshis([asset.free, asset.locked, asset.freeze, asset.withdrawing]),
    0,
  );
};

/**
 * Simple Earn BTC satoshis. A flexible position holds its BTC in `totalAmount`, a
 * locked one in `amount`; the caller names which field, the parse is otherwise
 * identical.
 */
const positionSatoshis = (
  body: { rows: unknown[] },
  amountField: 'totalAmount' | 'amount',
): number => {
  if (!hasRows(body)) {
    throw new Error('Binance simple-earn response did not contain a rows array');
  }

  const btcRows = body.rows.filter((row): row is Record<string, unknown> => isBTCEntry(row));

  for (const row of btcRows) {
    if (!isFiniteAmount(row[amountField])) {
      throw new Error('Binance simple-earn position contained a non-numeric amount');
    }
  }

  // `isFiniteAmount` above already proved each value is a finite decimal string,
  // so the cast is safe and no runtime `String()` conversion is needed.
  return btcRows.reduce((sum, row) => sum + sumSatoshis([row[amountField] as string]), 0);
};

/**
 * Run one non-Spot wallet's read and parse. Any failure — a missing API-key
 * permission, a throttle, a malformed body — SKIPS that wallet only (logging
 * which one) and contributes 0, so a single wallet never breaks the whole sync.
 * Spot is deliberately NOT wrapped: its failure must fail the sync.
 */
const skipOnError = async (wallet: string, satoshis: () => Promise<number>): Promise<number> => {
  try {
    return await satoshis();
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) one wallet's failure (a missing API-key permission, a throttle) must skip only that wallet, not break the whole Binance sync; log which one so a device log shows what was dropped.
    console.warn(`[binance sync] skipped the ${wallet} wallet`, error);

    return 0;
  }
};

export const binanceProvider: BalanceProvider<BinanceDeps> = {
  id: 'binance',
  kind: 'exchange',
  metadataField: 'binanceAsset',
  fetchBalances: async (deps) => {
    const credentials = await deps.readCredentials();

    if (credentials === undefined) {
      throw new Error('No Binance credentials stored; connect Binance before syncing');
    }

    const { apiKey, secret } = credentials;
    const options: FetchAccountOptions = { fetchImpl: deps.fetchImpl, now: deps.now };

    // Spot MUST succeed — its failure fails the whole Binance sync.
    const spot = spotSatoshis(await deps.fetchAccount(apiKey, secret, options));

    // Each additional wallet skips ONLY itself on any error, so Spot still lands.
    const funding = await skipOnError('funding', async () =>
      fundingSatoshis(await deps.fetchFundingAsset(apiKey, secret, options)),
    );
    const flexible = await skipOnError('flexible earn', async () =>
      positionSatoshis(await deps.fetchFlexiblePosition(apiKey, secret, options), 'totalAmount'),
    );
    const locked = await skipOnError('locked earn', async () =>
      positionSatoshis(await deps.fetchLockedPosition(apiKey, secret, options), 'amount'),
    );

    // All wallets' BTC is summed into ONE holding. Cross-wallet addition is plain
    // integer satoshis, so no float drift is possible here.
    const balanceMinorUnits = spot + funding + flexible + locked;

    return [
      {
        currency: 'BTC',
        balanceMinorUnits,
        metadataKey: BINANCE_ASSET,
        name: BINANCE_HOLDING_NAME,
      },
    ];
  },
};
