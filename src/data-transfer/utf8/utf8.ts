/**
 * Encodes/decodes UTF-8 text to/from raw bytes, WITHOUT `TextEncoder`/
 * `TextDecoder` — this app has no polyfill for either, and (confirmed on
 * device) `TextDecoder` does not work under Hermes: it silently produced
 * unparseable output, which is what made `.kiko` import fail while the same
 * bytes decoded and `JSON.parse`d fine in Node. Bit-shifting and
 * `String.fromCharCode`/`String.fromCodePoint`/`codePointAt` only — all
 * plain ECMAScript, not Web/Hermes-specific globals — so this is provably
 * correct under both Jest's Node engine and Hermes, the same rationale as
 * `base64.ts`.
 */
export const utf8Encode = (text: string): Uint8Array => {
  const bytes: number[] = [];

  for (let i = 0; i < text.length; i++) {
    const codePoint = text.codePointAt(i) ?? 0;

    if (codePoint > 0xffff) {
      // A surrogate pair consumed as one code point above — skip its low half.
      i++;
    }

    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }

  return Uint8Array.from(bytes);
};

/**
 * Decodes raw UTF-8 bytes back to text — the inverse of `utf8Encode`, and
 * the fix for the confirmed Hermes bug: this replaces the `bytesToUtf8`
 * (`new TextDecoder().decode()`) call that `.kiko` import used to make on
 * the decrypted plaintext.
 */
export const utf8Decode = (bytes: Uint8Array): string => {
  let result = '';
  let i = 0;

  while (i < bytes.length) {
    const byte1 = bytes[i] ?? 0;

    if (byte1 < 0x80) {
      result += String.fromCharCode(byte1);
      i += 1;
    } else if ((byte1 & 0xe0) === 0xc0) {
      const byte2 = bytes[i + 1] ?? 0;
      result += String.fromCharCode(((byte1 & 0x1f) << 6) | (byte2 & 0x3f));
      i += 2;
    } else if ((byte1 & 0xf0) === 0xe0) {
      const byte2 = bytes[i + 1] ?? 0;
      const byte3 = bytes[i + 2] ?? 0;
      result += String.fromCharCode(
        ((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f),
      );
      i += 3;
    } else {
      const byte2 = bytes[i + 1] ?? 0;
      const byte3 = bytes[i + 2] ?? 0;
      const byte4 = bytes[i + 3] ?? 0;
      result += String.fromCodePoint(
        ((byte1 & 0x07) << 18) | ((byte2 & 0x3f) << 12) | ((byte3 & 0x3f) << 6) | (byte4 & 0x3f),
      );
      i += 4;
    }
  }

  return result;
};
