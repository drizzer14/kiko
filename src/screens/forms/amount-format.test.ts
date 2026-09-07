import { type Currency, currencyOptions, currencyScale } from '../../currency/currency';
import { Money } from '../../currency/money';
import { parseAmount } from '../../currency/parse';

import { groupAmount, majorAmountText } from './amount-format';

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

describe('majorAmountText', () => {
  it('renders sub-1e-6 BTC amounts at full scale, never in exponent form', () => {
    expect(majorAmountText('BTC', 50)).toBe('0.0000005');
    expect(majorAmountText('BTC', 10)).toBe('0.0000001');
    expect(majorAmountText('BTC', 99)).toBe('0.00000099');
    expect(majorAmountText('BTC', 1)).toBe('0.00000001');
  });

  it('trims trailing zeros but keeps a meaningful fraction', () => {
    expect(majorAmountText('BTC', 100_000_000)).toBe('1');
    expect(majorAmountText('BTC', 150_000_000)).toBe('1.5');
    expect(majorAmountText('UAH', 123_456)).toBe('1234.56');
    expect(majorAmountText('UAH', 100)).toBe('1');
    expect(majorAmountText('UAH', 0)).toBe('0');
  });

  it('renders the unsigned magnitude (the sign chip carries polarity)', () => {
    expect(majorAmountText('UAH', -123_456)).toBe('1234.56');
  });
});

describe('groupAmount fail-safe', () => {
  it('never turns an exponent string into a fabricated digit run', () => {
    expect(groupAmount('5e-7')).not.toBe('57');
    expect(groupAmount('5e-7')).toBe('');
  });

  it('still round-trips ordinary typed input', () => {
    expect(groupAmount('1000000')).toBe('1 000 000');
    expect(groupAmount('12,')).toBe('12,');
    expect(groupAmount('007')).toBe('007');
    expect(groupAmount(',')).toBe(',');
    expect(groupAmount('-1234.5')).toBe('-1 234.5');
    expect(groupAmount('0.0000005')).toBe('0.0000005');
  });
});

// Money precision rule: exact parity. Every string `majorAmountText` renders
// must round-trip — through the same pipeline the form uses (`groupAmount`
// then `parseAmount`) — back to the EXACT stored minor units, for every
// currency scale in the table, not just BTC's dust case.
describe('majorAmountText -> groupAmount -> parseAmount round-trip (exact parity)', () => {
  const samplesByCurrency: Record<Currency, number[]> = {
    BTC: [0, 1, 5, 10, 50, 99, 12_345, 100_000_000, 150_000_000, 123_456_789],
    UAH: [0, 1, 50, 99, 100, 12_345, 123_456],
    USD: [0, 1, 50, 99, 100, 250_000],
    EUR: [0, 1, 50, 99, 100, 250_000],
  };

  it.each(currencyOptions)('round-trips every sample minor-units value for %s', (currency) => {
    for (const minorUnits of samplesByCurrency[currency]) {
      const rendered = majorAmountText(currency, minorUnits);
      const grouped = groupAmount(rendered);
      const parsed = parseAmount(grouped);

      expect(Money.fromMajor(currency, parsed).minorUnits).toBe(minorUnits);
    }
  });

  it('never emits a fractional digit beyond the currency scale', () => {
    for (const currency of currencyOptions) {
      const rendered = majorAmountText(currency, 123_456_789);
      const fractionDigits = rendered.includes('.') ? rendered.split('.')[1].length : 0;

      expect(fractionDigits).toBeLessThanOrEqual(currencyScale[currency]);
    }
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
