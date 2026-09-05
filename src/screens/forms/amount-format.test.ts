import { parseAmount } from '../../currency/parse';

import { groupAmount } from './amount-format';

describe('groupAmount', () => {
  it('leaves an empty string empty', () => {
    expect(groupAmount('')).toBe('');
  });

  it('leaves a lone zero ungrouped', () => {
    expect(groupAmount('0')).toBe('0');
  });

  it('leaves a sub-thousand integer ungrouped', () => {
    expect(groupAmount('100')).toBe('100');
  });

  it('groups a thousand into one space-separated group', () => {
    expect(groupAmount('1000')).toBe('1 000');
  });

  it('groups a million into space-separated groups of three', () => {
    expect(groupAmount('1000000')).toBe('1 000 000');
  });

  it('groups the integer part and keeps a dot decimal part', () => {
    expect(groupAmount('1234.56')).toBe('1 234.56');
  });

  it('groups the integer part and keeps a comma decimal part (the iOS pad default)', () => {
    expect(groupAmount('1234,56')).toBe('1 234,56');
  });

  it('keeps a leading-zero fraction intact', () => {
    expect(groupAmount('0,99')).toBe('0,99');
  });

  it('preserves a trailing comma so a half-typed decimal does not drop the separator', () => {
    expect(groupAmount('12,')).toBe('12,');
  });

  it('preserves a trailing dot on a grouped integer', () => {
    expect(groupAmount('1000.')).toBe('1 000.');
  });

  it('re-groups when a digit is appended to an already-grouped value', () => {
    // The field holds "1 000" and the user types another "0" at the end, so
    // onChangeText delivers "1 0000"; the formatter strips the stale group space
    // and re-groups to "10 000" rather than leaving the digits mis-grouped.
    expect(groupAmount('1 0000')).toBe('10 000');
  });

  it('does not strip leading zeros a user is still typing', () => {
    expect(groupAmount('007')).toBe('007');
  });

  it('keeps a lone separator so the character the user typed is not dropped', () => {
    expect(groupAmount(',')).toBe(',');
  });

  it('preserves a leading minus and groups the magnitude', () => {
    expect(groupAmount('-50000')).toBe('-50 000');
  });

  it('reads the LAST separator as the decimal mark on a mixed-punctuation value', () => {
    // A pasted/hydrated European value carries BOTH a grouping dot and a decimal
    // comma. Picking the first separator would treat the grouping dot as the
    // decimal and mangle the number ("1.23456"); the last separator is the
    // decimal, matching parseAmount, so the grouping dot is stripped.
    expect(groupAmount('1.234,56')).toBe('1 234,56');
  });

  it('reads a trailing dot decimal as the mark when a grouping comma precedes it', () => {
    expect(groupAmount('1,234.56')).toBe('1 234.56');
  });
});

describe('groupAmount + parseAmount round-trip', () => {
  it('round-trips a grouped integer', () => {
    expect(parseAmount(groupAmount('1000000'))).toBe(1000000);
  });

  it('round-trips a grouped dot decimal', () => {
    expect(parseAmount(groupAmount('1234567.89'))).toBe(1234567.89);
  });

  it('round-trips a grouped comma decimal', () => {
    expect(parseAmount(groupAmount('1234567,89'))).toBe(1234567.89);
  });

  it('round-trips a grouped fraction below one', () => {
    expect(parseAmount(groupAmount('0,99'))).toBe(0.99);
  });

  it('round-trips a European mixed-punctuation value', () => {
    expect(parseAmount(groupAmount('1.234,56'))).toBe(1234.56);
  });
});
