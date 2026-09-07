import { Money } from '../../currency/money';
import type { BalanceProvider } from '../provider';

import {
  type BinanceAccount,
  type BinanceBalance,
  type FetchAccountOptions,
  fetchAccount,
} from './binance.client';
import { type BinanceCredentials, readCredentials } from './binance.credentials';

export type BinanceDeps = {
  fetchImpl: typeof fetch;
  now: () => number;
  readCredentials: () => Promise<BinanceCredentials | undefined>;
  fetchAccount: (
    apiKey: string,
    secret: string,
    options?: FetchAccountOptions,
  ) => Promise<BinanceAccount>;
};

export const defaultBinanceDeps: BinanceDeps = {
  fetchImpl: fetch,
  now: () => Date.now(),
  readCredentials,
  fetchAccount,
};

/** The only asset this milestone reads; every other `balances[]` entry is ignored. */
const BINANCE_ASSET = 'BTC';

/** Display name of the holding the first sync creates. */
const BINANCE_HOLDING_NAME = 'Binance BTC';

const isBTCBalance = (balance: BinanceBalance): boolean => balance.asset === BINANCE_ASSET;

// `free` and `locked` are decimal strings. Each is converted to satoshis on its
// own and summed as Money, so no float addition happens before rounding.
const toSatoshis = (balance: BinanceBalance): number =>
  Money.fromMajor('BTC', Number(balance.free)).add(Money.fromMajor('BTC', Number(balance.locked)))
    .minorUnits;

/**
 * Whether the parsed `/api/v3/account` body carries a usable balances array.
 *
 * `fetchAccount` returns the parsed 200 body with no runtime shape check, and
 * `(account.balances ?? [])` turned a malformed payload into a 0-satoshi
 * balance that was WRITTEN OVER the stored BTC holding — a fabricated number
 * indistinguishable from a real zero. Binance answers a throttled or
 * misconfigured request with a 200-plus-error-object often enough that this is
 * a real path, not a hypothetical one.
 */
const hasBalances = (body: unknown): body is { balances: unknown[] } =>
  typeof body === 'object' &&
  body !== null &&
  'balances' in body &&
  Array.isArray((body as { balances: unknown }).balances);

/**
 * Whether one balances entry is a usable BTC row. `free`/`locked` arrive as
 * decimal STRINGS; `Number('x')` is `NaN`, which `toSatoshis` propagated
 * straight into a `notNull` integer column.
 */
const isFiniteAmount = (value: unknown): boolean =>
  typeof value === 'string' && Number.isFinite(Number(value));

export const binanceProvider: BalanceProvider<BinanceDeps> = {
  id: 'binance',
  kind: 'exchange',
  metadataField: 'binanceAsset',
  fetchBalances: async (deps) => {
    const credentials = await deps.readCredentials();

    if (credentials === undefined) {
      throw new Error('No Binance credentials stored; connect Binance before syncing');
    }

    const account: unknown = await deps.fetchAccount(credentials.apiKey, credentials.secret, {
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });

    if (!hasBalances(account)) {
      throw new Error('Binance account response did not contain a balances array');
    }

    const btcBalances = account.balances.filter(
      (balance): balance is BinanceBalance =>
        typeof balance === 'object' && balance !== null && isBTCBalance(balance as BinanceBalance),
    );

    for (const balance of btcBalances) {
      if (!isFiniteAmount(balance.free) || !isFiniteAmount(balance.locked)) {
        throw new Error('Binance balance contained a non-numeric free/locked amount');
      }
    }

    const balanceMinorUnits = btcBalances.reduce((sum, balance) => sum + toSatoshis(balance), 0);

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
