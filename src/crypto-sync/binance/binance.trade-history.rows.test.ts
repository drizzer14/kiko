import type { HoldingRow } from '@kiko/db';
import { BinanceWalkStop, placeWalletRows } from '@kiko/crypto-sync/exchange/walk';
import { exchangeExcludedTransactionIds } from '@kiko/statistics/exchange-exclusion';

import { tradeOrderRowsOf } from './binance.trade-history';
import { BINANCE_WALK_CONFIG } from './binance.walk-config';
import { type BinanceMyTrade, BinanceHistoryParseError } from './binance.history-client';

const ACCOUNT = 'acc-1';
const PAIR = `${ACCOUNT}:trade:BTCUSDT:42`;
const FIRST_FILL_AT = 1_700_000_000_000;

const fillOf = (over: Partial<BinanceMyTrade> = {}): BinanceMyTrade => ({
  id: 1,
  orderId: 42,
  qty: '0.01',
  quoteQty: '600',
  commission: '0.00001',
  commissionAsset: 'BTC',
  isBuyer: true,
  time: FIRST_FILL_AT,
  ...over,
});

const ordersOf = (
  fills: BinanceMyTrade[],
  over: Partial<Parameters<typeof tradeOrderRowsOf>[0]> = {},
) =>
  tradeOrderRowsOf({
    accountId: ACCOUNT,
    symbol: 'BTCUSDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    orderId: 42,
    fills,
    ...over,
  });

const holdingWith = (id: string, key: string): HoldingRow =>
  ({ id, metadata: { binanceAsset: key } }) as unknown as HoldingRow;

// The rows are placed on holdings as the walk places them, so the markers the statistics read
// are the ones that would be stored.
const excludedIdsOf = async (planned: ReturnType<typeof ordersOf>['rows']) => {
  const keys = new Set(planned.flatMap((row) => [row.wallet, row.counterpartWallet ?? row.wallet]));
  const placed = await placeWalletRows({
    accountId: ACCOUNT,
    planned,
    config: BINANCE_WALK_CONFIG,
    listHoldings: async () => [...keys].map((key) => holdingWith(`holding-${key}`, key)),
    ensureHoldings: async () => undefined,
    missingCode: 'holding-missing',
  });

  return exchangeExcludedTransactionIds(
    placed.map((row) => ({
      id: row.externalId,
      exchangeCounterpartHoldingId: row.exchangeCounterpartHoldingId ?? null,
      untrackedCounterpart: row.untrackedCounterpart ?? null,
    })),
  );
};

const idsOf = (rows: { externalId: string }[]) => new Set(rows.map((row) => row.externalId));

const stopOf = (read: () => unknown): unknown => {
  try {
    read();
  } catch (error) {
    return error;
  }

  return undefined;
};

const legOf = (
  wallet: string,
  amountMinorUnits: number,
  over: Record<string, unknown> = {},
  pairId = PAIR,
) => ({
  wallet,
  amountMinorUnits,
  time: FIRST_FILL_AT,
  externalId: `${pairId}:${wallet}`,
  description: '',
  operation: 'trade',
  ...over,
});

const pairLegsOf = (spent: [string, number], received: [string, number], pairId = PAIR) => [
  legOf(spent[0], spent[1], { counterpartWallet: received[0], exchangePairId: pairId }, pairId),
  legOf(received[0], received[1], { counterpartWallet: spent[0], exchangePairId: pairId }, pairId),
];

const feeRowOf = (
  wallet: string,
  amountMinorUnits: number,
  over: Record<string, unknown>,
  pairId = PAIR,
) => ({
  wallet,
  amountMinorUnits,
  time: FIRST_FILL_AT,
  externalId: `${pairId}:fee:${wallet}`,
  exchangePairId: pairId,
  description: '',
  operation: 'trade-fee',
  ...over,
});

const ROUNDED_TAG = 'row-precision-rounded';

