import { BinanceWalkStop } from '@kiko/crypto-sync/exchange/walk';
import { parseUntrackedCounterpart } from '@kiko/transactions/untracked-counterpart';
import { exchangeExcludedTransactionIds } from '@kiko/statistics/exchange-exclusion';

import type { BinanceP2pOrder } from './binance.history-client';
import { P2P_FORWARD_OWES, P2P_OPEN_STATUSES, p2pOutcomeOf } from './binance.p2p-history';
import { P2P_CREATED_AT, P2P_ORDER_NUMBER, p2pOrderOf } from './binance.p2p-test-fixtures';

const ACCOUNT = 'acc-1';
const WALLET_KEY = 'USDT:funding';

const outcomeOf = (over: Partial<BinanceP2pOrder> = {}) =>
  p2pOutcomeOf({ accountId: ACCOUNT, order: p2pOrderOf(over) });

const rowOf = (over: Partial<BinanceP2pOrder> = {}) => {
  const outcome = outcomeOf(over);

  if (outcome.kind !== 'row') {
    throw new Error(`expected a row, got ${outcome.kind}`);
  }

  return outcome.row;
};

const stopOf = (over: Partial<BinanceP2pOrder> = {}): BinanceWalkStop | undefined => {
  try {
    outcomeOf(over);
  } catch (error) {
    return error instanceof BinanceWalkStop ? error : undefined;
  }

  return undefined;
};

const refusedAs = (kind: string) => ({
  kind: 'refused',
  entry: `${kind}:${P2P_ORDER_NUMBER}:${P2P_CREATED_AT}`,
});

