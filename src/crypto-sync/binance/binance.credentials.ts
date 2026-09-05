import { bifold, eitherSync, isRight } from 'fnts/either';
import * as Keychain from 'react-native-keychain';

const service = 'kiko.binance.credentials';

export type BinanceCredentials = { apiKey: string; secret: string };

const isCredentials = (value: unknown): value is BinanceCredentials =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { apiKey?: unknown }).apiKey === 'string' &&
  typeof (value as { secret?: unknown }).secret === 'string';

/**
 * Storage-at-rest policy for the read-only Binance key pair: readable only
 * while the device is unlocked, and bound to this device (never iCloud-synced
 * or restored onto another one from a backup). Deliberately NO `accessControl`
 * — this pair used to carry `BIOMETRY_CURRENT_SET`, which forced a Face ID /
 * Touch ID prompt on EVERY read, so a pull-to-refresh sync (`readCredentials`
 * -> `fetchAccount`) prompted the user each time. The app-wide biometric gate
 * is now `LockGate` (`src/auth`), which replaces the per-item prompt. The pair
 * is never written to SQLite, holding metadata, or a log.
 */
const HARDENED: Keychain.SetOptions = {
  service,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Store the pair as ONE JSON Keychain item under the hardened policy above. */
export const saveCredentials = async (credentials: BinanceCredentials): Promise<void> => {
  await Keychain.setGenericPassword('binance', JSON.stringify(credentials), HARDENED);
};

/**
 * Reads the pair. No biometric prompt for an item stored under the hardened
 * policy. A pair written before the hardening shipped still carries the old
 * per-read `BIOMETRY_CURRENT_SET` control (its first read here still prompts
 * once, unavoidably); it is re-saved under the hardened, prompt-free policy so
 * later reads never fire Face ID and the pair is never silently orphaned.
 * Resolves `undefined` when nothing valid is stored.
 */
export const readCredentials = async (): Promise<BinanceCredentials | undefined> => {
  const stored = await Keychain.getGenericPassword({ service });

  if (!stored) {
    return undefined;
  }

  const parsed = eitherSync<unknown, unknown>(() => JSON.parse(stored.password));
  const value = isRight(parsed) ? bifold(parsed) : undefined;

  if (!isCredentials(value)) {
    return undefined;
  }

  await saveCredentials(value);

  return value;
};

export const clearCredentials = async (): Promise<void> => {
  await Keychain.resetGenericPassword({ service });
};
