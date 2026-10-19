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

const BINANCE_WALLETS = ['spot', 'funding', 'earn'] as const;

export type BinanceWallet = (typeof BINANCE_WALLETS)[number];

/** What follows the code in a holding key, per wallet: a Spot key is the bare code. */
const KEY_SUFFIX: Record<BinanceWallet, string> = {
  spot: '',
  funding: ':funding',
  earn: ':earn',
};

const keyOf = (code: string, wallet: BinanceWallet): string => `${code}${KEY_SUFFIX[wallet]}`;

/**
 * The open key form of one (coin, wallet) holding: `<CODE>`, `<CODE>:funding`, `<CODE>:earn`. It
 * yields the three BTC constants above for BTC, so a stored BTC holding keeps matching.
 */
export const holdingKeyOf = (code: Currency, wallet: BinanceWallet): string => keyOf(code, wallet);

/**
 * The id the legs of one move of one coin share, from the id Binance gives the move. Two coins
 * can share that id, and deleting a leg deletes its pair, so a coin other than BTC adds its code;
 * a BTC pair keeps the id every stored BTC pair already has.
 */
export const exchangePairIdOf = (binanceId: string, code: Currency): string =>
  code === SPOT_KEY ? binanceId : `${binanceId}:${code}`;

type HoldingKeyParts = { code: Currency; wallet: BinanceWallet };

/** The coin and wallet a stored key names; a key `holdingKeyOf` never makes names none. */
export const partsOfHoldingKey = (key: string): HoldingKeyParts | undefined => {
  const [code = ''] = key.split(':');
  const wallet = BINANCE_WALLETS.find((candidate) => keyOf(code, candidate) === key);

  if (wallet === undefined || !isTrackedBinanceAsset(code)) {
    return undefined;
  }

  return { code, wallet };
};

const WALLET_LABELS: Record<BinanceWallet, string> = {
  spot: 'Spot',
  funding: 'Funding',
  earn: 'Earn',
};

/**
 * The default name of a holding the sync creates for a coin: "Binance Spot · USDT". 'Binance' and
 * its wallet names are brand terms, read the same in every language, and each name is
 * user-editable after creation: an upsert never rewrites it, except the once-per-holding rename
 * from `PREVIOUS_BTC_HOLDING_NAMES`.
 */
export const coinHoldingName = (code: Currency, wallet: BinanceWallet): string =>
  `Binance ${WALLET_LABELS[wallet]} · ${code}`;

/**
 * The default names earlier releases gave each wallet's BTC holding, so a stored holding that
 * still carries one on its first sync is renamed to its `coinHoldingName`; the upsert marks the
 * holding then, so a name chosen afterwards is never renamed. The single BTC holding of the
 * pre-split release was 'Binance BTC', which became Spot.
 */
export const PREVIOUS_BTC_HOLDING_NAMES: Record<BinanceWallet, readonly string[]> = {
  spot: ['Binance BTC', 'Binance Spot'],
  funding: ['Binance Funding'],
  earn: ['Binance Earn'],
};

/** The `metadata.binanceAsset` key stored on a holding, if any. */
export const binanceKeyOf = (holding: Pick<HoldingRow, 'metadata'>): string | undefined => {
  const key = (holding.metadata as { binanceAsset?: unknown } | null)?.binanceAsset;

  return typeof key === 'string' ? key : undefined;
};
