import type { AccountRow } from '@kiko/db';
import { readToken } from '@kiko/monobank/token';
import { readCredentials } from '@kiko/crypto-sync/binance';
import { readBybitCredentials } from '@kiko/crypto-sync/bybit';

import type { ExportSecrets } from '../payload';

type KeyPairs = NonNullable<ExportSecrets['binanceCredentials']>;

const readKeyPairs = async (
  accounts: readonly AccountRow[],
  institution: 'binance' | 'bybit',
  read: (accountId: string) => Promise<{ apiKey: string; secret: string } | undefined>,
): Promise<KeyPairs> => {
  const pairs: KeyPairs = [];

  for (const account of accounts.filter((row) => row.institution === institution)) {
    const credentials = await read(account.id);

    if (credentials !== undefined) {
      pairs.push({
        accountId: account.id,
        apiKey: credentials.apiKey,
        secret: credentials.secret,
      });
    }
  }

  return pairs;
};

/**
 * Reads the Keychain secrets this feature bundles behind the "include
 * saved credentials" toggle: every CONNECTED account's Monobank token /
 * Binance credentials / Bybit credentials, each from its own service. An
 * account with no stored secret (never connected, or disconnected) is skipped
 * rather than producing an `undefined` entry.
 */
export const readExportSecrets = async (accounts: AccountRow[]): Promise<ExportSecrets> => {
  const monobankTokens: NonNullable<ExportSecrets['monobankTokens']> = [];

  for (const account of accounts.filter((row) => row.institution === 'monobank')) {
    const token = await readToken(account.id);

    if (token !== undefined) {
      monobankTokens.push({ accountId: account.id, token });
    }
  }

  return {
    monobankTokens,
    binanceCredentials: await readKeyPairs(accounts, 'binance', readCredentials),
    bybitCredentials: await readKeyPairs(accounts, 'bybit', readBybitCredentials),
  };
};
