import { DAY_MS } from '@kiko/dates';
import { BinanceWalkStop } from '@kiko/crypto-sync/exchange/walk';

import { payRowsOf } from './binance.pay-history';
import type { BinancePayOrder } from './binance.history-client';
import { NOW, OTHER, OWN, party, payOrder } from './binance.pay-test-fixtures';

const ACCOUNT_ID = 'acc-1';
const PAID_AT = NOW - DAY_MS;

type Funds = BinancePayOrder['fundsDetail'][number];

/** A funds entry of `currency` whose `amount` was paid whole from `walletType`. */
const paidFrom = (currency: string, amount: string, walletType: number): Funds => ({
  currency,
  amount,
  walletAssetCost: [{ walletType, amount }],
});

const sentOrder = (over: Partial<BinancePayOrder> = {}): BinancePayOrder =>
  payOrder({
    transactionTime: PAID_AT,
    payerInfo: party('Me', OWN),
    receiverInfo: party('Ann', OTHER),
    ...over,
  });

const receivedOrder = (over: Partial<BinancePayOrder> = {}): BinancePayOrder =>
  payOrder({
    transactionTime: PAID_AT,
    amount: '12.5',
    currency: 'USDT',
    fundsDetail: [],
    payerInfo: party('Bob', OTHER),
    receiverInfo: party('Me', OWN),
    ...over,
  });

const rowsOf = (order: BinancePayOrder) => payRowsOf({ accountId: ACCOUNT_ID, order, uid: OWN });

const stopOf = (order: BinancePayOrder): BinanceWalkStop | undefined => {
  try {
    rowsOf(order);
  } catch (error) {
    return error instanceof BinanceWalkStop ? error : undefined;
  }

  return undefined;
};

const usdtSend = (over: Partial<BinancePayOrder> = {}) =>
  sentOrder({
    currency: 'USDT',
    amount: '-12.5',
    walletType: 1,
    fundsDetail: [paidFrom('USDT', '12.5', 1)],
    ...over,
  });

describe('a Pay send in a tracked coin', () => {
  it('keeps the BTC row of a BTC order exactly as it was: its key, wallet and no note', () => {
    const rows = rowsOf(sentOrder({ walletType: 1, fundsDetail: [paidFrom('BTC', '0.001', 1)] }));

    expect(rows).toEqual([
      {
        wallet: 'BTC:funding',
        amountMinorUnits: -100_000,
        time: PAID_AT,
        externalId: 'acc-1:pay:C2C:tx-1:1',
        description: 'Ann',
      },
    ]);
  });

  it('places a USDT send on the USDT holding of its wallet, keyed with the currency', () => {
    expect(rowsOf(usdtSend())).toEqual([
      {
        wallet: 'USDT:funding',
        amountMinorUnits: -1_250_000_000,
        time: PAID_AT,
        externalId: 'acc-1:pay:C2C:tx-1:1:USDT',
        description: 'Ann',
      },
    ]);
  });

  it('places a send on Spot and Earn too, by the wallet that was charged', () => {
    const spot = usdtSend({ walletType: 2, fundsDetail: [paidFrom('USDT', '12.5', 2)] });
    const earn = usdtSend({ walletType: 5, fundsDetail: [paidFrom('USDT', '12.5', 5)] });

    expect(rowsOf(spot).map((row) => row.wallet)).toEqual(['USDT']);
    expect(rowsOf(earn).map((row) => row.wallet)).toEqual(['USDT:earn']);
  });

  it('converts each amount at the scale of its own coin', () => {
    const xrp = sentOrder({
      currency: 'XRP',
      amount: '-1.23456',
      walletType: 2,
      fundsDetail: [paidFrom('XRP', '1.23456', 2)],
    });

    expect(rowsOf(xrp)).toMatchObject([
      { wallet: 'XRP', amountMinorUnits: -12_346, externalId: 'acc-1:pay:C2C:tx-1:2:XRP' },
    ]);
  });

  it('imports no row for an amount that rounds to nothing at the scale of its coin, and no stop', () => {
    const dust = sentOrder({
      currency: 'XRP',
      amount: '-0.00001',
      walletType: 2,
      fundsDetail: [paidFrom('XRP', '0.00001', 2)],
    });

    expect(rowsOf(dust)).toEqual([]);
  });

  it('imports no row for a receive that rounds to nothing at the scale of its coin', () => {
    const dust = receivedOrder({ currency: 'XRP', amount: '0.00001' });

    expect(rowsOf(dust)).toEqual([]);
  });

  it('keeps the funds rows of another coin beside an own amount that rounds to nothing', () => {
    const dust = sentOrder({
      currency: 'XRP',
      amount: '-0.00001',
      walletType: 2,
      fundsDetail: [paidFrom('USDT', '12.5', 2)],
    });

    expect(rowsOf(dust).map((row) => [row.wallet, row.amountMinorUnits])).toEqual([
      ['USDT', -1_250_000_000],
    ]);
  });

  it.each(['-1e-5', '-5.'])('still stops an amount that is no plain decimal: %j', (amount) => {
    expect(stopOf(sentOrder({ currency: 'XRP', amount }))?.code).toBe('amount-malformed');
  });

  it('stops an amount too large for its coin, naming that coin as oversized', () => {
    const huge = usdtSend({ amount: '-90071992.54740992' });

    expect(stopOf(huge)).toMatchObject({ code: 'amount-too-large', oversizedTicker: 'USDT' });
  });

  it('stops a USDT send whose costs are not its amount, as a BTC one does', () => {
    const short = usdtSend({ fundsDetail: [paidFrom('USDT', '12', 1)] });

    expect(stopOf(short)?.code).toBe('pay-split-mismatch');
  });

  it('stops a USDT send with no funds at all, never placing it whole', () => {
    expect(stopOf(usdtSend({ walletTypes: [1], fundsDetail: [] }))?.code).toBe(
      'pay-split-mismatch',
    );
  });

  it('stops a negative cost of a coin other than BTC', () => {
    const negative = usdtSend({
      walletTypes: [1, 2],
      fundsDetail: [
        {
          currency: 'USDT',
          amount: '12.5',
          walletAssetCost: [
            { walletType: 1, amount: '-1' },
            { walletType: 2, amount: '13.5' },
          ],
        },
      ],
    });

    expect(stopOf(negative)?.code).toBe('pay-amount-invalid');
  });
});

