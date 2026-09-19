import { utf8Decode, utf8Encode } from './utf8';

describe('utf8Encode / utf8Decode', () => {
  it('round-trips ASCII', () => {
    const text = 'Kiko export test 123';
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  it('round-trips Cyrillic multi-byte text', () => {
    const text = 'Сільпо, Приватбанк';
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  it('round-trips a 4-byte emoji (surrogate pair)', () => {
    const text = '🎉💳🇺🇦';
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  it('round-trips an empty string', () => {
    expect(utf8Decode(utf8Encode(''))).toBe('');
  });

  it('round-trips a mixed string of ASCII, Cyrillic, and emoji', () => {
    const text = 'Coffee ☕ у Києві 🎉 — 42.50 UAH';
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  // Critical compatibility check: files already exported with the previous
  // `TextEncoder`/`TextDecoder` (`@noble/ciphers` `utf8ToBytes`/`bytesToUtf8`)
  // path — including the committed demo fixtures — must still decode
  // correctly, and any bytes this codec produces must be readable by a
  // standard-conforming UTF-8 decoder elsewhere. Node has both `TextEncoder`
  // and `TextDecoder` as real globals, so this proves standard-UTF-8
  // byte-for-byte parity without needing Hermes.
  describe('standard UTF-8 compatibility', () => {
    const samples = [
      'Kiko export test 123',
      'Сільпо, Приватбанк',
      '🎉💳🇺🇦',
      '',
      'Coffee ☕ у Києві 🎉 — 42.50 UAH',
    ];

    it.each(samples)('utf8Encode(%j) matches TextEncoder byte-for-byte', (text) => {
      expect(utf8Encode(text)).toEqual(new TextEncoder().encode(text));
    });

    it.each(samples)('utf8Decode reads bytes produced by TextEncoder for %j', (text) => {
      expect(utf8Decode(new TextEncoder().encode(text))).toBe(text);
    });
  });
});
