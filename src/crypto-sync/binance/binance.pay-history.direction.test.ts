import { DAY_MS } from '@kiko/dates';

import { BinanceWalkStop } from './binance.history-walk';
import type { BinancePayOrder } from './binance.history-client';
import { payDescription, payDirection, payRowsOf } from './binance.pay-history';

const NOW = Date.UTC(2026, 9, 10);
const ACCOUNT_ID = 'acc-1';
const OWN = '1001';
const OTHER = '2002';

const party = (name: string | undefined, binanceId: string | undefined) => ({ name, binanceId });

const order = (over: Partial<BinancePayOrder> = {}): BinancePayOrder => ({
  orderType: 'C2C',
  transactionId: 'tx-1',
  transactionTime: NOW - DAY_MS,
  amount: '-0.001',
  currency: 'BTC',
  walletType: 2,
  walletTypes: undefined,
  fundsDetail: [],
  payerInfo: party(undefined, undefined),
  receiverInfo: party(undefined, undefined),
  ...over,
});

const stopCodeOf = (work: () => unknown): string | undefined => {
  try {
    work();
  } catch (error) {
    return error instanceof BinanceWalkStop ? error.code : undefined;
  }

  return undefined;
};

describe('payDirection: the spec matrix rows', () => {
  it('row 1: a C2C send by Binance ID is outgoing', () => {
    const sent = order({
      payerInfo: party('Me', OWN),
      receiverInfo: party('Ann', OTHER),
      amount: '-0.001',
    });

    expect(payDirection(sent, OWN)).toBe('out');
    expect(payDescription(sent, 'out')).toBe('Ann');
  });

  it('row 2: a C2C send by email or phone (no receiver id) is outgoing', () => {
    const sent = order({ payerInfo: party('Me', OWN), receiverInfo: party('Ann', undefined) });

    expect(payDirection(sent, OWN)).toBe('out');
  });

  it('row 3: a C2C receive is incoming and takes the payer name', () => {
    const received = order({
      payerInfo: party('Bob', undefined),
      receiverInfo: party('Me', OWN),
      amount: '0.001',
    });

    expect(payDirection(received, OWN)).toBe('in');
    expect(payDescription(received, 'in')).toBe('Bob');
  });

  it('row 4: a C2C receive with an unknown uid is incoming (shape and sign agree)', () => {
    const received = order({ receiverInfo: party('Me', OWN), amount: '0.001' });

    expect(payDirection(received, null)).toBe('in');
  });

  it('row 5: a send with an unknown uid and a positive sign stops', () => {
    const odd = order({
      payerInfo: party('Me', OWN),
      receiverInfo: party('x', OTHER),
      amount: '0.001',
    });

    expect(payDirection(odd, null)).toBeNull();
  });

  it('row 6: shape says out but the uid is the receiver stops', () => {
    const odd = order({
      payerInfo: party('x', OTHER),
      receiverInfo: party('Me', OWN),
      amount: '-0.001',
    });

    expect(payDirection(odd, OWN)).toBeNull();
  });

  it('row 7: no binanceId at all stops, even with a known uid', () => {
    expect(payDirection(order({ amount: '-0.001' }), OWN)).toBeNull();
  });

  const NO_PARTY = party(undefined, undefined);

  it.each([
    ['C2C_HOLDING send', 'C2C_HOLDING', party('Me', OWN), party('x', OTHER), '-0.001', 'out'],
    ['C2C_HOLDING_RF', 'C2C_HOLDING_RF', NO_PARTY, party('Me', OWN), '0.001', 'in'],
    ['PAY', 'PAY', party('Me', OWN), party('Shop', OTHER), '-0.001', 'out'],
    ['PAY_REFUND', 'PAY_REFUND', party('Shop', undefined), party('Me', OWN), '0.001', 'in'],
    ['CRYPTO_BOX', 'CRYPTO_BOX', party('Me', OWN), NO_PARTY, '-0.001', 'out'],
    ['CRYPTO_BOX_RF', 'CRYPTO_BOX_RF', NO_PARTY, party('Me', OWN), '0.001', 'in'],
    ['PAYOUT', 'PAYOUT', party('Biz', undefined), party('Me', OWN), '0.001', 'in'],
    ['REMITTANCE', 'REMITTANCE', party('Me', OWN), party('Far', undefined), '-0.001', 'out'],
  ])(
    'row 8/9: %s follows the shape',
    (_label, orderType, payerInfo, receiverInfo, amount, expected) => {
      const row = order({ orderType, payerInfo, receiverInfo, amount });

      expect(payDirection(row, OWN)).toBe(expected);
    },
  );

  it('row 10: an unknown orderType whose signals agree is read by shape', () => {
    const unknown = order({ orderType: 'SOMETHING_NEW', payerInfo: party('Me', OWN) });

    expect(payDirection(unknown, OWN)).toBe('out');
  });

  it.each([['0'], ['0.0'], [''], ['  '], ['abc'], ['NaN'], ['Infinity'], ['-Infinity']])(
    'row 11: the amount %p stops',
    (amount) => {
      expect(payDirection(order({ payerInfo: party('Me', OWN), amount }), OWN)).toBeNull();
    },
  );

  it('row 12: a blank or missing name falls back to Binance Pay', () => {
    const blank = order({ payerInfo: party('Me', OWN), receiverInfo: party('   ', OTHER) });
    const missing = order({ payerInfo: party('Me', OWN), receiverInfo: party(undefined, OTHER) });

    expect(payDescription(blank, 'out')).toBe('Binance Pay');
    expect(payDescription(missing, 'out')).toBe('Binance Pay');
  });

  it('row 12: a name is trimmed and otherwise stored as Binance gives it', () => {
    const named = order({ receiverInfo: party('  Ann  B. ', OTHER) });

    expect(payDescription(named, 'out')).toBe('Ann  B.');
  });

  it('row 13: a uid that matches neither party defers to shape and sign when they agree', () => {
    const sent = order({
      payerInfo: party('x', '7'),
      receiverInfo: party('y', '8'),
      amount: '-0.001',
    });

    expect(payDirection(sent, OWN)).toBe('out');
  });

  it('row 13: a uid that matches neither party still stops when shape and sign disagree', () => {
    const odd = order({
      payerInfo: party('x', '7'),
      receiverInfo: party('y', '8'),
      amount: '0.001',
    });

    expect(payDirection(odd, OWN)).toBeNull();
  });

  it('row 14: a uid equal to both parties stops', () => {
    const self = order({ payerInfo: party('Me', OWN), receiverInfo: party('Me', OWN) });

    expect(payDirection(self, OWN)).toBeNull();
  });

  it('reads the receiver as incoming only when no payer id is named', () => {
    const named = order({
      payerInfo: party('x', OTHER),
      receiverInfo: party('Me', OWN),
      amount: '-0.001',
    });

    expect(payDirection(named, null)).toBe('out');
  });
});

