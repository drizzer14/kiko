import type { AccountRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { isBalanceProviderId } from '@kiko/crypto-sync/provider';
import { exchangeProviderRegistry } from '@kiko/crypto-sync/exchange/registry';

/**
 * Whether the account's provider asks for the "Earlier history" line: the balance beyond the rows
 * says something true only where each row names the wallet its holding reads.
 */
export const showsEarlierHistory = (
  account: Pick<AccountRow, 'institution'> | undefined,
): boolean =>
  foldMap(maybe(account), ({ institution }) =>
    isBalanceProviderId(institution)
      ? exchangeProviderRegistry[institution]?.showsEarlierHistory === true
      : false,
  ) ?? false;
