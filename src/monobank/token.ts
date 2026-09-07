import * as Keychain from 'react-native-keychain';

const service = 'kiko.monobank.token';

/**
 * LEGACY (pre-`kiko` rename) Keychain service. This literal is the documented
 * residual-`pff` exception: it exists only to migrate a device that stored a
 * token under the old service. Do NOT reference `pff` anywhere else in the app.
 */
const LEGACY_SERVICE = 'pff.monobank.token';

/**
 * Storage-at-rest policy for the token: readable only while the device is
 * unlocked, and bound to this device (never restored onto another one from an
 * encrypted backup). Deliberately NO `accessControl` — a biometric prompt on
 * this item would break the silent background auto-sync read
 * (`useAutoSync` -> `readToken`). The app-wide biometric gate is `LockGate`
 * (`src/auth`), not the Keychain item. A token saved before this shipped keeps
 * its old (default) policy until the user reconnects, or until it is migrated
 * across from the legacy service below — see docs/security/README.md.
 */
const HARDENED: Keychain.SetOptions = {
  service,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const saveToken = async (token: string): Promise<void> => {
  await Keychain.setGenericPassword('monobank', token, HARDENED);
};

export const readToken = async (): Promise<string | undefined> => {
  const credentials = await Keychain.getGenericPassword({ service });
  return credentials ? credentials.password : undefined;
};

export const clearToken = async (): Promise<void> => {
  await Keychain.resetGenericPassword({ service });
};

/**
 * Whether a token is stored, WITHOUT handing the value back. The account-detail
 * field uses this to show a "token saved" state: a stored secret must never be
 * prefilled into an editable input or parked in React state, where a jailbroken
 * device or an attached debugger can read the JS heap. Changing the token means
 * re-entering it.
 *
 * `hasGenericPassword` queries the item's attributes only; `getGenericPassword`
 * would decrypt the token into the JS heap just to compare it against `false`,
 * which is exactly what this function exists to avoid.
 */
export const hasToken = async (): Promise<boolean> => {
  return Keychain.hasGenericPassword({ service });
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

  await Keychain.setGenericPassword(legacy.username, legacy.password, HARDENED);
  await Keychain.resetGenericPassword({ service: LEGACY_SERVICE });
};
