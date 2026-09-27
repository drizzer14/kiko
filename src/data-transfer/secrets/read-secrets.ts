import type { AccountRow } from '@kiko/db';
import { readToken } from '@kiko/monobank/token';
import { readCredentials } from '@kiko/crypto-sync/binance';

import type { ExportSecrets } from '../payload';

/**
 * Reads the two Keychain secrets this feature bundles behind the "include
 * saved credentials" toggle: every CONNECTED account's Monobank token /
 * Binance credentials. An account with no stored secret (never connected, or
 * disconnected) is skipped rather than producing an `undefined` entry.
 */
export const readExportSecrets = async (accounts: AccountRow[]): Promise<ExportSecrets> => {
  const monobankTokens: ExportSecrets['monobankTokens'] = [];

  for (const account of accounts.filter((row) => row.institution === 'monobank')) {
    const token = await readToken(account.id);

    if (token !== undefined) {
      monobankTokens.push({ accountId: account.id, token });
    }
  }

  const binanceCredentials: ExportSecrets['binanceCredentials'] = [];

  for (const account of accounts.filter((row) => row.institution === 'binance')) {
    const credentials = await readCredentials(account.id);

    if (credentials !== undefined) {
      binanceCredentials.push({
        accountId: account.id,
        apiKey: credentials.apiKey,
        secret: credentials.secret,
      });
    }
  }

  return { monobankTokens, binanceCredentials };
};
