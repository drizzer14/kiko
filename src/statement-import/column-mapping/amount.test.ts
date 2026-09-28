import { parseAmountCell } from './amount';

describe('parseAmountCell', () => {
  // An XLSX number cell is used AS-IS, never re-parsed through the
  // separator rule — otherwise 123.45 read with ',' becomes
  // 12345 (the '.' would be treated as a stray other-separator and dropped).
  it('uses a number cell as-is, ignoring the separator entirely', () => {
    expect(parseAmountCell(123.45, ',')).toBe(123.45);
  });

  it('parses a grouped string amount, dropping the other separator', () => {
    expect(parseAmountCell('1 234,56', ',')).toBe(1_234.56);
  });

  it('converts the U+2212 minus sign to an ASCII minus', () => {
    expect(parseAmountCell('−150,00', ',')).toBe(-150);
  });

  it('strips a non-breaking space used as a grouping character', () => {
    expect(parseAmountCell('1 234,56', ',')).toBe(1_234.56);
  });

  it('parses an unsigned debit string with a dot separator', () => {
    expect(parseAmountCell('150.00', '.')).toBe(150);
  });

  it('parses a signed debit string with a comma separator', () => {
    expect(parseAmountCell('-150,00', ',')).toBe(-150);
  });

  it('parses an unsigned positive amount with a dot separator and no grouping', () => {
    expect(parseAmountCell('19.32', '.')).toBe(19.32);
  });

  it('returns NaN for a non-numeric string', () => {
    expect(parseAmountCell('not a number', ',')).toBeNaN();
  });

  it('returns NaN for an empty string', () => {
    expect(parseAmountCell('', ',')).toBeNaN();
  });

  // The "other" character is only a real thousands-grouping separator when
  // every group after it is exactly 3 digits — a decimal amount misread with
  // the wrong chip (a Ukrainian "-150,00" read with '.' picked as decimal)
  // must fail instead of silently reading as -15000, 100x too large.
  it('returns NaN when the other separator is not in a real thousands-group position (wrong chip, not real grouping)', () => {
    expect(parseAmountCell('-150,00', '.')).toBeNaN();
  });

  it('returns NaN for the mirror-image case (a dot misread as the decimal separator)', () => {
    expect(parseAmountCell('-150.00', ',')).toBeNaN();
  });

  it('still strips a genuine thousands-group comma ahead of a dot decimal', () => {
    expect(parseAmountCell('1,234.56', '.')).toBe(1_234.56);
  });

  it('still strips a genuine thousands-group dot ahead of a comma decimal', () => {
    expect(parseAmountCell('1.234,56', ',')).toBe(1_234.56);
  });

  it('accepts a whole-number amount grouped by the other separator, with no decimal part at all', () => {
    expect(parseAmountCell('1,234', '.')).toBe(1_234);
  });

  it('accepts more than one real thousands group', () => {
    expect(parseAmountCell('12,345,678.90', '.')).toBe(12_345_678.9);
  });

  it('rejects a group after the other separator that is too short even with no decimal part', () => {
    expect(parseAmountCell('1,23', '.')).toBeNaN();
  });

  // The first group (before the first grouping separator) must itself be a
  // valid thousands-group lead-in: 1-3 digits, no leading zero, unless it is
  // exactly "0" with no group following it — and the OTHER separator must
  // never land after the decimal separator (it would then sit inside the
  // fractional part rather than the integer grouping).
  describe.each([
    ['0,125', '.', true, 'a leading-zero first group followed by another group'],
    ['1234,567', '.', true, 'a first group longer than 3 digits'],
    ['1,234.567', ',', true, "the other separator inside the decimal separator's fraction"],
    ['1,234', '.', false, 'a plain single thousands group'],
    ['12,345,678.90', '.', false, 'more than one real thousands group'],
    ['-1,234.56', '.', false, 'a negative amount with a valid thousands group'],
  ] as const)('%s parsed with %s separator', (cell, separator, expectNaN, description) => {
    it(`${expectNaN ? 'rejects' : 'accepts'} ${description}`, () => {
      const result = parseAmountCell(cell, separator);

      if (expectNaN) {
        expect(result).toBeNaN();
      } else {
        expect(result).not.toBeNaN();
      }
    });
  });
});