describe('p2pOutcomeOf', () => {
  it('imports a completed taker buy at its taker amount, with the total Binance sent as the marker', () => {
    expect(outcomeOf()).toEqual({
      kind: 'row',
      row: {
        wallet: WALLET_KEY,
        amountMinorUnits: 9_990_000_000,
        time: P2P_CREATED_AT,
        externalId: `${ACCOUNT}:p2p:${P2P_ORDER_NUMBER}:${WALLET_KEY}`,
        description: '',
        comment: '4150 UAH',
        untrackedCounterpart: 'p2p:UAH:4150.00',
        operation: 'p2p',
      },
    });
  });

  it('keys the row of two accounts apart for one order', () => {
    const other = p2pOutcomeOf({ accountId: 'acc-2', order: p2pOrderOf() });

    expect(other).toMatchObject({
      row: { externalId: `acc-2:p2p:${P2P_ORDER_NUMBER}:${WALLET_KEY}` },
    });
  });

  it('writes the row on the Funding holding of its coin and no counterpart holding', () => {
    expect(rowOf()).not.toHaveProperty('counterpartWallet');
    expect(rowOf()).not.toHaveProperty('exchangePairId');
  });

  it('writes a marker that reads back as the fiat and its total in minor units', () => {
    const { untrackedCounterpart } = rowOf();

    expect(parseUntrackedCounterpart(untrackedCounterpart)).toEqual({
      kind: 'p2p',
      fiat: 'UAH',
      totalMinorUnits: 415_000,
    });
  });

  it('carries only a marker, so the exchange exclusion rule treats it as any coded row', () => {
    const { untrackedCounterpart } = rowOf();

    expect(
      exchangeExcludedTransactionIds([
        { id: 'row', exchangeCounterpartHoldingId: null, untrackedCounterpart },
      ]),
    ).toEqual(new Set(['row']));
  });

  it('imports the whole amount when the taker commission is zero', () => {
    expect(rowOf({ takerCommission: '0', takerAmount: '100' }).amountMinorUnits).toBe(
      10_000_000_000,
    );
  });

  it('subtracts the commission from the amount in minor units when the taker amount is absent', () => {
    expect(rowOf({ takerAmount: undefined }).amountMinorUnits).toBe(9_990_000_000);
  });

  it('refuses an order whose taker amount differs from amount minus commission', () => {
    expect(outcomeOf({ takerAmount: '99.8' })).toEqual(refusedAs('p2p-amount'));
  });

  it('refuses an order with neither a taker amount nor a taker commission', () => {
    expect(outcomeOf({ takerAmount: undefined, takerCommission: undefined })).toEqual(
      refusedAs('p2p-amount'),
    );
  });

  it('keeps the total Binance sent, never amount times unit price', () => {
    const row = rowOf({ totalPrice: '4145.85' });

    expect(row.untrackedCounterpart).toBe('p2p:UAH:4145.85');
    expect(row.comment).toBe('4145.85 UAH');
  });

  it('lets the taker amount stand when the commission is absent', () => {
    expect(rowOf({ takerCommission: undefined }).amountMinorUnits).toBe(9_990_000_000);
  });

  it('lets the taker amount stand when the amount is absent', () => {
    expect(rowOf({ amount: undefined }).amountMinorUnits).toBe(9_990_000_000);
  });

  it('refuses an order with neither a taker amount nor an amount', () => {
    expect(outcomeOf({ takerAmount: undefined, amount: undefined })).toEqual(
      refusedAs('p2p-amount'),
    );
  });

  it.each([
    ['zero', { takerAmount: '0' }],
    ['a commission as large as the amount', { takerAmount: undefined, takerCommission: '100' }],
    ['a commission larger than the amount', { takerAmount: undefined, takerCommission: '101' }],
  ])('refuses an order whose amount comes to %s', (_name, over) => {
    expect(outcomeOf(over)).toEqual(refusedAs('p2p-amount'));
  });

  it('lists a completed sale and writes no row', () => {
    expect(outcomeOf({ tradeType: 'SELL' })).toEqual(refusedAs('p2p-sale'));
  });

  it('lists a completed buy placed as an advertiser', () => {
    expect(outcomeOf({ advertisementRole: 'MAKER' })).toEqual(refusedAs('p2p-advertiser'));
  });

  it.each([
    ['role missing', { advertisementRole: undefined }],
    ['role unknown', { advertisementRole: 'BROKER' }],
    ['role in another case', { advertisementRole: 'taker' }],
    ['side missing', { tradeType: undefined }],
    ['side unknown', { tradeType: 'SWAP' }],
    ['side in another case', { tradeType: 'buy' }],
  ])('lists an order whose %s as not recognized', (_name, over) => {
    expect(outcomeOf(over)).toEqual(refusedAs('p2p-unrecognized'));
  });

  it('lists a sale placed as an advertiser once, as a sale', () => {
    expect(outcomeOf({ tradeType: 'SELL', advertisementRole: 'MAKER' })).toEqual(
      refusedAs('p2p-sale'),
    );
  });

  it('lists a sale whose role is missing as a sale, not as an unrecognized order', () => {
    expect(outcomeOf({ tradeType: 'SELL', advertisementRole: undefined })).toEqual(
      refusedAs('p2p-sale'),
    );
  });

  it.each(['CANCELLED', 'CANCELLED_BY_SYSTEM'])(
    'writes and lists nothing for a %s order, even with a commission',
    (orderStatus) => {
      expect(outcomeOf({ orderStatus, takerCommission: '0.5' })).toEqual({ kind: 'none' });
      expect(outcomeOf({ orderStatus, tradeType: 'SELL' })).toEqual({ kind: 'none' });
      expect(outcomeOf({ orderStatus, advertisementRole: 'MAKER' })).toEqual({ kind: 'none' });
    },
  );

  it.each(['PENDING', 'TRADING', 'BUYER_PAYED', 'DISTRIBUTING', 'IN_APPEAL'])(
    'owes the point of a %s order whatever its side or role, and reads nothing else',
    (orderStatus) => {
      expect(outcomeOf({ orderStatus })).toEqual({ kind: 'owed' });
      expect(outcomeOf({ orderStatus, tradeType: 'SELL' })).toEqual({ kind: 'owed' });
      expect(outcomeOf({ orderStatus, advertisementRole: 'MAKER' })).toEqual({ kind: 'owed' });
      expect(
        outcomeOf({
          orderStatus,
          takerAmount: undefined,
          amount: undefined,
          asset: undefined,
          totalPrice: 'abc',
        }),
      ).toEqual({ kind: 'owed' });
    },
  );

  it('holds the open statuses as one list', () => {
    expect(P2P_OPEN_STATUSES).toEqual([
      'PENDING',
      'TRADING',
      'BUYER_PAYED',
      'DISTRIBUTING',
      'IN_APPEAL',
    ]);
  });

  it('lists an order status Kiko does not know as not recognized', () => {
    const unknown = ['REFUNDED', 'completed', 'COMPLETED ', 'Completed', '', undefined];

    expect(unknown.map((orderStatus) => outcomeOf({ orderStatus }))).toEqual(
      unknown.map(() => refusedAs('p2p-unrecognized')),
    );
  });

  it('puts a buy of a fiat asset on the Funding fiat holding', () => {
    const order = {
      asset: 'UAH',
      amount: '4000',
      takerCommission: '0',
      takerAmount: '4000',
      totalPrice: '4000',
    };

    expect(rowOf(order)).toMatchObject({
      wallet: 'UAH:funding',
      amountMinorUnits: 400_000,
      externalId: `${ACCOUNT}:p2p:${P2P_ORDER_NUMBER}:UAH:funding`,
      untrackedCounterpart: 'p2p:UAH:4000.00',
      comment: '4000 UAH',
    });
  });

  it('counts an asset Kiko does not track, names its ticker and writes no row', () => {
    expect(outcomeOf({ asset: 'XYZ' })).toEqual({ kind: 'untracked', ticker: 'XYZ' });
  });

  it('reads no amount of an asset Kiko does not track, whose scale it does not know', () => {
    expect(outcomeOf({ asset: 'XYZ', takerAmount: '1.0000000000001', totalPrice: 'abc' })).toEqual({
      kind: 'untracked',
      ticker: 'XYZ',
    });
  });

  it('refuses an order of an asset Kiko does not track whose amount fields are absent', () => {
    expect(outcomeOf({ asset: 'XYZ', takerAmount: undefined, amount: undefined })).toEqual(
      refusedAs('p2p-amount'),
    );
  });

  it.each([
    ['no asset', { asset: undefined }],
    ['a blank asset', { asset: '' }],
    ['no fiat', { fiat: undefined }],
    ['no total', { totalPrice: undefined }],
    ['a blank fiat', { fiat: '' }],
    ['a fiat that holds the separator', { fiat: 'U:AH' }],
  ])('lists a buy with %s as not recognized, since no row or marker can be made', (_name, over) => {
    expect(outcomeOf(over)).toEqual(refusedAs('p2p-unrecognized'));
  });

  it.each([
    ['a taker amount past the asset scale', { takerAmount: '99.900000001' }, 'amount-precision'],
    ['a malformed taker amount', { takerAmount: '9e1' }, 'amount-malformed'],
    ['a blank taker amount', { takerAmount: '' }, 'amount-malformed'],
    [
      'an amount past the asset scale beside a taker amount',
      { amount: '100.000000001' },
      'amount-precision',
    ],
    ['a commission past the asset scale', { takerCommission: '0.1000000001' }, 'amount-precision'],
    ['a total past the fiat scale', { totalPrice: '4150.001' }, 'amount-precision'],
    ['a malformed total', { totalPrice: 'abc' }, 'amount-malformed'],
    ['a total with a sign', { totalPrice: '-4150' }, 'amount-malformed'],
  ])('owes the point of an order with %s', (_name, over, code) => {
    expect(stopOf(over)?.code).toBe(code);
  });

  it('names the coin of an amount past the safe integer, so the walk lists it as oversized', () => {
    expect(stopOf({ takerAmount: '90071992.54740992' })).toMatchObject({
      code: 'amount-too-large',
      oversizedTicker: 'USDT',
    });
  });

  it('owes the stops it throws and the open order, and goes past them in the forward pass', () => {
    expect(P2P_FORWARD_OWES).toEqual([
      'p2p-not-settled',
      'p2p-order-unreadable',
      'amount-malformed',
      'amount-precision',
      'amount-too-large',
    ]);
  });
});
