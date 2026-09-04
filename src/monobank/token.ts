import * as Keychain from 'react-native-keychain';

const service = 'kiko.monobank.token';

/**
 * LEGACY (pre-`kiko` rename) Keychain service. This literal is the documented
 * residual-`pff` exception: it exists only to migrate a device that stored a
 * token under the old service. Do NOT reference `pff` anywhere else in the app.
 */
const LEGACY_SERVICE = 'pff.monobank.token';

export const saveToken = async (token: string): Promise<void> => {
  await Keychain.setGenericPassword('monobank', token, { service });
};

export const readToken = async (): Promise<string | undefined> => {
  const credentials = await Keychain.getGenericPassword({ service });
  return credentials ? credentials.password : undefined;
};

export const clearToken = async (): Promise<void> => {
  await Keychain.resetGenericPassword({ service });
};

/**
 * One-time, idempotent migration of the Monobank token from the legacy
 * Keychain service to the current one. Must be awaited once at app bootstrap,
 * BEFORE anything reads the token (the auto-sync hook), so a device upgraded
 * from an older build keeps its connected account.
 *
 * If the new service already holds a token the migration has run (or the user
 * connected fresh) — do nothing, leaving any legacy value untouched. Otherwise,
 * copy a legacy token across and clear the legacy service. A device with no
 * legacy token (genuine fresh install) is a no-op.
 */
export const migrateLegacyToken = async (): Promise<void> => {
  const existing = await Keychain.getGenericPassword({ service });
  if (existing) {
    return;
  }

  const legacy = await Keychain.getGenericPassword({ service: LEGACY_SERVICE });
  if (!legacy) {
    return;
  }

  await Keychain.setGenericPassword(legacy.username, legacy.password, { service });
  await Keychain.resetGenericPassword({ service: LEGACY_SERVICE });
};
