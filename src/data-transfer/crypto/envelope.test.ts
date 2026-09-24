import { decodeBase64ToBytes, encodeBytesToBase64 } from '../base64/base64';

import { generateExportKey } from './generate-key';
import { decryptEnvelope, encryptEnvelope, EXPORT_FORMAT, EXPORT_VERSION } from './envelope';

describe('encryptEnvelope / decryptEnvelope', () => {
  it('round-trips arbitrary plaintext under the same key', () => {
    const key = generateExportKey();
    const plaintext = new TextEncoder().encode('{"hello":"world"}');

    const envelope = encryptEnvelope(plaintext, key);

    expect(envelope.version).toBe(EXPORT_VERSION);
    expect(envelope.format).toBe(EXPORT_FORMAT);
    expect(decryptEnvelope(envelope, key)).toEqual(plaintext);
  });

  it('produces a different nonce (and different ciphertext) on every call, even for identical plaintext and key', () => {
    const key = generateExportKey();
    const plaintext = new TextEncoder().encode('same plaintext');

    const first = encryptEnvelope(plaintext, key);
    const second = encryptEnvelope(plaintext, key);

    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('rejects decryption with the wrong key', () => {
    const key = generateExportKey();
    const wrongKey = generateExportKey();
    const envelope = encryptEnvelope(new TextEncoder().encode('secret'), key);

    expect(() => decryptEnvelope(envelope, wrongKey)).toThrow('data-transfer/decrypt');
  });

  it('rejects a tampered ciphertext (a single flipped byte)', () => {
    const key = generateExportKey();
    const envelope = encryptEnvelope(new TextEncoder().encode('secret'), key);
    const tamperedBytes = decodeBase64ToBytes(envelope.ciphertext);
    tamperedBytes[0] ^= 0xff;
    const tamperedEnvelope = { ...envelope, ciphertext: encodeBytesToBase64(tamperedBytes) };

    expect(() => decryptEnvelope(tamperedEnvelope, key)).toThrow('data-transfer/decrypt');
  });

  it('rejects a tampered nonce', () => {
    const key = generateExportKey();
    const envelope = encryptEnvelope(new TextEncoder().encode('secret'), key);
    const tamperedBytes = decodeBase64ToBytes(envelope.nonce);
    tamperedBytes[0] ^= 0xff;
    const tamperedEnvelope = { ...envelope, nonce: encodeBytesToBase64(tamperedBytes) };

    expect(() => decryptEnvelope(tamperedEnvelope, key)).toThrow('data-transfer/decrypt');
  });

  it('rejects an envelope with the wrong format/version header', () => {
    const key = generateExportKey();
    const envelope = encryptEnvelope(new TextEncoder().encode('secret'), key);

    expect(() =>
      decryptEnvelope({ ...envelope, format: 'not-kiko-export' as typeof EXPORT_FORMAT }, key),
    ).toThrow('data-transfer/decrypt');
    expect(() =>
      decryptEnvelope({ ...envelope, version: 99 as typeof EXPORT_VERSION }, key),
    ).toThrow('data-transfer/decrypt');
  });
});
