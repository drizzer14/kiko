import { defaultBunqCrypto } from './bunq-crypto';
import { nodeForgeCrypto } from './node-forge-crypto';

// `defaultBunqCrypto` is a thin selector, not an implementation of its own —
// the real RSA-2048 keygen / RSA-SHA256 signing behavior is exercised in
// `node-forge-crypto.test.ts`. This just pins the selection itself, so a
// future rebind to a different concrete `BunqCrypto` can't silently regress
// production while every OTHER test keeps injecting its own mock.
describe('defaultBunqCrypto', () => {
  it('is bound to the node-forge BunqCrypto implementation', () => {
    expect(defaultBunqCrypto).toBe(nodeForgeCrypto);
  });
});