describe('a Pay send paid in another coin', () => {
  it('imports a USDC order paid in USDT as a USDT row, with the order in its note', () => {
    const order = sentOrder({
      currency: 'USDC',
      amount: '-12.5',
      walletType: 2,
      fundsDetail: [paidFrom('USDT', '12.5', 2)],
    });

    expect(rowsOf(order)).toEqual([
      {
        wallet: 'USDT',
        amountMinorUnits: -1_250_000_000,
        time: PAID_AT,
        externalId: 'acc-1:pay:C2C:tx-1:2:USDT',
        description: 'Ann',
        comment: '12.5 USDC',
      },
    ]);
  });

  it('keeps the order amount as Binance wrote it, less its sign, in the note', () => {
    const order = sentOrder({
      currency: 'USDC',
      amount: '-12.50',
      walletType: 2,
      fundsDetail: [paidFrom('USDT', '12.5', 2)],
    });

    expect(rowsOf(order)[0].comment).toBe('12.50 USDC');
  });

  it('imports a USDT order paid in BTC as a BTC row keyed with the currency', () => {
    const order = sentOrder({
      currency: 'USDT',
      amount: '-5',
      walletType: 1,
      fundsDetail: [paidFrom('BTC', '0.0001', 1)],
    });

    expect(rowsOf(order)).toEqual([
      {
        wallet: 'BTC:funding',
        amountMinorUnits: -10_000,
        time: PAID_AT,
        externalId: 'acc-1:pay:C2C:tx-1:1:BTC',
        description: 'Ann',
        comment: '5 USDT',
      },
    ]);
  });

  it('gives an order paid in two coins one row per coin, each checked against its own funds', () => {
    const order = sentOrder({
      amount: '-0.001',
      walletType: 2,
      walletTypes: [2],
      fundsDetail: [paidFrom('BTC', '0.0004', 2), paidFrom('USDT', '40', 2)],
    });

    expect(rowsOf(order)).toEqual([
      expect.objectContaining({
        wallet: 'BTC',
        amountMinorUnits: -40_000,
        externalId: 'acc-1:pay:C2C:tx-1:2',
      }),
      expect.objectContaining({
        wallet: 'USDT',
        amountMinorUnits: -4_000_000_000,
        externalId: 'acc-1:pay:C2C:tx-1:2:USDT',
        comment: '0.001 BTC',
      }),
    ]);
  });

  it('keeps the BTC row of a BTC order unmarked beside the rows of another coin', () => {
    const order = sentOrder({
      walletTypes: [1, 2],
      fundsDetail: [paidFrom('BTC', '0.0004', 1), paidFrom('USDT', '40', 2)],
    });

    const rows = rowsOf(order);

    expect(rows.map((row) => row.externalId)).toEqual([
      'acc-1:pay:C2C:tx-1:1',
      'acc-1:pay:C2C:tx-1:2:USDT',
    ]);
    expect(rows[0]).not.toHaveProperty('comment');
  });

  it('splits one coin of a cross-coin order over the wallets that were charged', () => {
    const order = sentOrder({
      currency: 'USDC',
      amount: '-30',
      walletTypes: [1, 2],
      fundsDetail: [
        {
          currency: 'USDT',
          amount: '30',
          walletAssetCost: [
            { walletType: 1, amount: '10' },
            { walletType: 2, amount: '20' },
          ],
        },
      ],
    });

    expect(rowsOf(order).map((row) => [row.wallet, row.amountMinorUnits, row.externalId])).toEqual([
      ['USDT:funding', -1_000_000_000, 'acc-1:pay:C2C:tx-1:1:USDT'],
      ['USDT', -2_000_000_000, 'acc-1:pay:C2C:tx-1:2:USDT'],
    ]);
  });

  it('places the cost-less entries of one coin together on the one wallet named', () => {
    const order = sentOrder({
      currency: 'USDC',
      amount: '-40',
      walletType: 2,
      walletTypes: [2],
      fundsDetail: [
        { currency: 'USDT', amount: '10', walletAssetCost: [] },
        { currency: 'USDT', amount: '30', walletAssetCost: [] },
      ],
    });

    expect(rowsOf(order)).toMatchObject([{ wallet: 'USDT', amountMinorUnits: -4_000_000_000 }]);
  });

  it.each([
    ['no wallet named', { walletType: 2, walletTypes: undefined }],
    ['two wallets named', { walletType: 2, walletTypes: [1, 2] }],
  ])('stops a cost-less cross-coin send with %s', (_label, wallets) => {
    const order = sentOrder({
      currency: 'USDC',
      amount: '-40',
      fundsDetail: [{ currency: 'USDT', amount: '40', walletAssetCost: [] }],
      ...wallets,
    });

    expect(stopOf(order)?.code).toBe('pay-split-mismatch');
  });

  it('stops the whole order when the costs of one of its coins do not add up to its funds', () => {
    const order = sentOrder({
      walletTypes: [1, 2],
      fundsDetail: [
        paidFrom('BTC', '0.0004', 1),
        { currency: 'USDT', amount: '40', walletAssetCost: [{ walletType: 2, amount: '39' }] },
      ],
    });

    expect(stopOf(order)?.code).toBe('pay-split-mismatch');
  });

  it('stops when the costs of the one coin are over its funds', () => {
    const order = sentOrder({
      currency: 'USDC',
      amount: '-40',
      walletType: 2,
      fundsDetail: [
        { currency: 'USDT', amount: '40', walletAssetCost: [{ walletType: 2, amount: '41' }] },
      ],
    });

    expect(stopOf(order)?.code).toBe('pay-split-mismatch');
  });

  it('stops a USDT order paid in BTC and USDT when the USDT costs are not the USDT entry', () => {
    const order = usdtSend({
      amount: '-50',
      walletTypes: [1],
      fundsDetail: [
        paidFrom('BTC', '0.0001', 1),
        { currency: 'USDT', amount: '50', walletAssetCost: [{ walletType: 1, amount: '49' }] },
      ],
    });

    expect(stopOf(order)?.code).toBe('pay-split-mismatch');
  });

  it('imports no row for the funds in an untracked coin', () => {
    const order = usdtSend({ fundsDetail: [paidFrom('XYZ', '5', 1)] });

    expect(rowsOf(order)).toEqual([]);
  });

  it('gives no row for a funds entry that comes to nothing in its coin', () => {
    const order = sentOrder({
      walletType: 2,
      walletTypes: [2],
      fundsDetail: [
        paidFrom('BTC', '0.0004', 2),
        { currency: 'USDT', amount: '0', walletAssetCost: [] },
      ],
    });

    expect(rowsOf(order).map((row) => row.externalId)).toEqual(['acc-1:pay:C2C:tx-1:2']);
  });

  it('imports the tracked funds of an order and no row for the untracked ones beside them', () => {
    const order = sentOrder({
      walletType: 1,
      walletTypes: [1],
      fundsDetail: [paidFrom('BTC', '0.0004', 1), paidFrom('XYZ', '5', 1)],
    });

    expect(rowsOf(order).map((row) => row.externalId)).toEqual(['acc-1:pay:C2C:tx-1:1']);
  });

  it('keeps every key of an order distinct, whatever the coins and wallets', () => {
    const order = sentOrder({
      currency: 'USDC',
      amount: '-1',
      walletTypes: [1, 2],
      fundsDetail: [
        {
          currency: 'USDT',
          amount: '3',
          walletAssetCost: [
            { walletType: 1, amount: '1' },
            { walletType: 2, amount: '2' },
          ],
        },
        {
          currency: 'BTC',
          amount: '0.003',
          walletAssetCost: [
            { walletType: 1, amount: '0.001' },
            { walletType: 2, amount: '0.002' },
          ],
        },
      ],
    });

    const keys = rowsOf(order).map((row) => row.externalId);

    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
    expect(keys.filter((key) => key.endsWith(':BTC'))).toHaveLength(2);
  });
});

