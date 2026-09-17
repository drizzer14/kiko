import { i18n } from '../../i18n';

import { defaultBunqCrypto } from './bunq-crypto';

// This binding is a deliberate placeholder — see the doc comment on
// `defaultBunqCrypto` (`TODO(VERIFY LIVE / DEPENDENCY DECISION)`). It exists
// so bunq's handshake/sync logic is fully unit-testable against a MOCK
// `BunqCrypto` today, while a real device connection surfaces a GRACEFUL,
// TRANSLATED error until the coordinator wires a concrete RSA binding — the
// raw internal dev reason must never reach the UI, only an Error `.cause`.
describe('defaultBunqCrypto (unwired stub)', () => {
  it('rejects generateKeyPair with the translated "not yet available" message', async () => {
    await expect(defaultBunqCrypto.generateKeyPair()).rejects.toThrow(
      i18n.t('accountDetail.bunqNotYetAvailable'),
    );
  });

  it('rejects sign with the translated "not yet available" message', async () => {
    await expect(defaultBunqCrypto.sign('pem', 'body')).rejects.toThrow(
      i18n.t('accountDetail.bunqNotYetAvailable'),
    );
  });

  it('keeps the raw internal dev reason only as the error cause, not the user-facing message', async () => {
    await expect(defaultBunqCrypto.generateKeyPair()).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/not wired/) }),
    });
  });
});
