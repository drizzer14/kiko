import * as Keychain from 'react-native-keychain';

import {
  clearExchangeCredentials,
  credentialServiceFor,
  type ExchangeKeychain,
  hardenedFor,
  loadExchangeCredentials,
  saveExchangeCredentials,
} from './credentials';

// A service-keyed in-memory Keychain: each `service` has its own item, so isolation between
// accounts and between exchanges can be exercised.
jest.mock('react-native-keychain', () => {
  const store: Record<string, { username: string; password: string }> = {};
  const key = (options?: { service?: string }): string => options?.service ?? 'default';

  return {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
    setGenericPassword: jest.fn(
      async (username: string, password: string, options?: { service?: string }) => {
        store[key(options)] = { username, password };

        return true;
      },
    ),
    getGenericPassword: jest.fn(
      async (options?: { service?: string }) => store[key(options)] ?? false,
    ),
    resetGenericPassword: jest.fn(async (options?: { service?: string }) => {
      delete store[key(options)];

      return true;
    }),
  };
});

const SAMPLE: ExchangeKeychain = { service: 'kiko.sample.credentials', username: 'sample' };
const ANOTHER: ExchangeKeychain = { service: 'kiko.another.credentials', username: 'another' };
const ACCOUNT_A = 'acc-a';
const ACCOUNT_B = 'acc-b';
const fixture = { apiKey: 'api-key-fixture', secret: 'secret-fixture' };

beforeEach(async () => {
  // The mock's store lives in the factory closure and outlives a test; clear every item a test
  // touches. jest.clearAllMocks only resets the call records.
  for (const keychain of [SAMPLE, ANOTHER]) {
    for (const accountId of [ACCOUNT_A, ACCOUNT_B]) {
      await Keychain.resetGenericPassword({ service: credentialServiceFor(keychain, accountId) });
    }
  }

  jest.clearAllMocks();
});

describe('credentialServiceFor', () => {
  it('names the item after the exchange service and the account id', () => {
    expect(credentialServiceFor(SAMPLE, ACCOUNT_A)).toBe('kiko.sample.credentials.acc-a');
  });

  it('differs for another account and for another exchange', () => {
    expect(credentialServiceFor(SAMPLE, ACCOUNT_A)).not.toBe(
      credentialServiceFor(SAMPLE, ACCOUNT_B),
    );
    expect(credentialServiceFor(SAMPLE, ACCOUNT_A)).not.toBe(
      credentialServiceFor(ANOTHER, ACCOUNT_A),
    );
  });
});

describe('hardenedFor', () => {
  it('is readable only while unlocked, stays on this device and asks for no biometric on a read', () => {
    expect(hardenedFor('a-service')).toEqual({
      service: 'a-service',
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
  });
});

describe('exchange credentials', () => {
  it('saves the pair as one JSON item under the account service, with the exchange username', async () => {
    await saveExchangeCredentials(SAMPLE, ACCOUNT_A, fixture);

    expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1);
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      'sample',
      JSON.stringify(fixture),
      hardenedFor('kiko.sample.credentials.acc-a'),
    );
  });

  it('loads the pair that was saved', async () => {
    await saveExchangeCredentials(SAMPLE, ACCOUNT_A, fixture);

    expect(await loadExchangeCredentials(SAMPLE, ACCOUNT_A)).toEqual(fixture);
    expect(Keychain.getGenericPassword).toHaveBeenCalledWith({
      service: 'kiko.sample.credentials.acc-a',
    });
  });

  it('keeps two accounts and two exchanges apart', async () => {
    await saveExchangeCredentials(SAMPLE, ACCOUNT_A, { apiKey: 'ak-a', secret: 'sk-a' });
    await saveExchangeCredentials(SAMPLE, ACCOUNT_B, { apiKey: 'ak-b', secret: 'sk-b' });

    expect(await loadExchangeCredentials(SAMPLE, ACCOUNT_A)).toEqual({
      apiKey: 'ak-a',
      secret: 'sk-a',
    });
    expect(await loadExchangeCredentials(SAMPLE, ACCOUNT_B)).toEqual({
      apiKey: 'ak-b',
      secret: 'sk-b',
    });
    expect(await loadExchangeCredentials(ANOTHER, ACCOUNT_A)).toBeUndefined();
  });

  it('loads nothing when nothing is stored', async () => {
    expect(await loadExchangeCredentials(SAMPLE, ACCOUNT_A)).toBeUndefined();
  });

  it('loads nothing from a value that is not JSON or lacks half of the pair', async () => {
    const service = credentialServiceFor(SAMPLE, ACCOUNT_A);

    await Keychain.setGenericPassword('sample', 'not-json', { service });
    expect(await loadExchangeCredentials(SAMPLE, ACCOUNT_A)).toBeUndefined();

    await Keychain.setGenericPassword('sample', JSON.stringify({ apiKey: 'only-half' }), {
      service,
    });
    expect(await loadExchangeCredentials(SAMPLE, ACCOUNT_A)).toBeUndefined();
  });

  it('clears the pair of one account and leaves the others', async () => {
    await saveExchangeCredentials(SAMPLE, ACCOUNT_A, fixture);
    await saveExchangeCredentials(SAMPLE, ACCOUNT_B, fixture);

    await clearExchangeCredentials(SAMPLE, ACCOUNT_A);

    expect(await loadExchangeCredentials(SAMPLE, ACCOUNT_A)).toBeUndefined();
    expect(await loadExchangeCredentials(SAMPLE, ACCOUNT_B)).toEqual(fixture);
  });
});
