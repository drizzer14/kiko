import { parseAmountCell } from './amount';

describe('parseAmountCell', () => {
  // Review Focus 1: an XLSX number cell is used AS-IS, never re-parsed
  // through the separator rule — otherwise 123.45 read with ',' becomes
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
});
