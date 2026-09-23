import { decodeBase64ToBytes, encodeBytesToBase64 } from './base64';

describe('encodeBytesToBase64 / decodeBase64ToBytes', () => {
  it('round-trips arbitrary bytes, including 0x00 and 0xff', () => {
    const bytes = Uint8Array.from([0, 1, 2, 254, 255, 128, 64, 32, 16]);
    expect(decodeBase64ToBytes(encodeBytesToBase64(bytes))).toEqual(bytes);
  });

  it('round-trips an empty byte array to an empty string', () => {
    expect(encodeBytesToBase64(new Uint8Array(0))).toBe('');
    expect(decodeBase64ToBytes('')).toEqual(new Uint8Array(0));
  });

  it('pads the output to a multiple of 4 characters, per the standard base64 alphabet', () => {
    expect(encodeBytesToBase64(Uint8Array.from([1]))).toMatch(/^.{2}==$/);
    expect(encodeBytesToBase64(Uint8Array.from([1, 2]))).toMatch(/^.{3}=$/);
    expect(encodeBytesToBase64(Uint8Array.from([1, 2, 3]))).toMatch(/^.{4}$/);
  });

  it('round-trips a real 32-byte AES-256 key', () => {
    const key = Uint8Array.from({ length: 32 }, (_, i) => i * 7 + 1);
    expect(decodeBase64ToBytes(encodeBytesToBase64(key))).toEqual(key);
  });

  it('throws a clear error on an invalid character (a garbled pasted key)', () => {
    expect(() => decodeBase64ToBytes('not-valid-base64!!!')).toThrow(
      'data-transfer/base64: invalid character in base64 input',
    );
  });

  it('ignores surrounding whitespace/newlines a user might paste alongside the key', () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const withWhitespace = `  ${encodeBytesToBase64(bytes)}\n`;
    expect(decodeBase64ToBytes(withWhitespace)).toEqual(bytes);
  });
});
