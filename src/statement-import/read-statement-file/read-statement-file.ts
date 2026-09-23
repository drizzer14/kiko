import readXlsxFile from 'read-excel-file/browser';
import { decode as decodeWindows1251 } from 'windows-1251';

import type { SpreadsheetCellValue } from '../parser';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Decodes a base64 string to its raw bytes, WITHOUT `Buffer` (not guaranteed
// to exist as a global under Hermes — this app has no `buffer` polyfill
// anywhere, confirmed by grep) and without `atob` (a standard global too, but
// one that only ever yields a Latin-1 byte string, one JS char per byte —
// exactly the shape `decodeUtf8Bytes` below needs, so a real `atob` would
// have worked as the FIRST half of this pipeline; it is avoided here purely
// because its Hermes availability is equally unverified, not because of any
// UTF-8 defect in what it returns). Table lookup + bit-shifting only, so this
// is provably correct under both Jest's Node engine and Hermes — no
// engine-specific API, just arithmetic.
const decodeBase64ToBytes = (base64: string): number[] => {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bitsCollected = 0;

  // The regex above already dropped every character not in
  // `BASE64_ALPHABET`, so `BASE64_ALPHABET.indexOf(char)` can never miss
  // here — no `=== -1` guard needed.
  for (const char of clean) {
    const sextet = BASE64_ALPHABET.indexOf(char);

    buffer = (buffer << 6) | sextet;
    bitsCollected += 6;

    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      bytes.push((buffer >> bitsCollected) & 0xff);
    }
  }

  return bytes;
};

// Decodes a UTF-8 byte sequence to a JS string, handling every 1/2/3/4-byte
// form (the Monobank fixture's Cyrillic descriptions are 2-byte) — this is
// the step a bare `atob()` skips, which is what corrupts multi-byte text
// (see the task brief's base64-decode ruling): `atob` alone treats each BYTE
// as one Latin-1 CHARACTER, so a 2-byte Cyrillic codepoint renders as two
// mangled Latin-1 characters instead of being recombined into one.
const decodeUtf8Bytes = (bytes: number[]): string => {
  let result = '';
  let index = 0;

  while (index < bytes.length) {
    const byte1 = bytes[index];

    if (byte1 < 0x80) {
      result += String.fromCharCode(byte1);
      index += 1;
    } else if ((byte1 & 0xe0) === 0xc0) {
      const codepoint = ((byte1 & 0x1f) << 6) | (bytes[index + 1] & 0x3f);
      result += String.fromCharCode(codepoint);
      index += 2;
    } else if ((byte1 & 0xf0) === 0xe0) {
      const codepoint =
        ((byte1 & 0x0f) << 12) | ((bytes[index + 1] & 0x3f) << 6) | (bytes[index + 2] & 0x3f);
      result += String.fromCharCode(codepoint);
      index += 3;
    } else {
      const codepoint =
        ((byte1 & 0x07) << 18) |
        ((bytes[index + 1] & 0x3f) << 12) |
        ((bytes[index + 2] & 0x3f) << 6) |
        (bytes[index + 3] & 0x3f);
      const surrogatePair = codepoint - 0x10000;
      result += String.fromCharCode(
        0xd800 + (surrogatePair >> 10),
        0xdc00 + (surrogatePair & 0x3ff),
      );
      index += 4;
    }
  }

  return result;
};

// The file's own basename, derived from the resolved `filePath` — none of the
// shipped formats' `detect`/`parse` actually reads `fileName` (see
// `monobank-csv.format.ts`), but `StatementFormatInput` still carries it, so
// a real (if inert) value is passed rather than an empty string.
export const fileNameOf = (filePath: string): string => filePath.split('/').pop() ?? filePath;

// PrivatBank XLSX is the only spreadsheet format in scope (section C.5) —
// an honest, visible extension check decides the text-vs-spreadsheet branch
// below, not a hidden flag. Every other picked file (every CSV format
// shipped so far) takes the existing UTF-8 text path.
export const isXlsxFile = (fileName: string): boolean => fileName.toLowerCase().endsWith('.xlsx');

// The legacy binary `.xls` extension (as opposed to the modern `.xlsx` OOXML
// format `isXlsxFile` detects) — an honest, visible extension check the same
// way `isXlsxFile` is, added for the generic column-mapping import path's own
// file-type branching.
export const isLegacyXlsFile = (fileName: string): boolean =>
  fileName.toLowerCase().endsWith('.xls');

// Runs the async `read-excel-file` parse ONCE, ahead of `detectFormat`/
// `format.parse` (both synchronous — see `StatementFormatInput.sheetRows`'s
// doc comment in `parser.ts`). [VERIFY AT BUILD TIME]: the `/browser` entry
// point is the Hermes-safe choice picked here — it accepts a plain
// `ArrayBuffer` (no Node `Buffer`, no DOM `File`/`Blob`), matching exactly
// what `decodeBase64ToBytes` above already produces from the picked file's
// base64 content; this cannot be proven under Jest (which runs on Node, not
// Hermes), only by a real on-device import.
export const readSheetRowsSafely = async (
  base64: string,
): Promise<SpreadsheetCellValue[][] | undefined> => {
  const arrayBuffer = new Uint8Array(decodeBase64ToBytes(base64)).buffer;

  try {
    const sheets = await readXlsxFile(arrayBuffer);

    return sheets[0]?.data as SpreadsheetCellValue[][] | undefined;
  } catch {
    // A genuinely invalid/corrupted `.xlsx` — degrades to the same "we don't
    // recognize this file" state `previewStats` already shows for any other
    // format-level failure (no `sheetRows` means `detectFormat` recognizes
    // nothing), rather than a distinct crash/error path.
    return undefined;
  }
};

// The one Hermes-safe base64 -> text decode path for a picked file's
// content — see `decodeBase64ToBytes`/`decodeUtf8Bytes` above for why the
// 'utf-8' branch does not reach for `Buffer` or `atob`. The 'windows-1251'
// branch reuses the SAME byte array through the `windows-1251` npm library
// (section C.2's KEY DESIGN — Sensebank and the FOP/business CSVs are
// cp1251-encoded, not UTF-8), so both encodings share one base64 decode
// step and only diverge on how the resulting bytes are turned into text.
export const decodeStatementText = (base64: string, encoding: 'utf-8' | 'windows-1251'): string => {
  const bytes = decodeBase64ToBytes(base64);

  return encoding === 'utf-8' ? decodeUtf8Bytes(bytes) : decodeWindows1251(new Uint8Array(bytes));
};
