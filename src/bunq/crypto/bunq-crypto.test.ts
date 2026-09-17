import { defaultBunqCrypto } from './bunq-crypto';

// This binding is a deliberate placeholder — see the doc comment on
// `defaultBunqCrypto` (`TODO(VERIFY LIVE / DEPENDENCY DECISION)`). It exists
// so bunq's handshake/sync logic is fully unit-testable against a MOCK
// `BunqCrypto` today, while a real device connection surfaces a clear error
// until the coordinator wires a concrete RSA binding.
describe('defaultBunqCrypto (unwired stub)', () => {
  it('rejects generateKeyPair with a clear "not wired" error', async () => {
    await expect(defaultBunqCrypto.generateKeyPair()).rejects.toThrow(/not wired/);
  });

  it('rejects sign with a clear "not wired" error', async () => {
    await expect(defaultBunqCrypto.sign('pem', 'body')).rejects.toThrow(/not wired/);
  });
});
