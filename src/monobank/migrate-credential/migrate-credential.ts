import * as Keychain from 'react-native-keychain';

import { hardenedFor, MONOBANK_TOKEN_SERVICE, serviceFor } from '../token';

/**
 * Move the single GLOBAL Monobank token (`kiko.monobank.token`) to a PER-ACCOUNT
 * Keychain item keyed by the connected account id, so a second Monobank
 * connection can bind its own token (multi-account plan, 2026-09-11). Run once at
 * app bootstrap AFTER `migrateLegacyToken` (which brings a pre-`kiko` token up to
 * the global item first) and BEFORE anything reads the per-account token.
 *
 * The ordering is CRASH-SAFE (reversible-expensive step first, verify, delete the
 * irreversible source LAST — memory: `crash-safe-migration-ordering`) and gates on
 * the global item's PRESENCE, never on key-absence (memory:
 * `ios-keychain-survives-reinstall`):
 *
 *   1. Read the global item. Absent -> nothing to migrate (the sole no-op gate).
 *   2. No connected account -> leave the global item in place; a later Connect
 *      adopts it, or the user re-enters the token manually. A token can never be
 *      bound to no account.
 *   3. Per-account item already present -> a prior run migrated it but may have
 *      crashed before deleting the global item; just clear the leftover global
 *      item and return (idempotent convergence, no rewrite).
 *   4. Write the token to the per-account service and READ IT BACK to confirm it
 *      is durable. If the read-back fails, DO NOT delete the global item — the
 *      token would be stranded; a later run retries from a recoverable state.
 *   5. Only after the verified write, delete the global item.
 *
 * The per-account write reuses the token's `HARDENED` options verbatim (only the
 * `service` differs — `hardenedFor`), so no per-item biometric prompt is ever
 * added; the app-wide gate stays `LockGate`. The token is never written to
 * SQLite, `sync_state`, `settings`, `holdings.metadata`, or a log — only the
 * Keychain.
 */
export const migrateSingleTokenToPerAccount = async (
  connectedMonobankAccountId: string | undefined,
): Promise<void> => {
  const global = await Keychain.getGenericPassword({ service: MONOBANK_TOKEN_SERVICE });

  if (!global) {
    return;
  }

  if (connectedMonobankAccountId === undefined) {
    return;
  }

  const perAccountService = serviceFor(connectedMonobankAccountId);
  const existing = await Keychain.getGenericPassword({ service: perAccountService });

  if (existing) {
    await Keychain.resetGenericPassword({ service: MONOBANK_TOKEN_SERVICE });

    return;
  }

  await Keychain.setGenericPassword(
    global.username,
    global.password,
    hardenedFor(perAccountService),
  );
  const readBack = await Keychain.getGenericPassword({ service: perAccountService });

  if (!readBack) {
    return;
  }

  await Keychain.resetGenericPassword({ service: MONOBANK_TOKEN_SERVICE });
};
