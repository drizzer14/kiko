import type { ParseKeys } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import type { AccountRow, HoldingRow } from '@kiko/db';
import { isSyncedHolding } from '@kiko/holdings/deletable';
import { isBalanceProviderId } from '@kiko/crypto-sync/provider';
import { exchangeProviderRegistry } from '@kiko/crypto-sync/exchange/registry';

/**
 * The note key of a holding whose balance an exchange sync owns right now, or `undefined` for a
 * manual one, a holding of a disconnected account, and a provider with no note. The screen mounts
 * the footer on this answer, because a list footer that renders nothing still takes a gap.
 */
export const notListedKeyOf = (
  holding: Pick<HoldingRow, 'metadata'>,
  account: Pick<AccountRow, 'institution'> | undefined,
): ParseKeys | undefined =>
  foldMap(maybe(account), ({ institution }) =>
    isSyncedHolding(holding, account) && isBalanceProviderId(institution)
      ? exchangeProviderRegistry[institution]?.notListedKey
      : undefined,
  );
