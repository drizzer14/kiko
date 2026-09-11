import * as Keychain from 'react-native-keychain';

/**
 * The single GLOBAL Monobank token service. Historically the app stored ONE
 * Monobank token per device under this service. The multi-account plan
 * (2026-09-11) moves the secret to a PER-ACCOUNT item (`serviceFor` below);
 * this global item is now transitional — it is what `migrate-credential.ts`
 * reads and clears once the token is bound to its connected account, and what
 * the old-app import restores into for that migration to pick up.
 */
export const MONOBANK_TOKEN_SERVICE = 'kiko.monobank.token';

/**
 * The per-account Keychain service for a Monobank token, keyed by the stable
 * `accounts.id` (a local uuid — NOT a secret, so embedding it here leaks
 * nothing). Each connected Monobank account holds its own isolated item, so a
 * read/clear for account A can never touch account B's token.
 */
export const serviceFor = (accountId: string): string => `${MONOBANK_TOKEN_SERVICE}.${accountId}`;

/**
 * LEGACY (pre-`kiko` rename) Keychain service. This literal is the documented
 * residual-`pff` exception: it exists only to migrate a device that stored a
 * token under the old service. Do NOT reference `pff` anywhere else in the app.
 */
const LEGACY_SERVICE = 'pff.monobank.token';

/**
 * Storage-at-rest policy for a token item: readable only while the device is
 * unlocked, and bound to this device (never restored onto another one from an
 * encrypted backup). Deliberately NO `accessControl` — a biometric prompt on
 * this item would break the silent background auto-sync read
 * (`useAutoSync` -> `readToken`). The app-wide biometric gate is `LockGate`
 * (`src/auth`), not the Keychain item. Only the `service` differs between the
 * global item and each per-account item; the hardening is identical, so it is
 * derived here from ONE place and reused verbatim by every writer (the global
 * functions, the legacy migration, and the per-account credential migration).
 */
export const hardenedFor = (service: string): Keychain.SetOptions => ({
  service,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});

const HARDENED: Keychain.SetOptions = hardenedFor(MONOBANK_TOKEN_SERVICE);

/**
 * Persist a Monobank token to the PER-ACCOUNT Keychain item for `accountId`.
 * Each connected account owns its own item, so saving account A's token never
 * touches account B's. The token goes ONLY to the Keychain — never to SQLite,
 * `sync_state`, `settings`, `holdings.metadata`, or a log.
 */
export const saveToken = async (accountId: string, token: string): Promise<void> => {
  await Keychain.setGenericPassword('monobank', token, hardenedFor(serviceFor(accountId)));
};

/**
 * Read the token for ONE account. The per-account service string is derived from
 * the account id on every call, so a read for account A can never return account
 * B's secret.
 */
export const readToken = async (accountId: string): Promise<string | undefined> => {
  const credentials = await Keychain.getGenericPassword({ service: serviceFor(accountId) });
  return credentials ? credentials.password : undefined;
};

export const clearToken = async (accountId: string): Promise<void> => {
  await Keychain.resetGenericPassword({ service: serviceFor(accountId) });
};

/**
 * Write the TRANSITIONAL GLOBAL token item. Used ONLY by the old-app import,
 * which restores the retired app's single token before any account row exists to
 * key it by; the boot migration (`migrateSingleTokenToPerAccount`) then binds it
 * to the connected account. Ordinary in-app saves use the per-account `saveToken`.
 */
export const saveGlobalToken = async (token: string): Promise<void> => {
  await Keychain.setGenericPassword('monobank', token, HARDENED);
};

/**
 * Whether a token is stored FOR `accountId`, WITHOUT handing the value back. The
 * account-detail field uses this to show a "token saved" state: a stored secret
 * must never be prefilled into an editable input or parked in React state, where a
 * jailbroken device or an attached debugger can read the JS heap. Changing the
 * token means re-entering it.
 *
 * `hasGenericPassword` queries the item's attributes only; `getGenericPassword`
 * would decrypt the token into the JS heap just to compare it against `false`,
 * which is exactly what this function exists to avoid.
 */
export const hasToken = async (accountId: string): Promise<boolean> => {
  return Keychain.hasGenericPassword({ service: serviceFor(accountId) });
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
  const existing = await Keychain.getGenericPassword({ service: MONOBANK_TOKEN_SERVICE });
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
