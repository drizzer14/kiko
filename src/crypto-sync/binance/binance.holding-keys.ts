import { match, P } from 'ts-pattern';
import type { HoldingRow } from '@kiko/db';
import type { Currency } from '@kiko/currency/currency';

import { isTrackedBinanceAsset } from './binance.tracked-coin';

/**
 * Match keys stored under `metadata.binanceAsset`, one holding per Binance
 * wallet. Spot REUSES the legacy 'BTC' key that the pre-split single aggregated
 * holding used, so the first post-split sync UPDATES that existing row in place
 * into the Spot holding (matched by `upsertByMetadataKey`) — no orphan, no
 * duplicate. Funding and Earn are new keys, so they are created fresh. Earn is
 * the Flexible + Locked positions COMBINED into one holding.
 */
export const SPOT_KEY = 'BTC';
export const FUNDING_KEY = 'BTC:funding';
export const EARN_KEY = 'BTC:earn';

export type BinanceWalletKey = typeof SPOT_KEY | typeof FUNDING_KEY | typeof EARN_KEY;

/**
 * Default display names for the holdings a sync creates. 'Binance' and its
 * wallet names are brand terms, read the same in every language, and each name
 * is user-editable after creation — an upsert never rewrites it, so a renamed
 * holding keeps its name.
 */
export const WALLET_HOLDING_NAMES: Record<BinanceWalletKey, string> = {
  [SPOT_KEY]: 'Binance Spot',
  [FUNDING_KEY]: 'Binance Funding',
  [EARN_KEY]: 'Binance Earn',
};

export type BinanceWallet = 'spot' | 'funding' | 'earn';

/**
 * The open key form of one (coin, wallet) holding: `<CODE>`, `<CODE>:funding`, `<CODE>:earn`. It
 * yields the three BTC constants above for BTC, so a stored BTC holding keeps matching.
 */
export const holdingKeyOf = (code: Currency, wallet: BinanceWallet): string =>
  wallet === 'spot' ? code : `${code}:${wallet}`;

type HoldingKeyParts = { code: Currency; wallet: BinanceWallet };

/** The coin and wallet a stored key names; a key `holdingKeyOf` never makes names none. */
export const partsOfHoldingKey = (key: string): HoldingKeyParts | undefined =>
  match(key.split(':'))
    .with([P.when(isTrackedBinanceAsset)], ([code]): HoldingKeyParts => ({ code, wallet: 'spot' }))
    .with(
      [P.when(isTrackedBinanceAsset), P.union('funding', 'earn')],
      ([code, wallet]): HoldingKeyParts => ({ code, wallet }),
    )
    .otherwise(() => undefined);

const WALLET_LABELS: Record<BinanceWallet, string> = {
  spot: 'Spot',
  funding: 'Funding',
  earn: 'Earn',
};

/** The default name of a holding the sync creates for a coin: "Binance Spot · USDT". */
export const coinHoldingName = (code: Currency, wallet: BinanceWallet): string =>
  `Binance ${WALLET_LABELS[wallet]} · ${code}`;

/** The `metadata.binanceAsset` key stored on a holding, if any. */
export const binanceKeyOf = (holding: Pick<HoldingRow, 'metadata'>): string | undefined => {
  const key = (holding.metadata as { binanceAsset?: unknown } | null)?.binanceAsset;

  return typeof key === 'string' ? key : undefined;
};