describe('a Pay send in a coin stored at a reduced scale', () => {
  const xrpSend = (
    costs: Funds['walletAssetCost'],
    total = '0.0003',
    over: Partial<BinancePayOrder> = {},
  ) =>
    sentOrder({
      currency: 'XRP',
      amount: `-${total}`,
      walletTypes: [1, 2, 5],
      fundsDetail: [{ currency: 'XRP', amount: total, walletAssetCost: costs }],
      ...over,
    });

  const unitsOf = (order: BinancePayOrder) =>
    rowsOf(order).map((row) => [row.externalId, row.amountMinorUnits]);

  it('places the shares of a split so they add up to the rounded total, not each rounded alone', () => {
    const order = xrpSend([
      { walletType: 1, amount: '0.00015' },
      { walletType: 2, amount: '0.00015' },
    ]);

    expect(unitsOf(order)).toEqual([
      ['acc-1:pay:C2C:tx-1:1:XRP', -2],
      ['acc-1:pay:C2C:tx-1:2:XRP', -1],
    ]);
  });

  it('balances a two-wallet split whose halves are each half a unit', () => {
    const order = xrpSend(
      [
        { walletType: 1, amount: '0.00005' },
        { walletType: 2, amount: '0.00005' },
      ],
      '0.0001',
    );

    expect(unitsOf(order)).toEqual([['acc-1:pay:C2C:tx-1:1:XRP', -1]]);
  });

  it('gives a share that rounds to nothing no row and still balances the others', () => {
    const order = xrpSend(
      [
        { walletType: 1, amount: '0.00004' },
        { walletType: 2, amount: '0.00004' },
        { walletType: 5, amount: '0.00002' },
      ],
      '0.0001',
    );

    expect(unitsOf(order)).toEqual([['acc-1:pay:C2C:tx-1:2:XRP', -1]]);
  });

  it('places the same shares whatever order Binance lists the wallets in', () => {
    const halves = [
      { walletType: 1, amount: '0.00015' },
      { walletType: 2, amount: '0.00015' },
    ];

    expect(unitsOf(xrpSend([...halves].reverse())).sort()).toEqual(unitsOf(xrpSend(halves)));
  });

  it('balances a split of XRP funds that paid an order in another coin', () => {
    const order = sentOrder({
      currency: 'USDT',
      amount: '-5',
      walletTypes: [1, 2],
      fundsDetail: [
        {
          currency: 'XRP',
          amount: '0.0001',
          walletAssetCost: [
            { walletType: 1, amount: '0.00005' },
            { walletType: 2, amount: '0.00005' },
          ],
        },
      ],
    });

    expect(unitsOf(order)).toEqual([['acc-1:pay:C2C:tx-1:1:XRP', -1]]);
  });

  it('adds the cost-less entries of one coin before rounding them', () => {
    const order = sentOrder({
      currency: 'USDT',
      amount: '-5',
      walletType: 2,
      walletTypes: [2],
      fundsDetail: [
        { currency: 'XRP', amount: '0.00005', walletAssetCost: [] },
        { currency: 'XRP', amount: '0.00005', walletAssetCost: [] },
      ],
    });

    expect(unitsOf(order)).toEqual([['acc-1:pay:C2C:tx-1:2:XRP', -1]]);
  });

  it('still stops a split whose costs are not the amount, however it rounds', () => {
    const order = xrpSend([
      { walletType: 1, amount: '0.00015' },
      { walletType: 2, amount: '0.00025' },
    ]);

    expect(stopOf(order)?.code).toBe('pay-split-mismatch');
  });

  it('stops a split with a cost on a wallet the order does not name', () => {
    const order = xrpSend(
      [
        { walletType: 1, amount: '0.00015' },
        { walletType: 2, amount: '0.00015' },
      ],
      '0.0003',
      { walletTypes: [1] },
    );

    expect(stopOf(order)?.code).toBe('pay-split-mismatch');
  });
});