describe('payRowsOf: wallet placement', () => {
  const sent = (over: Partial<BinancePayOrder> = {}) =>
    order({ payerInfo: party('Me', OWN), receiverInfo: party('Ann', OTHER), ...over });

  const rowsOf = (over: Partial<BinancePayOrder> = {}) =>
    payRowsOf({ accountId: ACCOUNT_ID, order: sent(over), uid: OWN });

  it('P1: walletType 2 is Spot', () => {
    expect(rowsOf({ walletType: 2 })).toEqual([
      {
        wallet: 'BTC',
        amountMinorUnits: -100_000,
        time: NOW - DAY_MS,
        externalId: 'acc-1:pay:C2C:tx-1:2',
        description: 'Ann',
      },
    ]);
  });

  it('P2: walletType 1 is Funding, keyed by that wallet', () => {
    expect(rowsOf({ walletType: 1 })).toMatchObject([
      { wallet: 'BTC:funding', externalId: 'acc-1:pay:C2C:tx-1:1' },
    ]);
  });

  it('P3: walletType 5 is Earn', () => {
    expect(rowsOf({ walletType: 5 })).toMatchObject([
      { wallet: 'BTC:earn', externalId: 'acc-1:pay:C2C:tx-1:5' },
    ]);
  });

  const splitFunds = (walletAssetCost: { walletType: number; amount: string }[]) => [
    { currency: 'BTC', amount: '0.001', walletAssetCost },
  ];

  it('P4: two wallets whose costs sum to the amount give one row per wallet, each with its own key', () => {
    const rows = rowsOf({
      walletType: 2,
      walletTypes: [1, 2],
      fundsDetail: splitFunds([
        { walletType: 1, amount: '0.0006' },
        { walletType: 2, amount: '0.0004' },
      ]),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        wallet: 'BTC:funding',
        amountMinorUnits: -60_000,
        externalId: 'acc-1:pay:C2C:tx-1:1',
      }),
      expect.objectContaining({
        wallet: 'BTC',
        amountMinorUnits: -40_000,
        externalId: 'acc-1:pay:C2C:tx-1:2',
      }),
    ]);
  });

  it('P4: an incoming split keeps the positive sign on every row', () => {
    const rows = payRowsOf({
      accountId: ACCOUNT_ID,
      uid: OWN,
      order: order({
        payerInfo: party('Bob', undefined),
        receiverInfo: party('Me', OWN),
        amount: '0.001',
        walletTypes: [1, 2],
        fundsDetail: splitFunds([
          { walletType: 1, amount: '0.0006' },
          { walletType: 2, amount: '0.0004' },
        ]),
      }),
    });

    expect(rows.map((row) => row.amountMinorUnits)).toEqual([60_000, 40_000]);
  });

  it('P4: costs for one wallet spread over several funds entries are added up', () => {
    const rows = rowsOf({
      walletTypes: [1, 2],
      fundsDetail: [
        {
          currency: 'BTC',
          amount: '0.0006',
          walletAssetCost: [{ walletType: 1, amount: '0.0006' }],
        },
        {
          currency: 'BTC',
          amount: '0.0004',
          walletAssetCost: [{ walletType: 2, amount: '0.0004' }],
        },
      ],
    });

    expect(rows.map((row) => [row.wallet, row.amountMinorUnits])).toEqual([
      ['BTC:funding', -60_000],
      ['BTC', -40_000],
    ]);
  });

  it('P4: a zero cost on a wallet gives that wallet no row', () => {
    const rows = rowsOf({
      walletTypes: [1, 2],
      fundsDetail: splitFunds([
        { walletType: 1, amount: '0' },
        { walletType: 2, amount: '0.001' },
      ]),
    });

    expect(rows.map((row) => row.wallet)).toEqual(['BTC']);
  });

  it('P5: costs that do not sum to the amount stop', () => {
    const wrongSum = {
      walletTypes: [1, 2],
      fundsDetail: splitFunds([
        { walletType: 1, amount: '0.0006' },
        { walletType: 2, amount: '0.0003' },
      ]),
    };

    expect(stopCodeOf(() => rowsOf(wrongSum))).toBe('pay-split-mismatch');
  });

  it('P5: two wallets with no per-wallet cost at all stop', () => {
    expect(stopCodeOf(() => rowsOf({ walletTypes: [1, 2], fundsDetail: [] }))).toBe(
      'pay-split-mismatch',
    );
  });

  it('P5: a cost that is not a number stops', () => {
    const broken = {
      walletTypes: [1, 2],
      fundsDetail: splitFunds([
        { walletType: 1, amount: 'x' },
        { walletType: 2, amount: '0.001' },
      ]),
    };

    expect(stopCodeOf(() => rowsOf(broken))).toBe('pay-amount-invalid');
  });

  it('P5: a negative cost stops', () => {
    const broken = {
      walletTypes: [1, 2],
      fundsDetail: splitFunds([
        { walletType: 1, amount: '-0.0005' },
        { walletType: 2, amount: '0.0015' },
      ]),
    };

    expect(stopCodeOf(() => rowsOf(broken))).toBe('pay-amount-invalid');
  });

  it.each([[3], [4], [6], [0], [99]])('P6: walletType %p stops', (walletType) => {
    expect(stopCodeOf(() => rowsOf({ walletType }))).toBe('pay-wallet-unknown');
  });

  it('P6: a split that names an untracked wallet stops', () => {
    const toCard = {
      walletTypes: [2, 4],
      fundsDetail: splitFunds([
        { walletType: 2, amount: '0.0004' },
        { walletType: 4, amount: '0.0006' },
      ]),
    };

    expect(stopCodeOf(() => rowsOf(toCard))).toBe('pay-wallet-unknown');
  });

  it('stops when no wallet is named at all', () => {
    expect(stopCodeOf(() => rowsOf({ walletType: undefined, walletTypes: undefined }))).toBe(
      'pay-wallet-unknown',
    );
  });

  it('reads a single wallet from walletTypes when walletType is absent', () => {
    expect(rowsOf({ walletType: undefined, walletTypes: [1] })).toMatchObject([
      { wallet: 'BTC:funding' },
    ]);
  });

  it('stops when walletType and a single walletTypes entry disagree', () => {
    expect(stopCodeOf(() => rowsOf({ walletType: 2, walletTypes: [1] }))).toBe(
      'pay-wallet-unknown',
    );
  });

  it('a repeated wallet in walletTypes is one wallet', () => {
    expect(rowsOf({ walletType: 2, walletTypes: [2, 2] })).toMatchObject([{ wallet: 'BTC' }]);
  });

  it('stops when the funds named are not BTC, so no BTC movement is guessed', () => {
    const paidWithTether = {
      fundsDetail: [{ currency: 'USDT', amount: '1', walletAssetCost: [] }],
    };

    expect(stopCodeOf(() => rowsOf(paidWithTether))).toBe('pay-funds-not-btc');
  });

  it('takes a single-wallet order whose funds detail names BTC', () => {
    const single = { fundsDetail: splitFunds([{ walletType: 2, amount: '0.001' }]) };

    expect(rowsOf(single)).toHaveLength(1);
  });
});

