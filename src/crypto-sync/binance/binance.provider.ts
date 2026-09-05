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

export const binanceProvider: BalanceProvider<BinanceDeps> = {
  id: 'binance',
  kind: 'exchange',
  metadataField: 'binanceAsset',
  fetchBalances: async (deps) => {
    const credentials = await deps.readCredentials();

    if (credentials === undefined) {
      throw new Error('No Binance credentials stored; connect Binance before syncing');
    }

    const account = await deps.fetchAccount(credentials.apiKey, credentials.secret, {
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
    // `fetchAccount` returns the parsed 200 body without a runtime shape check, so
    // `balances` can be absent on an unexpected payload; default to empty (0 sat).
    const balanceMinorUnits = (account.balances ?? [])
      .filter(isBTCBalance)
      .reduce((sum, balance) => sum + toSatoshis(balance), 0);

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
