import { fundReadOf, unifiedReadOf } from './bybit.balance-read';
import { fundCoin, unifiedCoin } from './bybit.balance-test-fixtures';

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
