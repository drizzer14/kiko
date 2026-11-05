import type { HoldingRow } from '@kiko/db';
import { isRecord } from '@kiko/type-guards';
import type { ExchangeMetadataField } from '@kiko/holdings/holding-metadata';
import { type BalanceProviderId, isBalanceProviderId } from '@kiko/crypto-sync/provider';

// Binance to wallet is not listed: that pair stays open. A new provider id fails to compile here
// until its row is written.
const CONFLICTING_FIELDS: Record<BalanceProviderId, readonly ExchangeMetadataField[]> = {
  bybit: ['binanceAsset', 'walletAddress'],
  binance: ['bybitAsset'],
  btc_wallet: ['bybitAsset'],
};

const isKeyedBy = (
  { metadata }: Pick<HoldingRow, 'metadata'>,
  fields: readonly ExchangeMetadataField[],
): boolean => isRecord(metadata) && fields.some((field) => typeof metadata[field] === 'string');

/**
 * The holdings that carry a sync key that `pick` conflicts with. The test reads the keys only,
 * not whether the holding is synced: a holding that also carries the key of `pick` is in the
 * list too. The refusal keeps the holdings of one exchange or wallet on one account. An id that
 * names no provider conflicts with nothing.
 */
export const conflictingExchangeHoldings = <Holding extends Pick<HoldingRow, 'metadata'>>(
  pick: string,
  holdings: readonly Holding[],
): Holding[] =>
  isBalanceProviderId(pick)
    ? holdings.filter((holding) => isKeyedBy(holding, CONFLICTING_FIELDS[pick]))
    : [];
