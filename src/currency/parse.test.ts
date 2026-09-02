import { parseAmount } from './parse';

describe('parseAmount', () => {
  it('parses a dot decimal separator', () => {
    expect(parseAmount('12.5')).toBe(12.5);
  });

  it('accepts a comma as a decimal separator (the iOS number pad default in many locales)', () => {
    expect(parseAmount('12,5')).toBe(12.5);
  });

  it('parses a plain integer string', () => {
    expect(parseAmount('1000')).toBe(1000);
  });

  it('parses a comma-separated integer-less fraction', () => {
    expect(parseAmount('0,99')).toBe(0.99);
  });

  it('treats commas as grouping separators when a dot is the decimal mark', () => {
    // "1,234.56": the dot is clearly the decimal mark, so the comma is a
    // thousands grouping separator and must be stripped, not turned into a dot.
    expect(parseAmount('1,234.56')).toBe(1234.56);
  });

  it('treats a lone comma as the decimal mark when there is no dot', () => {
    expect(parseAmount('1234,56')).toBe(1234.56);
  });

  it('parses the European "1.234,56" form (dot grouping, comma decimal) to 1234.56', () => {
    // Both separators present and the comma occurs last, so the comma is the
    // decimal mark and the dot is a thousands grouping separator. Documented
    // decision: this parses to 1234.56 rather than a silent NaN.
    expect(parseAmount('1.234,56')).toBe(1234.56);
  });

  it('returns NaN for an empty string', () => {
    expect(parseAmount('')).toBeNaN();
  });

  it('returns NaN for a whitespace-only string', () => {
    expect(parseAmount('   ')).toBeNaN();
  });

  it('returns NaN for non-numeric junk', () => {
    expect(parseAmount('abc')).toBeNaN();
  });

  it('returns NaN for a lone separator', () => {
    expect(parseAmount(',')).toBeNaN();
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(parseAmount('  12,5  ')).toBe(12.5);
  });
});