describe('payRowsOf: stops and keys', () => {
  const sent = (over: Partial<BinancePayOrder> = {}) =>
    order({ payerInfo: party('Me', OWN), receiverInfo: party('Ann', OTHER), ...over });

  const stopOf = (over: Partial<BinancePayOrder>, uid: string | null = OWN) =>
    stopCodeOf(() => payRowsOf({ accountId: ACCOUNT_ID, order: sent(over), uid }));

  it('stops on an empty transactionId', () => {
    expect(stopOf({ transactionId: '' })).toBe('pay-id-missing');
  });

  it('stops on an ambiguous direction', () => {
    expect(stopOf({ amount: '0.001' })).toBe('pay-direction-ambiguous');
  });

  it('stops on an amount that rounds to zero satoshis', () => {
    expect(stopOf({ amount: '-0.000000001' })).toBe('pay-amount-invalid');
  });

  it('keys the row by account, order type, id and wallet', () => {
    const rows = payRowsOf({
      accountId: 'acc-7',
      order: sent({ orderType: 'PAY', transactionId: '555', walletType: 5 }),
      uid: OWN,
    });

    expect(rows[0].externalId).toBe('acc-7:pay:PAY:555:5');
  });

  it('puts the order time on the row and a satoshi amount from the absolute value', () => {
    const rows = payRowsOf({
      accountId: ACCOUNT_ID,
      order: sent({ amount: '-0.12345678', transactionTime: 1_700_000_000_123 }),
      uid: OWN,
    });

    expect(rows[0]).toMatchObject({ amountMinorUnits: -12_345_678, time: 1_700_000_000_123 });
  });
});
