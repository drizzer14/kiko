import { open } from '@op-engineering/op-sqlite';
import * as Keychain from 'react-native-keychain';

import { DB_KEY_SERVICE, generateDbKey, readDbKey, storeDbKey, toSQLCipherRawKey } from './db-key';

const HEX_KEY = 'ab'.repeat(32);

jest.mock('react-native-keychain', () => {
  let store: { username: string; password: string } | null = null;

  return {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
    setGenericPassword: jest.fn(async (username: string, password: string) => {
      store = { username, password };

      return true;
    }),
    getGenericPassword: jest.fn(async () => store ?? false),
    resetGenericPassword: jest.fn(async () => {
      store = null;

      return true;
    }),
  };
});

const mockClose = jest.fn();
const mockExecuteSync = jest.fn(() => ({ rows: [{ keyHex: 'ab'.repeat(32) }] }));
jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => ({ executeSync: mockExecuteSync, close: mockClose })),
}));

describe('db-key', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await Keychain.resetGenericPassword({ service: DB_KEY_SERVICE });
    mockExecuteSync.mockReturnValue({ rows: [{ keyHex: HEX_KEY }] });
  });

  it('reads undefined when no key is stored', async () => {
    expect(await readDbKey()).toBeUndefined();
    expect(Keychain.getGenericPassword).toHaveBeenCalledWith({ service: 'kiko.db.key' });
  });

  it('round-trips a stored key', async () => {
    await storeDbKey(HEX_KEY);
    expect(await readDbKey()).toBe(HEX_KEY);
  });

  it('stores the key device-only and readable only while unlocked, under its own service', async () => {
    await storeDbKey(HEX_KEY);

    expect(Keychain.setGenericPassword).toHaveBeenCalledWith('kiko', HEX_KEY, {
      service: 'kiko.db.key',
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
  });

  it('generates 32 random bytes as 64 lowercase hex chars from an in-memory SQLite connection', () => {
    const keyHex = generateDbKey();

    expect(keyHex).toBe(HEX_KEY);
    expect(open).toHaveBeenCalledWith({ name: 'kiko-key-entropy', location: ':memory:' });
    expect(mockExecuteSync).toHaveBeenCalledWith(expect.stringContaining('randomblob(?)'), [32]);
  });

  it('closes the entropy connection after drawing the key', () => {
    generateDbKey();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('throws instead of returning a malformed key', () => {
    mockExecuteSync.mockReturnValue({ rows: [{ keyHex: 'too-short' }] });
    expect(() => generateDbKey()).toThrow('Could not generate a database key');
  });

  it('formats the SQLCipher raw-key literal', () => {
    expect(toSQLCipherRawKey(HEX_KEY)).toBe(`x'${HEX_KEY}'`);
  });
});
