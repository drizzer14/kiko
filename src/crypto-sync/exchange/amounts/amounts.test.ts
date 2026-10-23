import { bifold, isLeft } from 'fnts/either';
import type { Currency } from '@kiko/currency/currency';

import { type AmountError, exchangeMinorUnits } from '.';

// BTC stores 8 decimals and is not reduced; XRP stores 4, below the 8 its exchange sends.
const FULL_SCALE: Currency = 'BTC';
const REDUCED_SCALE: Currency = 'XRP';

const outcomeOf = (
  currency: Currency,
  text: string,
  use: 'balance' | 'row' | 'trade-row',
): { error: AmountError } | { units: number } => {
  const result = exchangeMinorUnits(currency, text, use);

  return isLeft(result) ? { error: bifold(result) } : { units: bifold(result) };
};

describe('exchangeMinorUnits', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it.each(['balance', 'row'] as const)('returns exact minor units for a %s', (use) => {
    expect(outcomeOf(FULL_SCALE, '0.00012345', use)).toEqual({ units: 12345 });
    expect(outcomeOf(REDUCED_SCALE, '12.3456', use)).toEqual({ units: 123456 });
    expect(outcomeOf('USD', '4150', use)).toEqual({ units: 415000 });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['balance', 'row'] as const)(
    'drops trailing zeros past the scale of a %s without logging a rounding',
    (use) => {
      expect(outcomeOf(FULL_SCALE, '0.500000000', use)).toEqual({ units: 50_000_000 });
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('refuses more decimals than the scale for a row', () => {
    expect(outcomeOf(FULL_SCALE, '0.123456789', 'row')).toEqual({ error: 'amount-precision' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('treats a fiat currency as stored at full scale', () => {
    expect(outcomeOf('USD', '1.005', 'row')).toEqual({ error: 'amount-precision' });
    expect(outcomeOf('USD', '1.005', 'balance')).toEqual({ units: 101 });
  });

  it('rounds a balance with more decimals than the scale half away from zero', () => {
    expect(outcomeOf(FULL_SCALE, '0.000000015', 'balance')).toEqual({ units: 2 });
    expect(outcomeOf(FULL_SCALE, '0.000000014', 'balance')).toEqual({ units: 1 });
    expect(outcomeOf(FULL_SCALE, '-0.000000015', 'balance')).toEqual({ units: -2 });
  });

  it('logs a fixed tag for a rounded balance, with no amount in it', () => {
    exchangeMinorUnits(FULL_SCALE, '0.000000015', 'balance');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('balance-precision-rounded', {
      name: 'Error',
      code: undefined,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('15');
  });

  it('rounds a row on a reduced-scale coin half away from zero', () => {
    expect(outcomeOf(REDUCED_SCALE, '1.23455', 'row')).toEqual({ units: 12346 });
    expect(outcomeOf(REDUCED_SCALE, '1.23454', 'row')).toEqual({ units: 12345 });
    expect(outcomeOf(REDUCED_SCALE, '-1.23455', 'row')).toEqual({ units: -12346 });
  });

  it('logs a fixed tag for a rounded row, with no amount in it', () => {
    exchangeMinorUnits(REDUCED_SCALE, '1.23455', 'row');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('row-precision-rounded', { name: 'Error', code: undefined });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('23455');
  });

  describe('a trade row', () => {
    it('rounds a fiat amount past its scale half away from zero and logs the row tag once', () => {
      expect(outcomeOf('EUR', '612.3456789', 'trade-row')).toEqual({ units: 61235 });
      expect(outcomeOf('EUR', '0.004', 'trade-row')).toEqual({ units: 0 });
      expect(outcomeOf('EUR', '1.005', 'trade-row')).toEqual({ units: 101 });
      expect(outcomeOf('EUR', '-1.005', 'trade-row')).toEqual({ units: -101 });
      expect(warn).toHaveBeenCalledTimes(4);
      expect(warn).toHaveBeenCalledWith('row-precision-rounded', {
        name: 'Error',
        code: undefined,
      });
    });

    it('logs nothing for a fiat amount that fits its scale', () => {
      expect(outcomeOf('EUR', '612.30', 'trade-row')).toEqual({ units: 61230 });
      expect(warn).not.toHaveBeenCalled();
    });

    it('rounds a reduced-scale coin as a row does, and still refuses a full-scale coin', () => {
      expect(outcomeOf(REDUCED_SCALE, '1.23455', 'trade-row')).toEqual({ units: 12346 });
      expect(outcomeOf(FULL_SCALE, '0.123456789', 'trade-row')).toEqual({
        error: 'amount-precision',
      });
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('refuses a fiat amount that rounds past the safe integer, with no rounding logged', () => {
      expect(outcomeOf('EUR', '90071992547409.925', 'trade-row')).toEqual({
        error: 'amount-too-large',
      });
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it.each(['balance', 'row'] as const)('refuses above the safe integer for a %s', (use) => {
    expect(outcomeOf(FULL_SCALE, '90071992.54740992', use)).toEqual({ error: 'amount-too-large' });
    expect(outcomeOf(FULL_SCALE, '90071992.54740991', use)).toEqual({
      units: Number.MAX_SAFE_INTEGER,
    });
  });

  it('logs no rounding for a balance that rounds out of range', () => {
    expect(outcomeOf(FULL_SCALE, '90071992.547409915', 'balance')).toEqual({
      error: 'amount-too-large',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['a word', 'x'],
    ['an empty text', ''],
    ['a blank text', '   '],
    ['an Infinity text', 'Infinity'],
  ])('refuses %s as malformed', (_label, text) => {
    expect(outcomeOf(FULL_SCALE, text, 'row')).toEqual({ error: 'amount-malformed' });
  });

  it.each(['balance', 'row'] as const)('refuses an exponent form for a %s', (use) => {
    expect(outcomeOf(FULL_SCALE, '1e-8', use)).toEqual({ error: 'amount-malformed' });
    expect(outcomeOf(REDUCED_SCALE, '1.5E+3', use)).toEqual({ error: 'amount-malformed' });
    expect(warn).not.toHaveBeenCalled();
  });
});
