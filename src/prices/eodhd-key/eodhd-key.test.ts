import * as Keychain from 'react-native-keychain';

import { clearEodhdKey, hasEodhdKey, readEodhdKey, saveEodhdKey } from './eodhd-key';

const SERVICE = 'kiko.eodhd.key';

jest.mock('react-native-keychain', () => {
  const store: Record<string, { username: string; password: string }> = {};
  const slot = (options?: { service?: string }): string => options?.service ?? 'default';

  return {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
    setGenericPassword: jest.fn(
      async (username: string, password: string, options?: { service?: string }) => {
        store[slot(options)] = { username, password };

        return true;
      },
    ),
    getGenericPassword: jest.fn(
      async (options?: { service?: string }) => store[slot(options)] ?? false,
    ),
    hasGenericPassword: jest.fn(async (options?: { service?: string }) => slot(options) in store),
    resetGenericPassword: jest.fn(async (options?: { service?: string }) => {
      delete store[slot(options)];

      return true;
    }),
  };
});

beforeEach(async () => {
  await Keychain.resetGenericPassword({ service: SERVICE });
  jest.clearAllMocks();
});

describe('EODHD key in the Keychain', () => {
  it('saves the key under one global service, readable only while unlocked on this device', async () => {
    await saveEodhdKey('fake-eodhd-key-0000');

    expect(Keychain.setGenericPassword).toHaveBeenCalledWith('eodhd', 'fake-eodhd-key-0000', {
      service: SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  });

  it('never asks for biometry on a read, so a background refresh can read the key', async () => {
    await saveEodhdKey('fake-eodhd-key-0000');

    const options = jest.mocked(Keychain.setGenericPassword).mock.calls[0][2];
    expect(options).not.toHaveProperty('accessControl');
  });

  it('reads the saved key back', async () => {
    await saveEodhdKey('fake-eodhd-key-0000');

    await expect(readEodhdKey()).resolves.toBe('fake-eodhd-key-0000');
  });

  it('reads undefined when no key is saved', async () => {
    await expect(readEodhdKey()).resolves.toBeUndefined();
  });

  it('clears the key', async () => {
    await saveEodhdKey('fake-eodhd-key-0000');
    await clearEodhdKey();

    await expect(readEodhdKey()).resolves.toBeUndefined();
    expect(Keychain.resetGenericPassword).toHaveBeenLastCalledWith({ service: SERVICE });
  });

  it('reports whether a key is saved without decrypting it', async () => {
    await expect(hasEodhdKey()).resolves.toBe(false);

    await saveEodhdKey('fake-eodhd-key-0000');

    await expect(hasEodhdKey()).resolves.toBe(true);
    expect(Keychain.hasGenericPassword).toHaveBeenCalledWith({ service: SERVICE });
    expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
  });
});