describe('a Pay order in a coin the walk does not track', () => {
  it('imports the tracked funds rows of a send, never reading the order amount as a number of that coin', () => {
    const order = sentOrder({
      currency: 'XYZ',
      amount: '-0.123456789012',
      walletType: 1,
      fundsDetail: [paidFrom('USDT', '12.5', 1)],
    });

    expect(rowsOf(order)).toEqual([
      {
        wallet: 'USDT:funding',
        amountMinorUnits: -1_250_000_000,
        time: PAID_AT,
        externalId: 'acc-1:pay:C2C:tx-1:1:USDT',
        description: 'Ann',
        comment: '0.123456789012 XYZ',
      },
    ]);
  });

  it('imports no row for a receive', () => {
    const order = receivedOrder({
      currency: 'XYZ',
      fundsDetail: [paidFrom('USDT', '12.5', 2)],
    });

    expect(rowsOf(order)).toEqual([]);
  });

  it('still needs the direction of a send: a sign that disagrees with the uid stops', () => {
    const order = sentOrder({
      currency: 'XYZ',
      amount: '12.5',
      fundsDetail: [paidFrom('USDT', '12.5', 1)],
    });

    expect(stopOf(order)?.code).toBe('pay-direction-ambiguous');
  });
});

describe('a Pay receive in a tracked coin', () => {
  // Binance credits Pay receipts to Spot from this instant, and to Funding before it.
  const CUTOVER_MS = Date.UTC(2026, 8, 29);

  it('imports a USDT receive as a USDT row on Spot, keyed with the currency', () => {
    const order = receivedOrder({ transactionTime: CUTOVER_MS });

    expect(rowsOf(order)).toEqual([
      {
        wallet: 'USDT',
        amountMinorUnits: 1_250_000_000,
        time: CUTOVER_MS,
        externalId: 'acc-1:pay:C2C:tx-1:2:USDT',
        description: 'Bob',
      },
    ]);
  });

  it('places a USDT receive before the cutover on Funding', () => {
    const order = receivedOrder({ transactionTime: CUTOVER_MS - 1 });

    expect(rowsOf(order)).toMatchObject([
      { wallet: 'USDT:funding', externalId: 'acc-1:pay:C2C:tx-1:1:USDT' },
    ]);
  });

  it('imports one row in the order coin, whatever coin the payer paid in', () => {
    const order = receivedOrder({
      transactionTime: CUTOVER_MS,
      fundsDetail: [paidFrom('BTC', '0.001', 2)],
    });

    expect(rowsOf(order)).toMatchObject([{ wallet: 'USDT', amountMinorUnits: 1_250_000_000 }]);
  });

  it('keeps the key of a BTC receive as it was', () => {
    const order = receivedOrder({ currency: 'BTC', amount: '0.001', transactionTime: CUTOVER_MS });

    expect(rowsOf(order)).toMatchObject([
      { wallet: 'BTC', amountMinorUnits: 100_000, externalId: 'acc-1:pay:C2C:tx-1:2' },
    ]);
  });
});
