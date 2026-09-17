import forge from 'node-forge';

import type { BunqCrypto } from '../bunq.types';

/** bunq's client keypair size — CONFIRMED by bunq's own API docs (coordinator's live verification pass). */
const RSA_MODULUS_BITS = 2048;
const RSA_PUBLIC_EXPONENT = 0x10001;
/** How many CSPRNG bytes are folded into forge's entropy pool before every keygen — see `seedForgePrng` below. */
const ENTROPY_SEED_BYTES = 32;

/**
 * `@types/node-forge`'s ambient `random` namespace omits `collect` even
 * though the real runtime module defines it (`node-forge/lib/prng.js`) —
 * this narrows the third-party boundary gap to exactly the one method this
 * file needs, rather than widening `forge.random` itself to `any`.
 */
type ForgeRandomWithCollect = typeof forge.random & { collect: (bytes: string) => void };

/**
 * Read the CSPRNG this binding requires — `crypto.getRandomValues`, seeded
 * by `react-native-get-random-values` on-device (imported at the very top of
 * `index.js`, before this module or any other crypto use) or natively
 * present under Node/Jest (Node 20+ exposes `globalThis.crypto` itself).
 * Returns `undefined` rather than throwing so the two call sites below can
 * each produce their own precise error.
 */
const secureRandomSource = (): Crypto | undefined => {
  const source = (globalThis as { crypto?: Crypto }).crypto;

  return typeof source?.getRandomValues === 'function' ? source : undefined;
};

/**
 * SECURITY-CRITICAL: refuse to generate a bank-auth RSA keypair unless a
 * seeded, secure entropy source is actually present. node-forge's own PRNG
 * (`node-forge/lib/prng.js`'s `defaultSeedFile`) silently falls back to
 * `Math.random` when neither Node's built-in `crypto` module nor
 * `global.crypto.getRandomValues` is available — exactly the React Native
 * environment before `react-native-get-random-values` is polyfilled. A weak
 * PRNG on a bank-auth keypair is forbidden, so this throws instead of
 * letting that silent degradation happen.
 */
const assertSecureRandomSource = (): Crypto => {
  const source = secureRandomSource();

  if (!source) {
    throw new Error(
      'bunq crypto: no secure CSPRNG (`crypto.getRandomValues`) is available — refusing to ' +
        "generate an RSA keypair with node-forge's weak Math.random fallback. Ensure " +
        '`react-native-get-random-values` is imported at the very top of index.js, before ' +
        'any other import that could touch crypto.',
    );
  }

  return source;
};

/**
 * Explicitly folds CSPRNG bytes into forge's entropy pool before every
 * keygen. node-forge's own `defaultSeedFile` (`node-forge/lib/prng.js`)
 * already reads `global.crypto.getRandomValues` lazily whenever it needs
 * entropy and Node's own `crypto` module is unavailable (true on React
 * Native/Hermes) — this call makes that reliance explicit and defense-in-
 * depth, rather than a doc-only assumption a future node-forge upgrade could
 * silently drop.
 */
const seedForgePrng = (source: Crypto): void => {
  const bytes = source.getRandomValues(new Uint8Array(ENTROPY_SEED_BYTES));
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  (forge.random as ForgeRandomWithCollect).collect(binary);
};

/**
 * The concrete `BunqCrypto` binding: RSA-2048 keygen and RSA-SHA256 body
 * signing via `node-forge` (pure-JS RSA — React Native ships no built-in RSA
 * and this app's `@noble/hashes` dependency has none either). This is the
 * production default (`defaultBunqCrypto`, `./bunq-crypto.ts`); tests keep
 * injecting a hermetic MOCK `BunqCrypto` instead of exercising real RSA math.
 */
export const nodeForgeCrypto: BunqCrypto = {
  generateKeyPair: async () => {
    const source = assertSecureRandomSource();
    seedForgePrng(source);

    const { privateKey, publicKey } = forge.pki.rsa.generateKeyPair({
      bits: RSA_MODULUS_BITS,
      e: RSA_PUBLIC_EXPONENT,
    });

    return {
      privateKeyPem: forge.pki.privateKeyToPem(privateKey),
      publicKeyPem: forge.pki.publicKeyToPem(publicKey),
    };
  },

  // bunq's `X-Bunq-Client-Signature` scheme: an RSA-SHA256 signature of the
  // request BODY string only (CONFIRMED, coordinator's live verification
  // pass — see `openSession`'s doc comment, `../client/bunq.client.ts`),
  // base64-encoded.
  sign: async (privateKeyPem, body) => {
    const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
    const md = forge.md.sha256.create();
    md.update(body, 'utf8');

    return forge.util.encode64(privateKey.sign(md));
  },
};
