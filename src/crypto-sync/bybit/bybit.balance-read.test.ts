import type { Currency } from '@kiko/currency/currency';

import { fundCoin, unifiedCoin } from './bybit.balance-test-fixtures';
import { type WalletRead, fundReadOf, unifiedReadOf } from './bybit.balance-read';

// The one list that holds the coin: a coin has one outcome, never two.
const outcomesOf = (read: WalletRead, coin: Currency): string[] =>
  (['balances', 'borrowed', 'refused', 'openOrder'] as const).filter((list) =>
    read[list].has(coin),
  );

describe('unifiedReadOf', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('reads the wallet balance of a tracked coin in its own minor units', () => {
    const read = unifiedReadOf([unifiedCoin('BTC', '0.00012345'), unifiedCoin('USD', '4150')]);

    expect([...read.balances]).toEqual([
      ['BTC', 12345],
      ['USD', 415000],
    ]);
    expect(read.refused.size + read.borrowed.size + read.untracked.length).toBe(0);
  });

  it('reads a zero balance as a coin held at zero', () => {
    expect([...unifiedReadOf([unifiedCoin('BTC', '0')]).balances]).toEqual([['BTC', 0]]);
  });

  it('rounds a balance past the scale of its coin', () => {
    expect([...unifiedReadOf([unifiedCoin('BTC', '0.123456789')]).balances]).toEqual([
      ['BTC', 12345679],
    ]);
  });

  it.each(['0', '0.0', '0.00000000'])('reads a loan of %s as no loan', (loan) => {
    const read = unifiedReadOf([unifiedCoin('BTC', '1', { spotBorrow: loan, borrowAmount: loan })]);

    expect([...read.balances]).toEqual([['BTC', 100000000]]);
  });

  describe.each(['spotBorrow', 'borrowAmount'] as const)('a non-zero %s', (field) => {
    it.each(['0.00000001', '12', '1.5'])('lists the coin as borrowed for %s', (loan) => {
      const read = unifiedReadOf([unifiedCoin('BTC', '1', { [field]: loan })]);

      expect([...read.borrowed]).toEqual(['BTC']);
      expect(read.balances.size + read.refused.size).toBe(0);
    });
  });

  it('lists the coin as borrowed when one loan field is non-zero and the other unreadable', () => {
    const read = unifiedReadOf([unifiedCoin('BTC', '1', { spotBorrow: '', borrowAmount: '2' })]);

    expect([...read.borrowed]).toEqual(['BTC']);
    expect(read.refused.size).toBe(0);
  });

  describe.each(['spotBorrow', 'borrowAmount'] as const)('an unreadable %s', (field) => {
    it.each([
      ['an empty text', ''],
      ['a word', 'none'],
      ['absent', undefined],
      ['a number', 0],
      ['null', null],
      ['a negative text', '-1'],
      ['an exponent form', '1e-8'],
    ])('refuses the coin alone for %s', (_title, loan) => {
      const read = unifiedReadOf([
        unifiedCoin('BTC', '1', { [field]: loan }),
        unifiedCoin('USD', '5'),
      ]);

      expect([...read.refused]).toEqual(['BTC']);
      expect([...read.balances]).toEqual([['USD', 500]]);
      expect(read.borrowed.size).toBe(0);
    });
  });

  it.each([
    ['an empty text', ''],
    ['a word', 'lots'],
    ['absent', undefined],
    ['null', null],
    ['a number, which Bybit does not send', 1],
    ['an exponent form', '1e-8'],
    ['a negative amount', '-0.5'],
    ['an amount past the safe integer', '90071992.54740992'],
  ])('refuses the coin alone for a wallet balance of %s', (_title, walletBalance) => {
    const read = unifiedReadOf([unifiedCoin('BTC', walletBalance), unifiedCoin('USD', '5')]);

    expect([...read.refused]).toEqual(['BTC']);
    expect([...read.balances]).toEqual([['USD', 500]]);
  });

  it('refuses a coin that two rows list, since one of them may repeat the other', () => {
    const read = unifiedReadOf([unifiedCoin('BTC', '1'), unifiedCoin('BTC', '2')]);

    expect([...read.refused]).toEqual(['BTC']);
    expect(read.balances.size).toBe(0);
  });

  it('lists a coin the app does not track once when it has a balance above zero', () => {
    const read = unifiedReadOf([
      unifiedCoin('PEPE', '5'),
      unifiedCoin('UAH', '1'),
      unifiedCoin('SCR', '2'),
      unifiedCoin('MNT', '0'),
    ]);

    expect(read.untracked).toEqual(['PEPE', 'UAH', 'SCR']);
    expect(read.balances.size + read.refused.size + read.borrowed.size).toBe(0);
  });

  it('lists an untracked coin that has two rows once, and one with no readable balance never', () => {
    const read = unifiedReadOf([
      unifiedCoin('PEPE', '0'),
      unifiedCoin('PEPE', '5'),
      unifiedCoin('DOGE2', 'many'),
      unifiedCoin('SHIB2', undefined),
    ]);

    expect(read.untracked).toEqual(['PEPE']);
  });

  it('does not read the loan fields of a coin the app does not track', () => {
    const read = unifiedReadOf([unifiedCoin('PEPE', '5', { spotBorrow: 'x', borrowAmount: '9' })]);

    expect(read.untracked).toEqual(['PEPE']);
    expect(read.borrowed.size + read.refused.size).toBe(0);
  });

  it('does not read the locked field of a coin the app does not track', () => {
    const read = unifiedReadOf([
      unifiedCoin('PEPE', '5', { locked: 'x' }),
      unifiedCoin('SHIB2', '0', { locked: '5' }),
    ]);

    expect(read.untracked).toEqual(['PEPE']);
    expect(read.openOrder.size + read.refused.size + read.borrowed.size).toBe(0);
  });

  it('a tracked Unified coin with locked above zero is set aside as an open order', () => {
    const read = unifiedReadOf([
      unifiedCoin('BTC', '1', { locked: '0.5' }),
      unifiedCoin('ETH', '0', { locked: '0.00000001' }),
      unifiedCoin('USD', '5'),
    ]);

    expect([...read.openOrder]).toEqual(['BTC', 'ETH']);
    expect([...read.balances]).toEqual([['USD', 500]]);
    expect(read.refused.size + read.borrowed.size + read.untracked.length).toBe(0);
  });

  it.each([
    ['an empty text', ''],
    ['absent', undefined],
    ['a word', 'none'],
    ['a number', 1],
    ['null', null],
    ['a negative text', '-1'],
    ['an exponent form', '1e-8'],
  ])('a tracked Unified coin is set aside for a locked of %s', (_title, locked) => {
    const read = unifiedReadOf([unifiedCoin('BTC', '1', { locked }), unifiedCoin('USD', '5')]);

    expect([...read.openOrder]).toEqual(['BTC']);
    expect([...read.balances]).toEqual([['USD', 500]]);
    expect(read.refused.size + read.borrowed.size).toBe(0);
  });

  it.each(['0', '0.0', '0.00000000'])('reads a locked of %s as no open order', (locked) => {
    const read = unifiedReadOf([unifiedCoin('BTC', '1', { locked })]);

    expect([...read.balances]).toEqual([['BTC', 100000000]]);
    expect(read.openOrder.size).toBe(0);
  });

  describe('one coin has one outcome by its loan, balance and locked', () => {
    const LOADED = { spotBorrow: '0', borrowAmount: '0.0' };

    it.each([
      ['row 1: no loan, a readable balance, locked zero', [unifiedCoin('BTC', '1')], 'balances'],
      [
        'row 2: no loan, a readable balance, locked above zero',
        [unifiedCoin('BTC', '1', { ...LOADED, locked: '3' })],
        'openOrder',
      ],
      [
        'row 3: no loan, a readable balance, locked that is no decimal text',
        [unifiedCoin('BTC', '1', { ...LOADED, locked: null })],
        'openOrder',
      ],
      [
        'row 4: a loan above zero wins over locked above zero',
        [unifiedCoin('BTC', '1', { spotBorrow: '0.1', locked: '3' })],
        'borrowed',
      ],
      [
        'row 4: a loan above zero wins over a locked that is no decimal text',
        [unifiedCoin('BTC', '1', { borrowAmount: '2', locked: '' })],
        'borrowed',
      ],
      [
        'row 4: a loan above zero wins over an unreadable loan field and locked above zero',
        [unifiedCoin('BTC', '1', { spotBorrow: '', borrowAmount: '2', locked: '3' })],
        'borrowed',
      ],
      [
        'row 5: a loan field that is no decimal text is refused, whatever locked says',
        [unifiedCoin('BTC', '1', { borrowAmount: '', locked: '3' })],
        'refused',
      ],
      [
        'row 5: a loan field that is no decimal text is refused beside an unreadable locked',
        [unifiedCoin('BTC', '1', { spotBorrow: undefined, locked: undefined })],
        'refused',
      ],
      [
        'row 6: an unreadable balance is refused, whatever locked says',
        [unifiedCoin('BTC', 'lots', { locked: '3' })],
        'refused',
      ],
      [
        'row 6: a negative balance is refused, whatever locked says',
        [unifiedCoin('BTC', '-1', { locked: '3' })],
        'refused',
      ],
      [
        'row 6: a balance past the safe integer is refused, whatever locked says',
        [unifiedCoin('BTC', '90071992.54740992', { locked: '3' })],
        'refused',
      ],
      [
        'row 7: two rows of one coin are refused, whatever locked says',
        [unifiedCoin('BTC', '1', { locked: '3' }), unifiedCoin('BTC', '1', { locked: '3' })],
        'refused',
      ],
    ])('%s', (_title, rows, list) => {
      const read = unifiedReadOf(rows);

      expect(outcomesOf(read, 'BTC')).toEqual([list]);
    });
  });

  it('reads an empty list as a wallet that holds nothing', () => {
    const read = unifiedReadOf([]);

    expect(read.balances.size + read.refused.size + read.borrowed.size).toBe(0);
    expect(read.untracked).toEqual([]);
  });
});

describe('fundReadOf', () => {
  it('reads the wallet balance of a tracked coin and needs no loan field', () => {
    const read = fundReadOf([fundCoin('BTC', '0.5'), fundCoin('PEPE', '3'), fundCoin('ETH', '0')]);

    expect([...read.balances]).toEqual([
      ['BTC', 50000000],
      ['ETH', 0],
    ]);
    expect(read.untracked).toEqual(['PEPE']);
    expect(read.borrowed.size).toBe(0);
  });

  it.each(['', 'x', undefined, 5, '-1'])(
    'refuses the coin alone for a wallet balance of %j',
    (walletBalance) => {
      const read = fundReadOf([fundCoin('BTC', walletBalance), fundCoin('ETH', '1')]);

      expect([...read.refused]).toEqual(['BTC']);
      expect([...read.balances]).toEqual([['ETH', 100000000]]);
    },
  );

  it('refuses a coin that two rows list', () => {
    const read = fundReadOf([fundCoin('BTC', '1'), fundCoin('BTC', '1')]);

    expect([...read.refused]).toEqual(['BTC']);
    expect(read.balances.size).toBe(0);
  });
});