describe('tradeOrderRowsOf', () => {
  let warn: jest.SpyInstance;

  const roundedLogs = () => warn.mock.calls.filter(([tag]) => tag === ROUNDED_TAG);

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('a buy', () => {
    it('writes the spent coin out and the received coin in net of a commission in it', async () => {
      const { rows, untracked } = ordersOf([fillOf()]);

      expect(rows).toStrictEqual(pairLegsOf(['USDT', -60_000_000_000], ['BTC', 999_000]));
      expect(untracked).toStrictEqual([]);
      expect(await excludedIdsOf(rows)).toEqual(idsOf(rows));
    });

    it('sums the fills of one order into one pair, timed at the first fill', async () => {
      const { rows } = ordersOf([
        fillOf({ id: 1, qty: '0.004', quoteQty: '240', commission: '0.000004' }),
        fillOf({
          id: 2,
          qty: '0.003',
          quoteQty: '180',
          commission: '0.000003',
          time: FIRST_FILL_AT + 5,
        }),
        fillOf({
          id: 3,
          qty: '0.003',
          quoteQty: '180',
          commission: '0.000003',
          time: FIRST_FILL_AT + 9,
        }),
      ]);

      expect(rows).toStrictEqual(pairLegsOf(['USDT', -60_000_000_000], ['BTC', 999_000]));
      expect(await excludedIdsOf(rows)).toEqual(idsOf(rows));
    });

    it('times the order at its lowest-id fill whatever order the fills come in', () => {
      const { rows } = ordersOf([
        fillOf({ id: 8, time: FIRST_FILL_AT + 50 }),
        fillOf({ id: 5, time: FIRST_FILL_AT }),
        fillOf({ id: 9, time: FIRST_FILL_AT + 90 }),
      ]);

      expect(rows.map((row) => row.time)).toStrictEqual([FIRST_FILL_AT, FIRST_FILL_AT]);
    });

    it('writes a commission in a tracked third coin as one fee row in the same pair', async () => {
      const { rows, untracked } = ordersOf([
        fillOf({ commission: '0.0005', commissionAsset: 'BNB' }),
      ]);

      expect(rows).toStrictEqual([
        ...pairLegsOf(['USDT', -60_000_000_000], ['BTC', 1_000_000]),
        feeRowOf('BNB', -5_000, { counterpartWallet: 'BTC' }),
      ]);
      expect(untracked).toStrictEqual([]);
      expect(await excludedIdsOf(rows)).toEqual(idsOf(rows));
    });

    it('lists a commission coin Kiko does not track and writes no fee row for it', async () => {
      const { rows, untracked } = ordersOf([
        fillOf({ commission: '0.5', commissionAsset: 'SHIB' }),
      ]);

      expect(rows).toStrictEqual(pairLegsOf(['USDT', -60_000_000_000], ['BTC', 1_000_000]));
      expect(untracked).toStrictEqual(['SHIB']);
      expect(await excludedIdsOf(rows)).toEqual(idsOf(rows));
    });

    it('adds a commission in the spent coin to the spent leg and writes no fee row', async () => {
      const { rows } = ordersOf([fillOf({ commission: '0.6', commissionAsset: 'USDT' })]);

      expect(rows).toStrictEqual(pairLegsOf(['USDT', -60_060_000_000], ['BTC', 1_000_000]));
      expect(await excludedIdsOf(rows)).toEqual(idsOf(rows));
    });

    it('writes the fiat quote of a pair as the spent leg on its own holding', async () => {
      const { rows } = ordersOf(
        [fillOf({ quoteQty: '600', commission: '0.6', commissionAsset: 'EUR' })],
        { symbol: 'BTCEUR', quoteAsset: 'EUR' },
      );

      expect(rows).toStrictEqual(
        pairLegsOf(['EUR', -60_060], ['BTC', 1_000_000], `${ACCOUNT}:trade:BTCEUR:42`),
      );
      expect(await excludedIdsOf(rows)).toEqual(idsOf(rows));
    });

    it('takes a commission in the received coin off the received leg and sums the third coin', () => {
      const { rows } = ordersOf([
        fillOf({
          id: 1,
          qty: '0.004',
          quoteQty: '240',
          commission: '0.0002',
          commissionAsset: 'BNB',
        }),
        fillOf({
          id: 2,
          qty: '0.003',
          quoteQty: '180',
          commission: '0.0003',
          commissionAsset: 'BNB',
        }),
        fillOf({
          id: 3,
          qty: '0.003',
          quoteQty: '180',
          commission: '0.000003',
          commissionAsset: 'BTC',
        }),
      ]);

      expect(rows).toStrictEqual([
        ...pairLegsOf(['USDT', -60_000_000_000], ['BTC', 999_700]),
        feeRowOf('BNB', -5_000, { counterpartWallet: 'BTC' }),
      ]);
    });

    it('writes one fee row per tracked third coin, ascending by ticker', () => {
      const { rows } = ordersOf([
        fillOf({ id: 1, qty: '0.005', quoteQty: '300', commission: '0.1', commissionAsset: 'ETH' }),
        fillOf({
          id: 2,
          qty: '0.005',
          quoteQty: '300',
          commission: '0.0005',
          commissionAsset: 'BNB',
        }),
      ]);

      expect(rows.map((row) => [row.wallet, row.amountMinorUnits])).toStrictEqual([
        ['USDT', -60_000_000_000],
        ['BTC', 1_000_000],
        ['BNB', -5_000],
        ['ETH', -10_000_000],
      ]);
    });

    it('lists no coin and writes no fee row for a third-coin commission that sums to zero', () => {
      const { rows, untracked } = ordersOf([
        fillOf({ commission: '0.00000000', commissionAsset: 'SHIB' }),
        fillOf({ id: 2, commission: '0', commissionAsset: 'BNB' }),
      ]);

      expect(rows).toHaveLength(2);
      expect(untracked).toStrictEqual([]);
    });
  });

  describe('a sell', () => {
    it('writes the base coin out and the quote coin in net of a commission in it', async () => {
      const { rows } = ordersOf([
        fillOf({ isBuyer: false, commission: '0.6', commissionAsset: 'USDT' }),
      ]);

      expect(rows).toStrictEqual(pairLegsOf(['BTC', -1_000_000], ['USDT', 59_940_000_000]));
      expect(await excludedIdsOf(rows)).toEqual(idsOf(rows));
    });
  });

  describe('a coin Kiko does not track', () => {
    const PEPE_PAIR = `${ACCOUNT}:trade:PEPEUSDT:42`;
    const pepeOrderOf = (fills: BinanceMyTrade[]) =>
      ordersOf(fills, { symbol: 'PEPEUSDT', baseAsset: 'PEPE' });

    it('writes the tracked spent leg alone, marked with the other coin, and no pair', async () => {
      const { rows, untracked } = pepeOrderOf([
        fillOf({ qty: '1000000', quoteQty: '10', commission: '1000', commissionAsset: 'PEPE' }),
      ]);

      expect(rows).toStrictEqual([
        legOf('USDT', -1_000_000_000, { untrackedCounterpart: 'asset:PEPE' }, PEPE_PAIR),
      ]);
      expect(untracked).toStrictEqual(['PEPE']);
      expect(await excludedIdsOf(rows)).toEqual(idsOf(rows));
    });

    it('writes the tracked received leg alone when the untracked coin was sold', async () => {
      const { rows, untracked } = pepeOrderOf([
        fillOf({
          isBuyer: false,
          qty: '1000000',
          quoteQty: '10',
          commission: '0.01',
          commissionAsset: 'USDT',
        }),
      ]);

      expect(rows).toStrictEqual([
        legOf('USDT', 999_000_000, { untrackedCounterpart: 'asset:PEPE' }, PEPE_PAIR),
      ]);
      expect(untracked).toStrictEqual(['PEPE']);
      expect(await excludedIdsOf(rows)).toEqual(idsOf(rows));
    });

    it('marks a fee row with the untracked received coin and the pair id, the leg with no pair', async () => {
      const { rows } = pepeOrderOf([
        fillOf({ qty: '1000000', quoteQty: '10', commission: '0.0005', commissionAsset: 'BNB' }),
      ]);

      expect(rows).toStrictEqual([
        legOf('USDT', -1_000_000_000, { untrackedCounterpart: 'asset:PEPE' }, PEPE_PAIR),
        feeRowOf('BNB', -5_000, { untrackedCounterpart: 'asset:PEPE' }, PEPE_PAIR),
      ]);
      expect(await excludedIdsOf(rows)).toEqual(idsOf(rows));
    });

    it('marks a fee row with the tracked received coin while the lone leg keeps no pair id', async () => {
      const { rows } = pepeOrderOf([
        fillOf({
          isBuyer: false,
          qty: '1000000',
          quoteQty: '10',
          commission: '0.0005',
          commissionAsset: 'BNB',
        }),
      ]);

      expect(rows).toStrictEqual([
        legOf('USDT', 1_000_000_000, { untrackedCounterpart: 'asset:PEPE' }, PEPE_PAIR),
        feeRowOf('BNB', -5_000, { counterpartWallet: 'USDT' }, PEPE_PAIR),
      ]);
      expect(await excludedIdsOf(rows)).toEqual(idsOf(rows));
    });

    it('writes no leg when both coins are untracked, lists both, and keeps the fee row', async () => {
      const { rows, untracked } = ordersOf(
        [fillOf({ commission: '0.0005', commissionAsset: 'BNB' })],
        { symbol: 'PEPESHIB', baseAsset: 'PEPE', quoteAsset: 'SHIB' },
      );

      expect(rows).toStrictEqual([
        feeRowOf(
          'BNB',
          -5_000,
          { untrackedCounterpart: 'asset:PEPE' },
          `${ACCOUNT}:trade:PEPESHIB:42`,
        ),
      ]);
      expect(untracked).toStrictEqual(['PEPE', 'SHIB']);
      expect(await excludedIdsOf(rows)).toEqual(idsOf(rows));
    });

    it('writes nothing for two untracked coins and a commission in one of them', () => {
      const { rows, untracked } = ordersOf([fillOf({ commission: '5', commissionAsset: 'SHIB' })], {
        symbol: 'PEPESHIB',
        baseAsset: 'PEPE',
        quoteAsset: 'SHIB',
      });

      expect(rows).toStrictEqual([]);
      expect(untracked).toStrictEqual(['PEPE', 'SHIB']);
    });
  });

  describe('a leg that comes to no units at its coin scale', () => {
    const XRP_PAIR = `${ACCOUNT}:trade:XRPUSDT:42`;
    const xrpOrderOf = (fills: BinanceMyTrade[]) =>
      ordersOf(fills, { symbol: 'XRPUSDT', baseAsset: 'XRP' });

    it('writes neither leg when the received leg rounds to nothing, and still writes a fee row', () => {
      const { rows } = xrpOrderOf([
        fillOf({
          qty: '0.00004',
          quoteQty: '0.00001',
          commission: '0.0005',
          commissionAsset: 'BNB',
        }),
      ]);

      expect(rows).toStrictEqual([feeRowOf('BNB', -5_000, { counterpartWallet: 'XRP' }, XRP_PAIR)]);
      expect(roundedLogs()).toHaveLength(1);
    });

    it('writes neither leg when the spent leg rounds to nothing', () => {
      const { rows } = xrpOrderOf([
        fillOf({
          isBuyer: false,
          qty: '0.00004',
          quoteQty: '0.00001',
          commission: '0',
          commissionAsset: 'USDT',
        }),
      ]);

      expect(rows).toStrictEqual([]);
      expect(roundedLogs()).toHaveLength(1);
    });

    it('converts a reduced scale coin once from the sum of the fills, not once per fill', () => {
      const fillAt = (id: number) =>
        fillOf({ id, qty: '0.00004', quoteQty: '1', commission: '0', commissionAsset: 'USDT' });

      expect(xrpOrderOf([fillAt(1)]).rows).toStrictEqual([]);
      expect(roundedLogs()).toHaveLength(1);

      warn.mockClear();

      expect(xrpOrderOf([fillAt(1), fillAt(2), fillAt(3)]).rows).toStrictEqual(
        pairLegsOf(['USDT', -300_000_000], ['XRP', 1], XRP_PAIR),
      );
      expect(roundedLogs()).toHaveLength(1);
    });
  });

  describe('a fiat leg past its scale', () => {
    const EUR_PAIR = `${ACCOUNT}:trade:BTCEUR:42`;
    const eurOrderOf = (fills: BinanceMyTrade[]) =>
      ordersOf(fills, { symbol: 'BTCEUR', quoteAsset: 'EUR' });
    const eurFillOf = (over: Partial<BinanceMyTrade>) =>
      fillOf({ commission: '0', commissionAsset: 'BNB', ...over });

    it.each([
      ['3 decimals', '612.345', 61235],
      ['4 decimals', '612.3449', 61234],
      ['5 decimals', '612.34499', 61234],
      ['6 decimals', '612.344999', 61234],
      ['7 decimals', '612.3456789', 61235],
      ['just under a half', '612.3449999', 61234],
    ])('rounds the spent quote amount of a BTCEUR buy at %s once', (_label, quoteQty, units) => {
      const { rows } = eurOrderOf([eurFillOf({ quoteQty })]);

      expect(rows).toStrictEqual(pairLegsOf(['EUR', -units], ['BTC', 1_000_000], EUR_PAIR));
      expect(roundedLogs()).toHaveLength(1);
    });

    it('rounds the received quote amount of a BTCEUR sell, net of a commission in EUR', () => {
      const { rows } = eurOrderOf([
        eurFillOf({
          isBuyer: false,
          quoteQty: '612.3456789',
          commission: '0.00123',
          commissionAsset: 'EUR',
        }),
      ]);

      expect(rows).toStrictEqual(pairLegsOf(['BTC', -1_000_000], ['EUR', 61_234], EUR_PAIR));
      expect(roundedLogs()).toHaveLength(1);
    });

    it('rounds an amount that crosses the boundary only in the sum, once, not once per fill', () => {
      const fillAt = (id: number) => eurFillOf({ id, qty: '0.0000001', quoteQty: '0.004' });

      expect(eurOrderOf([fillAt(1)]).rows).toStrictEqual([]);
      expect(roundedLogs()).toHaveLength(1);

      warn.mockClear();

      expect(eurOrderOf([fillAt(1), fillAt(2), fillAt(3)]).rows).toStrictEqual(
        pairLegsOf(['EUR', -1], ['BTC', 30], EUR_PAIR),
      );
      expect(roundedLogs()).toHaveLength(1);
    });

    it('rounds a fee in a third fiat coin half away from zero after the sum of the fills', () => {
      const fillAt = (id: number) => fillOf({ id, commission: '0.004', commissionAsset: 'EUR' });

      expect(ordersOf([fillAt(1)]).rows).toHaveLength(2);
      expect(roundedLogs()).toHaveLength(1);

      warn.mockClear();

      const { rows } = ordersOf([fillAt(1), fillAt(2), fillAt(3)]);

      expect(rows.map((row) => [row.wallet, row.amountMinorUnits, row.operation])).toStrictEqual([
        ['USDT', -180_000_000_000, 'trade'],
        ['BTC', 3_000_000, 'trade'],
        ['EUR', -1, 'trade-fee'],
      ]);
      expect(roundedLogs()).toHaveLength(1);
    });

    it('keeps a crypto coin as it was: a full-scale coin past its scale still stops the order', () => {
      expect(stopOf(() => ordersOf([fillOf({ qty: '0.123456789' })]))).toMatchObject({
        name: 'BinanceWalkStop',
        code: 'amount-precision',
      });
      expect(roundedLogs()).toHaveLength(0);
    });
  });

  describe('keys', () => {
    it('keys the rows apart for two accounts, two symbols and two orders', () => {
      const keysOf = (over: Partial<Parameters<typeof tradeOrderRowsOf>[0]>) =>
        ordersOf([fillOf()], over).rows.map((row) => row.externalId);
      const all = [
        keysOf({}),
        keysOf({ accountId: 'acc-2' }),
        keysOf({ symbol: 'BTCUSDC', quoteAsset: 'USDC' }),
        keysOf({ orderId: 43 }),
      ].flat();

      expect(new Set(all).size).toBe(all.length);
      expect(keysOf({})).toStrictEqual([`${PAIR}:USDT`, `${PAIR}:BTC`]);
    });
  });

  describe('an order the rules refuse', () => {
    it('refuses fills that disagree on the side as a page that cannot be read', () => {
      expect(() => ordersOf([fillOf({ id: 1 }), fillOf({ id: 2, isBuyer: false })])).toThrow(
        BinanceHistoryParseError,
      );
    });

    it('refuses an order with no fills', () => {
      expect(() => ordersOf([])).toThrow(BinanceHistoryParseError);
    });

    it.each([['qty'], ['quoteQty'], ['commission']] as const)('stops on a negative %s', (field) => {
      const stop = stopOf(() => ordersOf([fillOf({ [field]: '-1' })]));

      expect(stop).toBeInstanceOf(BinanceWalkStop);
      expect(stop).toMatchObject({ code: 'trade-amount-invalid' });
    });

    it('stops when the commission in the received coin is more than the coin received', () => {
      expect(stopOf(() => ordersOf([fillOf({ commission: '0.02' })]))).toMatchObject({
        code: 'trade-amount-invalid',
      });
    });

    it('stops with the code of the parser and names the coin that is too large', () => {
      const stop = stopOf(() => ordersOf([fillOf({ qty: '1000000000' })]));

      expect(stop).toBeInstanceOf(BinanceWalkStop);
      expect(stop).toMatchObject({ code: 'amount-too-large', oversizedTicker: 'BTC' });
    });

    it('stops on digits past the scale of a coin that is not stored reduced', () => {
      expect(stopOf(() => ordersOf([fillOf({ qty: '0.123456789' })]))).toMatchObject({
        code: 'amount-precision',
      });
    });
  });
});
