import { DAY_MS } from '@kiko/dates';

import { BinanceWalkStop } from './binance.history-walk';
import type { BinancePayOrder } from './binance.history-client';
import { payDescription, payDirection, payRowsOf } from './binance.pay-history';
import { costOn, NOW, OTHER, OWN, party, payOrder } from './binance.pay-test-fixtures';

const ACCOUNT_ID = 'acc-1';

/** An order that names no party at all: each case adds the signals it is about. */
const order = (over: Partial<BinancePayOrder> = {}): BinancePayOrder =>
  payOrder({
    transactionTime: NOW - DAY_MS,
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

  it('row 4: a C2C receive as the live probe saw it (payer has a Binance id) is incoming', () => {
    const received = order({
      payerInfo: party('Bob', OTHER),
      receiverInfo: party('Me', OWN),
      amount: '0.001',
    });

    expect(payDirection(received, OWN)).toBe('in');
    expect(payDescription(received, 'in')).toBe('Bob');
  });

  it('row 5: an unknown uid stops, whatever the shape and the sign say', () => {
    const received = order({ receiverInfo: party('Me', OWN), amount: '0.001' });
    const sent = order({ payerInfo: party('Me', OWN), receiverInfo: party('x', OTHER) });

    expect(payDirection(received, null)).toBeNull();
    expect(payDirection(sent, null)).toBeNull();
  });

  it('row 6: the uid is the payer but the sign is positive stops', () => {
    const odd = order({
      payerInfo: party('Me', OWN),
      receiverInfo: party('x', OTHER),
      amount: '0.001',
    });

    expect(payDirection(odd, OWN)).toBeNull();
  });

  it('row 7: the uid is the receiver but the sign is negative stops', () => {
    const odd = order({
      payerInfo: party('x', OTHER),
      receiverInfo: party('Me', OWN),
      amount: '-0.001',
    });

    expect(payDirection(odd, OWN)).toBeNull();
  });

  it('row 8: no binanceId at all stops, even with a known uid', () => {
    expect(payDirection(order({ amount: '-0.001' }), OWN)).toBeNull();
  });

  it('row 9: a uid that matches neither named party stops, even when shape and sign agree', () => {
    const sent = order({
      payerInfo: party('x', '7'),
      receiverInfo: party('y', '8'),
      amount: '-0.001',
    });

    expect(payDirection(sent, OWN)).toBeNull();
  });

  it('row 10: a uid equal to both parties stops', () => {
    const self = order({ payerInfo: party('Me', OWN), receiverInfo: party('Me', OWN) });

    expect(payDirection(self, OWN)).toBeNull();
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
    'row 11: %s follows the uid',
    (_label, orderType, payerInfo, receiverInfo, amount, expected) => {
      const row = order({ orderType, payerInfo, receiverInfo, amount });

      expect(payDirection(row, OWN)).toBe(expected);
    },
  );

  it('row 12: an unknown orderType is read by the uid like any other', () => {
    const unknown = order({ orderType: 'SOMETHING_NEW', payerInfo: party('Me', OWN) });

    expect(payDirection(unknown, OWN)).toBe('out');
  });

  it.each([['0'], ['0.0'], [''], ['  '], ['abc'], ['NaN'], ['Infinity'], ['-Infinity']])(
    'row 13: the amount %p stops',
    (amount) => {
      expect(payDirection(order({ payerInfo: party('Me', OWN), amount }), OWN)).toBeNull();
    },
  );

  it('row 14: a blank or missing name falls back to Binance Pay', () => {
    const blank = order({ payerInfo: party('Me', OWN), receiverInfo: party('   ', OTHER) });
    const missing = order({ payerInfo: party('Me', OWN), receiverInfo: party(undefined, OTHER) });

    expect(payDescription(blank, 'out')).toBe('Binance Pay');
    expect(payDescription(missing, 'out')).toBe('Binance Pay');
  });

  it('row 14: a name is trimmed and otherwise stored as Binance gives it', () => {
    const named = order({ receiverInfo: party('  Ann  B. ', OTHER) });

    expect(payDescription(named, 'out')).toBe('Ann  B.');
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
    expect(rowsOf({ walletType: 1, fundsDetail: costOn(1) })).toMatchObject([
      { wallet: 'BTC:funding', externalId: 'acc-1:pay:C2C:tx-1:1' },
    ]);
  });

  it('P2: the live probe shape (walletType 1, walletTypes [1]) is Funding and stops nowhere', () => {
    const rows = rowsOf({ walletType: 1, walletTypes: [1], fundsDetail: costOn(1) });

    expect(rows).toMatchObject([{ wallet: 'BTC:funding', externalId: 'acc-1:pay:C2C:tx-1:1' }]);
  });

  it('P4: the live probe split (walletType 1, walletTypes [1, 2]) is placed by the costs, not by walletType', () => {
    const rows = rowsOf({
      walletType: 1,
      walletTypes: [1, 2],
      fundsDetail: [
        {
          currency: 'BTC',
          amount: '0.001',
          walletAssetCost: [
            { walletType: 1, amount: '0.0006' },
            { walletType: 2, amount: '0.0004' },
          ],
        },
      ],
    });

    expect(rows.map((row) => [row.wallet, row.amountMinorUnits])).toEqual([
      ['BTC:funding', -60_000],
      ['BTC', -40_000],
    ]);
  });

  it('P3: walletType 5 is Earn', () => {
    expect(rowsOf({ walletType: 5, fundsDetail: costOn(5) })).toMatchObject([
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

  describe('a receive', () => {
    const received = (over: Partial<BinancePayOrder> = {}) =>
      payRowsOf({
        accountId: ACCOUNT_ID,
        uid: OWN,
        order: order({
          payerInfo: party('Bob', undefined),
          receiverInfo: party('Me', OWN),
          amount: '0.001',
          fundsDetail: [],
          ...over,
        }),
      });

    // Binance announced that Pay receipts are credited to Spot from this instant.
    const CUTOVER_MS = Date.UTC(2026, 8, 29);

    it('one millisecond before the cutover is Funding, signed positive', () => {
      expect(received({ transactionTime: CUTOVER_MS - 1 })).toEqual([
        expect.objectContaining({
          wallet: 'BTC:funding',
          amountMinorUnits: 100_000,
          externalId: 'acc-1:pay:C2C:tx-1:1',
        }),
      ]);
    });

    it('at the cutover is Spot', () => {
      expect(received({ transactionTime: CUTOVER_MS })).toEqual([
        expect.objectContaining({
          wallet: 'BTC',
          amountMinorUnits: 100_000,
          externalId: 'acc-1:pay:C2C:tx-1:2',
        }),
      ]);
    });

    it('is placed by date when walletTypes lists two wallets, with no stop', () => {
      const split = { walletTypes: [1, 2], walletType: 1 };

      expect(received({ ...split, transactionTime: CUTOVER_MS - 1 })).toMatchObject([
        { wallet: 'BTC:funding' },
      ]);
      expect(received({ ...split, transactionTime: CUTOVER_MS })).toMatchObject([
        { wallet: 'BTC' },
      ]);
    });

    it('is Funding before the cutover though walletTypes names only Spot', () => {
      const early = received({ walletType: 2, walletTypes: [2], transactionTime: CUTOVER_MS - 1 });

      expect(early).toMatchObject([{ wallet: 'BTC:funding' }]);
    });

    it('is Spot at the cutover though walletTypes names only Funding', () => {
      const late = received({ walletType: 1, walletTypes: [1], transactionTime: CUTOVER_MS });

      expect(late).toMatchObject([{ wallet: 'BTC' }]);
    });

    it('is imported when its funds name no BTC: they are the coin the payer paid in', () => {
      const paidInTether = {
        fundsDetail: [{ currency: 'USDT', amount: '1', walletAssetCost: [] }],
      };

      expect(received(paidInTether)).toEqual([
        expect.objectContaining({ wallet: 'BTC', amountMinorUnits: 100_000 }),
      ]);
    });

    it('is placed by date whatever the payer cost says', () => {
      const payerPaidFromSpot = { transactionTime: CUTOVER_MS - 1, fundsDetail: costOn(2) };

      expect(received(payerPaidFromSpot)).toMatchObject([{ wallet: 'BTC:funding' }]);
    });

    it.each([
      ['no wallet named', { walletType: undefined, walletTypes: undefined }],
      ['an untracked wallet named', { walletType: 4, walletTypes: undefined }],
      ['a repeated wallet', { walletTypes: [1, 1] }],
    ])('is placed by date with %s, and never stops', (_label, wallets) => {
      expect(received({ ...wallets, transactionTime: CUTOVER_MS })).toMatchObject([
        { wallet: 'BTC' },
      ]);
    });
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

  it('P4a: a zero cost on one named wallet leaves the whole amount on the wallet that was costed', () => {
    const zeroOnOne = {
      walletTypes: [1, 2],
      fundsDetail: splitFunds([
        { walletType: 1, amount: '0' },
        { walletType: 2, amount: '0.001' },
      ]),
    };

    expect(rowsOf(zeroOnOne)).toMatchObject([
      { wallet: 'BTC', amountMinorUnits: -100_000, externalId: 'acc-1:pay:C2C:tx-1:2' },
    ]);
  });

  it('P4a: a cost on only one of the two named wallets places the whole amount there', () => {
    const onlyFunding = {
      walletTypes: [1, 2],
      fundsDetail: splitFunds([{ walletType: 1, amount: '0.001' }]),
    };

    expect(rowsOf(onlyFunding)).toMatchObject([
      { wallet: 'BTC:funding', amountMinorUnits: -100_000, externalId: 'acc-1:pay:C2C:tx-1:1' },
    ]);
  });

  it('P5: a positive cost on a wallet that walletTypes does not name stops, even when the costs sum to the amount', () => {
    const otherWallet = {
      walletTypes: [1, 2],
      fundsDetail: splitFunds([
        { walletType: 1, amount: '0.0006' },
        { walletType: 5, amount: '0.0004' },
      ]),
    };

    expect(stopCodeOf(() => rowsOf(otherWallet))).toBe('pay-split-mismatch');
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

  it('P5: costs over the amount stop', () => {
    const tooMuch = {
      walletTypes: [1, 2],
      fundsDetail: splitFunds([
        { walletType: 1, amount: '0.0006' },
        { walletType: 2, amount: '0.0005' },
      ]),
    };

    expect(stopCodeOf(() => rowsOf(tooMuch))).toBe('pay-split-mismatch');
  });

  it('P5: two wallets with no per-wallet cost at all stop', () => {
    expect(stopCodeOf(() => rowsOf({ walletTypes: [1, 2], fundsDetail: [] }))).toBe(
      'pay-split-mismatch',
    );
  });

  it('P5: two wallets whose costs are all zero stop', () => {
    const allZero = {
      walletTypes: [1, 2],
      fundsDetail: splitFunds([
        { walletType: 1, amount: '0' },
        { walletType: 2, amount: '0' },
      ]),
    };

    expect(stopCodeOf(() => rowsOf(allZero))).toBe('pay-split-mismatch');
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
    expect(stopCodeOf(() => rowsOf({ walletType, fundsDetail: costOn(walletType) }))).toBe(
      'pay-wallet-unknown',
    );
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
    const rows = rowsOf({ walletType: undefined, walletTypes: [1], fundsDetail: costOn(1) });

    expect(rows).toMatchObject([{ wallet: 'BTC:funding' }]);
  });

  describe('a single wallet', () => {
    it('is the one walletTypes entry, whatever walletType says', () => {
      const rows = rowsOf({ walletType: 1, walletTypes: [2], fundsDetail: costOn(2) });

      expect(rows).toMatchObject([{ wallet: 'BTC', externalId: 'acc-1:pay:C2C:tx-1:2' }]);
    });

    it('places a send with no cost at all on the one wallet walletTypes names', () => {
      const rows = rowsOf({ walletType: 1, walletTypes: [2], fundsDetail: [] });

      expect(rows).toEqual([
        expect.objectContaining({
          wallet: 'BTC',
          amountMinorUnits: -100_000,
          externalId: 'acc-1:pay:C2C:tx-1:2',
        }),
      ]);
    });

    it('places a send whose BTC funds carry no wallet cost list on the one wallet named', () => {
      const noCostList = splitFunds([]);

      expect(rowsOf({ walletType: 1, walletTypes: [1], fundsDetail: noCostList })).toMatchObject([
        { wallet: 'BTC:funding', amountMinorUnits: -100_000 },
      ]);
    });

    it('places a send whose cost-less BTC funds entry equals the amount, besides an entry of no cost', () => {
      const equal = [{ currency: 'BTC', amount: '0.001', walletAssetCost: [] }];

      expect(rowsOf({ walletType: 2, walletTypes: [2], fundsDetail: equal })).toMatchObject([
        { wallet: 'BTC', amountMinorUnits: -100_000, externalId: 'acc-1:pay:C2C:tx-1:2' },
      ]);
    });

    it('stops a send whose cost-less BTC funds entry is below the amount, the rest paid in another coin', () => {
      const partFunded = [
        { currency: 'BTC', amount: '0.0004', walletAssetCost: [] },
        { currency: 'USDT', amount: '40', walletAssetCost: [] },
      ];

      expect(
        stopCodeOf(() => rowsOf({ walletType: 2, walletTypes: [2], fundsDetail: partFunded })),
      ).toBe('pay-split-mismatch');
    });

    it('stops a send whose cost-less BTC funds entry is below the amount, with no other coin listed', () => {
      const below = [{ currency: 'BTC', amount: '0.0004', walletAssetCost: [] }];

      expect(
        stopCodeOf(() => rowsOf({ walletType: 2, walletTypes: [2], fundsDetail: below })),
      ).toBe('pay-split-mismatch');
    });

    it('takes the cost-less BTC funds entries together before it compares them with the amount', () => {
      const twoEntries = [
        { currency: 'BTC', amount: '0.0004', walletAssetCost: [] },
        { currency: 'BTC', amount: '0.0006', walletAssetCost: [] },
      ];

      expect(rowsOf({ walletType: 2, walletTypes: [2], fundsDetail: twoEntries })).toMatchObject([
        { wallet: 'BTC', amountMinorUnits: -100_000 },
      ]);
    });

    it('stops a send whose cost-less BTC funds entry is not a number', () => {
      const unreadable = [{ currency: 'BTC', amount: 'lots', walletAssetCost: [] }];

      expect(
        stopCodeOf(() => rowsOf({ walletType: 2, walletTypes: [2], fundsDetail: unreadable })),
      ).toBe('pay-amount-invalid');
    });

    it('stops a send with no BTC funds entry at all and funds in another coin', () => {
      const otherCoin = [{ currency: 'USDT', amount: '100', walletAssetCost: [] }];

      expect(
        stopCodeOf(() => rowsOf({ walletType: 2, walletTypes: [2], fundsDetail: otherCoin })),
      ).toBe('pay-funds-not-btc');
    });

    it('stops a send with no cost when walletTypes is absent, whatever walletType says', () => {
      expect(
        stopCodeOf(() => rowsOf({ walletType: 2, walletTypes: undefined, fundsDetail: [] })),
      ).toBe('pay-split-mismatch');
    });

    it('stops a send with no cost when walletTypes is empty', () => {
      expect(stopCodeOf(() => rowsOf({ walletType: 2, walletTypes: [], fundsDetail: [] }))).toBe(
        'pay-split-mismatch',
      );
    });

    it('stops a send with no cost when walletTypes names two wallets', () => {
      expect(stopCodeOf(() => rowsOf({ walletTypes: [1, 2], fundsDetail: [] }))).toBe(
        'pay-split-mismatch',
      );
    });

    it('stops a send with no cost on one wallet that is untracked', () => {
      expect(stopCodeOf(() => rowsOf({ walletTypes: [4], fundsDetail: [] }))).toBe(
        'pay-wallet-unknown',
      );
    });

    it('stops when the cost is below the amount', () => {
      const below = splitFunds([{ walletType: 2, amount: '0.0009' }]);

      expect(
        stopCodeOf(() => rowsOf({ walletType: 2, walletTypes: [2], fundsDetail: below })),
      ).toBe('pay-split-mismatch');
    });

    it('stops when the cost is above the amount', () => {
      const above = splitFunds([{ walletType: 2, amount: '0.0011' }]);

      expect(
        stopCodeOf(() => rowsOf({ walletType: 2, walletTypes: [2], fundsDetail: above })),
      ).toBe('pay-split-mismatch');
    });

    it('takes the costs of several funds entries together', () => {
      const twoEntries = [
        {
          currency: 'BTC',
          amount: '0.0004',
          walletAssetCost: [{ walletType: 2, amount: '0.0004' }],
        },
        {
          currency: 'BTC',
          amount: '0.0006',
          walletAssetCost: [{ walletType: 2, amount: '0.0006' }],
        },
      ];

      expect(rowsOf({ walletType: 2, walletTypes: [2], fundsDetail: twoEntries })).toMatchObject([
        { wallet: 'BTC', amountMinorUnits: -100_000 },
      ]);
    });

    it('is walletType when walletTypes is absent, checked against the cost', () => {
      const funding = rowsOf({ walletType: 1, walletTypes: undefined, fundsDetail: costOn(1) });

      expect(funding).toMatchObject([{ wallet: 'BTC:funding' }]);
      expect(
        stopCodeOf(() => rowsOf({ walletType: 1, walletTypes: undefined, fundsDetail: costOn(2) })),
      ).toBe('pay-split-mismatch');
    });

    it('is Funding for the live probe shape: walletType 1 beside [1], with its cost', () => {
      expect(rowsOf({ walletType: 1, walletTypes: [1], fundsDetail: costOn(1) })).toMatchObject([
        { wallet: 'BTC:funding' },
      ]);
    });

    it('stops when the cost is on a wallet that walletTypes does not name', () => {
      expect(
        stopCodeOf(() => rowsOf({ walletType: 1, walletTypes: [1], fundsDetail: costOn(2) })),
      ).toBe('pay-split-mismatch');
    });

    it('stops when the cost is on the named wallet and another one', () => {
      const onBoth = splitFunds([
        { walletType: 1, amount: '0.001' },
        { walletType: 2, amount: '0.001' },
      ]);

      expect(
        stopCodeOf(() => rowsOf({ walletType: 1, walletTypes: [1], fundsDetail: onBoth })),
      ).toBe('pay-split-mismatch');
    });

    it('stops when a split of the exact amount puts part of it on a wallet that is not named', () => {
      const partOnSpot = splitFunds([
        { walletType: 1, amount: '0.0006' },
        { walletType: 2, amount: '0.0004' },
      ]);

      expect(
        stopCodeOf(() => rowsOf({ walletType: 1, walletTypes: [1], fundsDetail: partOnSpot })),
      ).toBe('pay-split-mismatch');
    });

    it('stops when the cost the order carries is zero on the named wallet', () => {
      const zero = splitFunds([{ walletType: 1, amount: '0' }]);

      expect(stopCodeOf(() => rowsOf({ walletType: 1, walletTypes: [1], fundsDetail: zero }))).toBe(
        'pay-split-mismatch',
      );
    });
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
      order: sent({
        orderType: 'PAY',
        transactionId: '555',
        walletType: 5,
        fundsDetail: costOn(5),
      }),
      uid: OWN,
    });

    expect(rows[0].externalId).toBe('acc-7:pay:PAY:555:5');
  });

  it('puts the order time on the row and a satoshi amount from the absolute value', () => {
    const rows = payRowsOf({
      accountId: ACCOUNT_ID,
      order: sent({
        amount: '-0.12345678',
        fundsDetail: costOn(2, '0.12345678'),
        transactionTime: 1_700_000_000_123,
      }),
      uid: OWN,
    });

    expect(rows[0]).toMatchObject({ amountMinorUnits: -12_345_678, time: 1_700_000_000_123 });
  });
});
