import { decode as decodeWindows1251 } from 'windows-1251';

// A cp1251-decode unit test, DELIBERATELY independent of the CSV parser
// (`sensebank-csv.format.test.ts`) — so a bug in the byte-decode step (the
// screen's forthcoming UTF-8-then-cp1251 fallback) and a bug in the
// CSV/row-shape logic never look like the same failure.
//
// The byte values below are NOT copied from any decode call this suite
// makes elsewhere — they are the standard windows-1251 codepage's own
// documented single-byte mapping for the Cyrillic block (uppercase А-Я =
// 0xC0-0xDF, lowercase а-я = 0xE0-0xFF, in alphabetical order), computed by
// hand against that public table, independent of the `windows-1251` npm
// library's own implementation. If the library (or a future swap to a
// different cp1251 implementation) ever decoded these bytes to anything
// other than the expected Ukrainian text, this test — and only this one —
// would fail, distinctly from any CSV-shape assertion.
describe('windows-1251 (cp1251) decode — the building block the screen fallback needs', () => {
  it('decodes a known cp1251 byte sequence to the expected Ukrainian word ("Рахунок" — "Account")', () => {
    const bytes = new Uint8Array([0xd0, 0xe0, 0xf5, 0xf3, 0xed, 0xee, 0xea]);

    expect(decodeWindows1251(bytes)).toBe('Рахунок');
  });

  // The exact literal preamble line Sensebank's `detect` matches on (section
  // C.2) — a real, multi-word, punctuation-bearing sentence, not just one
  // short word, so a byte-offset-by-one class of bug (which a single short
  // word could miss) is caught too.
  it('decodes the real Sensebank preamble line bytes to the exact expected text', () => {
    const bytes = new Uint8Array([
      194, 232, 239, 232, 241, 234, 224, 32, 231, 224, 32, 240, 224, 245, 243, 237, 234, 238, 236,
      59, 59, 59, 59, 59, 59, 59,
    ]);

    expect(decodeWindows1251(bytes)).toBe('Виписка за рахунком;;;;;;;');
  });

  // A UTF-8 byte sequence run through the cp1251 table must NOT accidentally
  // decode to valid-looking Ukrainian text — proves the two encodings are
  // genuinely distinguishable, which is the whole premise the screen's
  // "try UTF-8 first, then cp1251" fallback relies on.
  it('does not decode a real UTF-8-encoded Ukrainian phrase to itself', () => {
    const utf8Bytes = new Uint8Array(Buffer.from('Виписка', 'utf-8'));

    expect(decodeWindows1251(utf8Bytes)).not.toBe('Виписка');
  });
});
