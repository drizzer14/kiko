import { i18n } from '../../i18n';
import type { BunqCrypto } from '../bunq.types';

/**
 * TODO(VERIFY LIVE / DEPENDENCY DECISION): bunq's handshake needs an RSA-2048
 * keypair (the `/installation` client public key) and, since bunq's 2020
 * signing change, a REAL RSA signature over the `/session-server` request
 * body for a PRODUCTION connection (see `bunq.client.ts`'s `openSession` doc
 * comment — the sandbox `IGNORE_ONLY_FOR_TESTING` header bypasses only the
 * SIGNATURE, never key generation, so a sandbox connection still needs this
 * binding too). React Native ships no built-in RSA and this app's
 * `@noble/hashes` dependency has none either, so this stub throws rather
 * than silently no-opping: bunq is fully implemented and unit-tested against
 * a MOCK `BunqCrypto` (see `src/bunq/client/bunq.client.test.ts` and
 * `src/bunq/sync/sync.test.ts`), but choosing the concrete binding — a JS
 * RSA library (e.g. `node-forge`/`jsrsasign`) or a native module — is the
 * coordinator's dependency decision, out of scope for this task (task
 * constraint: no new dependency added here). bunq will NOT connect on a real
 * device until this is wired.
 */
const NOT_WIRED_DEV_REASON =
  'bunq crypto binding not wired — coordinator must choose a JS RSA lib or a native module';

/**
 * The error `defaultBunqCrypto`'s two methods reject with. The user-facing
 * `.message` is the GRACEFUL, TRANSLATED `accountDetail.bunqNotYetAvailable`
 * line — the raw internal dev reason above must never reach the UI error
 * line in `BankSyncSection` (`sync()`'s caught message IS what renders
 * there). It stays reachable as `.cause`, plus one diagnostic log, for a dev
 * reading a device console.
 */
const notWiredError = (): Error => {
  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) surface the internal reason a bunq connect failed so a dev can tell this is the unwired-crypto stub, not a real handshake failure
  console.warn('[bunq crypto]', NOT_WIRED_DEV_REASON);

  return new Error(i18n.t('accountDetail.bunqNotYetAvailable'), {
    cause: new Error(NOT_WIRED_DEV_REASON),
  });
};

export const defaultBunqCrypto: BunqCrypto = {
  generateKeyPair: () => Promise.reject(notWiredError()),
  sign: () => Promise.reject(notWiredError()),
};
