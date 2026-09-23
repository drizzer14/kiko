const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Encodes raw bytes to a standard base64 string, WITHOUT `Buffer` (not
 * guaranteed under Hermes — this app has no `buffer` polyfill anywhere) or
 * `btoa` (equally unverified under Hermes, and it only accepts a Latin-1
 * STRING, not a byte array). Table lookup and bit-shifting only, so this is
 * provably correct under both Jest's Node engine and Hermes.
 */
export const encodeBytesToBase64 = (bytes: Uint8Array): string => {
  let result = '';
  let buffer = 0;
  let bitsCollected = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsCollected += 8;

    while (bitsCollected >= 6) {
      bitsCollected -= 6;
      result += BASE64_ALPHABET[(buffer >> bitsCollected) & 0x3f];
    }
  }

  if (bitsCollected > 0) {
    result += BASE64_ALPHABET[(buffer << (6 - bitsCollected)) & 0x3f];
  }

  while (result.length % 4 !== 0) {
    result += '=';
  }

  return result;
};

/**
 * Decodes a standard base64 string back to raw bytes. Same Hermes-safe,
 * dependency-free approach as `encodeBytesToBase64` — the decode half
 * mirrors the inline codec the `statement-import` branch wrote for the same
 * reason (`src/screens/statement-import/statement-import.screen.tsx`), but
 * UNLIKE that lenient version this one THROWS on an invalid character
 * instead of silently dropping it: a pasted export key must fail loudly on
 * a typo, not decode to a silently-wrong key.
 */
export const decodeBase64ToBytes = (base64: string): Uint8Array => {
  const clean = base64.replace(/\s+/g, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bitsCollected = 0;

  for (const char of clean) {
    if (char === '=') {
      break;
    }

    const sextet = BASE64_ALPHABET.indexOf(char);

    if (sextet === -1) {
      throw new Error('data-transfer/base64: invalid character in base64 input');
    }

    buffer = (buffer << 6) | sextet;
    bitsCollected += 6;

    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      bytes.push((buffer >> bitsCollected) & 0xff);
    }
  }

  return Uint8Array.from(bytes);
};
