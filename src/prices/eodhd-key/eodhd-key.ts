import * as Keychain from 'react-native-keychain';

// One global item: the key belongs to the user's EODHD account, not to a Kiko account.
const EODHD_KEY_SERVICE = 'kiko.eodhd.key';

// Readable only while unlocked, never restored onto another device. No
// `accessControl`: a biometric prompt on every read would break the silent
// background price refresh; the app-wide gate is `LockGate`. Same policy as
// the Monobank and Binance secrets, kept local so `prices` never imports them.
const HARDENED: Keychain.SetOptions = {
  service: EODHD_KEY_SERVICE,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const saveEodhdKey = async (key: string): Promise<void> => {
  await Keychain.setGenericPassword('eodhd', key, HARDENED);
};

export const readEodhdKey = async (): Promise<string | undefined> => {
  const credentials = await Keychain.getGenericPassword({ service: EODHD_KEY_SERVICE });

  return credentials ? credentials.password : undefined;
};

// Reads the item's attributes only, so a "saved" state never decrypts the key
// into the JS heap.
export const hasEodhdKey = async (): Promise<boolean> => {
  return Keychain.hasGenericPassword({ service: EODHD_KEY_SERVICE });
};

export const clearEodhdKey = async (): Promise<void> => {
  await Keychain.resetGenericPassword({ service: EODHD_KEY_SERVICE });
};
