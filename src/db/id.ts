/**
 * Generates a RFC 4122 v4 UUID for use as a primary key.
 *
 * Prefers the platform `crypto.randomUUID()` when the runtime exposes it
 * (newer Hermes builds and any WebCrypto-capable environment). Hermes does
 * not guarantee a global `crypto`, so this falls back to a tiny local v4
 * generator rather than adding a dependency. The fallback uses `Math.random`
 * for entropy — acceptable for local, non-cryptographic row identifiers, not
 * for security tokens.
 */
export const id = (): string => {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoObj?.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0;
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
};
