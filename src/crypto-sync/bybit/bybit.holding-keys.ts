import type { HoldingRow } from '@kiko/db';
import type { Currency } from '@kiko/currency/currency';

import { isTrackedBybitAsset } from './bybit.tracked-coin';

const BYBIT_WALLETS = ['unified', 'fund'] as const;

export type BybitWallet = (typeof BYBIT_WALLETS)[number];

const isBybitWallet = (value: string): value is BybitWallet =>
  (BYBIT_WALLETS as readonly string[]).includes(value);

/**
 * The key stored under `metadata.bybitAsset`, one holding per Bybit coin and wallet:
 * `<COIN>:unified`, `<COIN>:fund`. The coin is always part of the key, BTC too, because no legacy
 * holding exists to keep a bare `BTC` key for. A key of any other wallet names none here, so a
 * stored holding with one is neither written nor zeroed by a sync.
 */
export const holdingKeyOf = (code: Currency, wallet: BybitWallet): string => `${code}:${wallet}`;

type HoldingKeyParts = { code: Currency; wallet: BybitWallet };

/** The coin and wallet a stored key names; a key `holdingKeyOf` never makes names none. */
export const partsOfHoldingKey = (key: string): HoldingKeyParts | undefined => {
  const [code = ''] = key.split(':');
  const wallet = BYBIT_WALLETS.find((candidate) => `${code}:${candidate}` === key);

  if (wallet === undefined || !isTrackedBybitAsset(code)) {
    return undefined;
  }

  return { code, wallet };
};

/** The `metadata.bybitAsset` key stored on a holding, if any. */
export const bybitKeyOf = (holding: Pick<HoldingRow, 'metadata'>): string | undefined => {
  const key = (holding.metadata as { bybitAsset?: unknown } | null)?.bybitAsset;

  return typeof key === 'string' ? key : undefined;
};

const WALLET_LABELS: Record<BybitWallet, string> = {
  unified: 'Unified',
  fund: 'Funding',
};

/**
 * The wallet a stored key names, as its holdings carry it ("Funding" for `fund`). A key no wallet
 * owns reads as itself, so a note stored by a later build still shows under its own key.
 */
export const walletLabelOf = (wallet: string): string =>
  isBybitWallet(wallet) ? WALLET_LABELS[wallet] : wallet;

/**
 * The default name of a holding the sync creates for a coin: "Bybit Unified · USDT". 'Bybit' and
 * its wallet names are brand terms, read the same in every language, and each name is
 * user-editable after creation: an upsert never rewrites it.
 */
export const coinHoldingName = (code: Currency, wallet: BybitWallet): string =>
  `Bybit ${WALLET_LABELS[wallet]} · ${code}`;
