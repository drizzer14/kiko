import { EXPORT_KEY_BYTES, generateExportKey } from './generate-key';

describe('generateExportKey', () => {
  it('returns a 32-byte (256-bit) key', () => {
    expect(generateExportKey().length).toBe(32);
    expect(EXPORT_KEY_BYTES).toBe(32);
  });

  it('returns a fresh, different key on every call', () => {
    const a = generateExportKey();
    const b = generateExportKey();
    expect(a).not.toEqual(b);
  });
});
