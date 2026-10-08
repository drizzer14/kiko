import path from 'node:path';
import { readFileSync } from 'node:fs';
import { SENSEBANK_PREAMBLE } from '@kiko/statement-import/formats/sensebank-csv';

const mockUnlink = jest.fn();
jest.mock('react-native-fs', () => ({
  unlink: (...args: unknown[]) => mockUnlink(...args),
  CachesDirectoryPath: '/mock/caches',
}));

import {
  isLegacyXlsFile,
  decodeStatementText,
  readSheetRowsSafely,
  deleteLocalStatementCopy,
} from './read-statement-file';

// The real Monobank fixture, read as raw bytes then base64-encoded — the
// exact shape `RNFS.readFile(filePath, 'base64')` hands the screen — so this
// proves the base64 -> UTF-8 decode pipeline round-trips a real multi-byte
// (Cyrillic) file back to the SAME text `readFileSync(..., 'utf-8')` reads
// directly, not just some plausible-looking string.
const monobankFixturePath = path.join(
  __dirname,
  '../formats/monobank-csv/__fixtures__/uabean-monobank-sample.csv',
);
const monobankBase64 = readFileSync(monobankFixturePath).toString('base64');
const monobankUtf8Text = readFileSync(monobankFixturePath, 'utf-8');

// The real Sensebank fixture (cp1251-encoded) — base64-encoded
// the same way, then decoded through the 'windows-1251' branch.
const sensebankFixturePath = path.join(
  __dirname,
  '../formats/sensebank-csv/__fixtures__/uabean-sensebank-sample.csv',
);
const sensebankBase64 = readFileSync(sensebankFixturePath).toString('base64');

describe('decodeStatementText', () => {
  it('decodes the Monobank fixture bytes (base64, utf-8) to the same text readFileSync reads directly', () => {
    expect(decodeStatementText(monobankBase64, 'utf-8')).toBe(monobankUtf8Text);
  });

  it('decodes the Sensebank fixture bytes (base64, windows-1251) to text starting with the real preamble', () => {
    expect(
      decodeStatementText(sensebankBase64, 'windows-1251').startsWith(SENSEBANK_PREAMBLE),
    ).toBe(true);
  });
});

const privatbankXlsxFixturePath = path.join(
  __dirname,
  '../formats/privatbank-xlsx/__fixtures__/synthetic-privatbank-sample.xlsx',
);
const privatbankXlsxBase64 = readFileSync(privatbankXlsxFixturePath).toString('base64');

describe('readSheetRowsSafely', () => {
  it('returns the parsed sheet rows for a genuinely valid .xlsx file', async () => {
    const rows = await readSheetRowsSafely(privatbankXlsxBase64);

    expect(rows?.length).toBeGreaterThan(0);
  });

  it('returns undefined for a corrupted/unparseable .xlsx file, rather than throwing', async () => {
    const notAnXlsxFile = Buffer.from('not a real xlsx file').toString('base64');

    await expect(readSheetRowsSafely(notAnXlsxFile)).resolves.toBeUndefined();
  });
});

describe('isLegacyXlsFile', () => {
  it('is true for an uppercase .XLS extension', () => {
    expect(isLegacyXlsFile('a.XLS')).toBe(true);
  });

  it('is false for a .xlsx extension', () => {
    expect(isLegacyXlsFile('a.xlsx')).toBe(false);
  });
});

// The local cache copy `keepLocalCopy` makes is a plaintext
// bank-statement copy outside the
// SQLCipher-encrypted database — best-effort deleted once the flow that
// owns it ends.
describe('deleteLocalStatementCopy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('unlinks a path inside the app cache directory', async () => {
    await deleteLocalStatementCopy('/mock/caches/statement-123.csv');

    expect(mockUnlink).toHaveBeenCalledWith('/mock/caches/statement-123.csv');
  });

  it('never unlinks a path outside the app cache directory (the raw-uri fallback)', async () => {
    await deleteLocalStatementCopy('file:///private/var/mobile/Containers/Shared/statement.csv');

    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('swallows an unlink failure (already deleted, or never existed) rather than throwing', async () => {
    mockUnlink.mockRejectedValue(new Error('ENOENT'));

    await expect(
      deleteLocalStatementCopy('/mock/caches/statement-123.csv'),
    ).resolves.toBeUndefined();
  });

  // `keepLocalCopy`'s real iOS
  // `localUri` is a percent-encoded `file://` URL
  // (`destinationUrl.absoluteString`), not the plain path
  // `RNFS.CachesDirectoryPath` is — a bare `startsWith` comparison against
  // the raw URL always failed, so this deleted nothing on a real device.
  it('unlinks a realistic file:// keepLocalCopy URL (with an encoded space), normalized to the plain decoded path', async () => {
    await deleteLocalStatementCopy(
      'file:///mock/caches/E1B2C3D4-5678-90AB-CDEF-1234567890AB/Bank%20Statement.csv',
    );

    expect(mockUnlink).toHaveBeenCalledWith(
      '/mock/caches/E1B2C3D4-5678-90AB-CDEF-1234567890AB/Bank Statement.csv',
    );
  });

  it('still unlinks a plain (non-file://) cache path unchanged', async () => {
    await deleteLocalStatementCopy('/mock/caches/statement-123.csv');

    expect(mockUnlink).toHaveBeenCalledWith('/mock/caches/statement-123.csv');
  });
});
