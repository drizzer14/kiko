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
 * The holdings that keep another exchange's or wallet's sync key, so a connection of `pick` would
 * leave them reading as synced with no sync behind them (a disconnect keeps the keys). An id that
 * names no provider conflicts with nothing.
 */
export const conflictingExchangeHoldings = <Holding extends Pick<HoldingRow, 'metadata'>>(
  pick: string,
  holdings: readonly Holding[],
): Holding[] =>
  isBalanceProviderId(pick)
    ? holdings.filter((holding) => isKeyedBy(holding, CONFLICTING_FIELDS[pick]))
    : [];
