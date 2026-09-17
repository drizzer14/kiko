import forge from 'node-forge';

import { nodeForgeCrypto } from './node-forge-crypto';

// forge's own `verify` — proves `sign` produces a signature the PUBLIC key
// actually validates, not merely that it returns SOME base64 string.
const verifyWithForge = (publicKeyPem: string, body: string, signatureBase64: string): boolean => {
  const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
  const md = forge.md.sha256.create();
  md.update(body, 'utf8');

  return publicKey.verify(md.digest().bytes(), forge.util.decode64(signatureBase64));
};

describe('nodeForgeCrypto', () => {
  // ONE keypair, generated once in `beforeAll` rather than hardcoded as a
  // literal PEM string in this file — a hardcoded private-key literal trips
  // `check:security`'s Class A `detected-private-key` Semgrep rule (not
  // override-eligible), and generating it once here still keeps every `sign`
  // assertion below fast and deterministic (RSA-2048 keygen takes tens of
  // milliseconds under Node's native crypto delegation — see
  // `nodeForgeCrypto.generateKeyPair`'s own doc comment) without regenerating
  // a fresh pair per assertion.
  let privateKeyPem: string;
  let publicKeyPem: string;

  beforeAll(async () => {
    const pair = await nodeForgeCrypto.generateKeyPair();
    privateKeyPem = pair.privateKeyPem;
    publicKeyPem = pair.publicKeyPem;
  }, 20_000);

  describe('generateKeyPair', () => {
    it('returns a valid RSA-2048 PEM keypair', () => {
      expect(privateKeyPem).toMatch(/-----BEGIN RSA PRIVATE KEY-----/);
      expect(publicKeyPem).toMatch(/-----BEGIN PUBLIC KEY-----/);

      // A real RSA-2048 modulus — the public key encodes a 2048-bit `n`.
      const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
      expect(publicKey.n.bitLength()).toBe(2048);
    });

    it('throws when no secure CSPRNG (`crypto.getRandomValues`) is available, rather than falling back to a weak PRNG', async () => {
      const original = (globalThis as { crypto?: Crypto }).crypto;
      // biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(test-only) simulating the pre-`react-native-get-random-values` global state requires deleting the ambient `crypto` global for this one assertion
      delete (globalThis as any).crypto;

      try {
        await expect(nodeForgeCrypto.generateKeyPair()).rejects.toThrow(
          /getRandomValues|CSPRNG|entropy/i,
        );
      } finally {
        Object.defineProperty(globalThis, 'crypto', {
          value: original,
          configurable: true,
          writable: true,
        });
      }
    });
  });

  describe('sign', () => {
    it('produces an RSA-SHA256 base64 signature over the body that verifies against the public key', async () => {
      const body = JSON.stringify({ secret: 'bunq-key-fixture' });

      const signature = await nodeForgeCrypto.sign(privateKeyPem, body);

      expect(verifyWithForge(publicKeyPem, body, signature)).toBe(true);
    });

    it('produces a DIFFERENT signature for a different body, still verifiable', async () => {
      const bodyA = JSON.stringify({ secret: 'key-a' });
      const bodyB = JSON.stringify({ secret: 'key-b' });

      const signatureA = await nodeForgeCrypto.sign(privateKeyPem, bodyA);
      const signatureB = await nodeForgeCrypto.sign(privateKeyPem, bodyB);

      expect(signatureA).not.toBe(signatureB);
      expect(verifyWithForge(publicKeyPem, bodyA, signatureA)).toBe(true);
      expect(verifyWithForge(publicKeyPem, bodyB, signatureB)).toBe(true);
    });

    it('does NOT verify against a signature produced over a different body (sanity check on the verifier itself)', async () => {
      const signedBody = JSON.stringify({ secret: 'real' });
      const otherBody = JSON.stringify({ secret: 'tampered' });

      const signature = await nodeForgeCrypto.sign(privateKeyPem, signedBody);

      expect(verifyWithForge(publicKeyPem, otherBody, signature)).toBe(false);
    });
  });
});
