import { DAY_MS } from '@kiko/dates';
import { coinListPatchesOf, walkStateFake } from '@kiko/test-support/walk-marks';

import { NOW } from './bybit.client-test-fixtures';
import { ACCOUNT_ID, served } from './bybit.capital-test-fixtures';
import { entryAt, logWalkOf, quoteLegAt, spotAt, sumsByHolding } from './bybit.log-test-fixtures';
import { NEVER_READ, SPOT_TRADE_ID, spotLogRow, withoutField } from './bybit.history-test-fixtures';

const CURSOR = NOW - 3 * DAY_MS;
const AT = NOW - 2 * DAY_MS;
const SECOND_MS = 1_000;
const ORDER = 'order-1';
const BOUGHT_BTC = 299_700;
const PAID_USDT = -30_000_000_000;

const newWalk = (
  options: Partial<Parameters<typeof logWalkOf>[0]> = {},
  marks: Record<string, unknown> = { cursor: CURSOR },
) =>
  logWalkOf({
    state: walkStateFake({ accountId: ACCOUNT_ID, marks: { log: marks } }),
    ...options,
  });

type Walk = ReturnType<typeof newWalk>;

const keyOf = (id: string, time: number, coin: string) => `acc-1:log:${id}:TRADE:${time}:${coin}`;

const wholeSpan = { start: CURSOR, end: NOW, series: 'log' };

const pointAt = (time: number) => ({
  start: time - 1,
  end: time + 1,
  kind: 'point',
  series: 'log',
  since: NOW,
});

const loggedCodes = (warn: jest.SpyInstance): unknown[] =>
  warn.mock.calls.map(([, details]) => (details as { code?: string }).code);

const storedStateOf = async (walk: Walk) =>
  JSON.parse((await walk.readState()) ?? '{}') as { logKinds?: string[] };

const sumByHolding = (walk: Walk): Record<string, number> => sumsByHolding(walk.rows());

// Every row of these suites is built on the field words of the docs page's TRADE sample: no page
// shows a spot row, and none was read live.
describe('the log walk: what each row is', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('a spot trade', () => {
    it('a spot row writes one leg of change with the fee inside, marked out of spending, and pairs by order', async () => {
      const walk = newWalk();
      walk.world.log = [
        spotAt(AT, { id: 'buy', orderId: ORDER }),
        quoteLegAt(AT, { id: 'pay', orderId: ORDER }),
      ];

      const result = await walk.run();

      expect(result).toEqual({ imported: 2, complete: true });
      expect(walk.rows()).toEqual([
        {
          externalId: keyOf('buy', AT, 'BTC'),
          holdingId: 'holding-BTC:unified',
          amountMinorUnits: BOUGHT_BTC,
          time: AT,
          source: 'bybit',
          description: '',
          operation: 'trade',
          exchangePairId: 'acc-1:trade:order-1:BTCUSDT',
          exchangeCounterpartHoldingId: 'holding-USDT:unified',
        },
        {
          externalId: keyOf('pay', AT, 'USDT'),
          holdingId: 'holding-USDT:unified',
          amountMinorUnits: PAID_USDT,
          time: AT,
          source: 'bybit',
          description: '',
          operation: 'trade',
          exchangePairId: 'acc-1:trade:order-1:BTCUSDT',
          exchangeCounterpartHoldingId: 'holding-BTC:unified',
        },
      ]);
    });

    it('takes the other coin of the pair from the symbol, as its prefix or its suffix', async () => {
      const walk = newWalk();
      walk.world.log = [
        spotAt(AT, { id: 'eth', symbol: 'ETHBTC', currency: 'ETH', orderId: ORDER }),
        quoteLegAt(AT, { id: 'quote', symbol: 'ETHBTC', currency: 'BTC', orderId: ORDER }),
      ];

      await walk.run();

      expect(walk.rows().map((row) => [row.holdingId, row.exchangeCounterpartHoldingId])).toEqual([
        ['holding-ETH:unified', 'holding-BTC:unified'],
        ['holding-BTC:unified', 'holding-ETH:unified'],
      ]);
    });

    it('creates the holdings of both coins at zero on the Unified wallet', async () => {
      const walk = newWalk();
      walk.world.log = [spotAt(AT, { orderId: ORDER })];

      await walk.run();

      expect(walk.deps.ensureHoldings).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'Bybit Unified · BTC',
          currency: 'BTC',
          balanceMinorUnits: 0,
          metadataKey: 'BTC:unified',
        }),
        expect.objectContaining({
          name: 'Bybit Unified · USDT',
          currency: 'USDT',
          balanceMinorUnits: 0,
          metadataKey: 'USDT:unified',
        }),
      ]);
    });

    it('imports a trade once, whatever the number of runs that read it', async () => {
      const walk = newWalk();
      walk.world.log = [spotAt(AT)];
      await walk.run();

      walk.clock.now = NOW + DAY_MS;
      const second = await walk.run();

      expect(second.imported).toBe(0);
      expect(walk.rows()).toHaveLength(1);
    });

    it('the sum per coin is the same under one row per fill and one row per order', async () => {
      const fills = newWalk();
      fills.world.log = [1, 2, 3].flatMap((index) => [
        spotAt(AT + index * SECOND_MS, {
          id: `fill-${index}`,
          qty: '0.001',
          fee: '0.000001',
          change: '0.000999',
        }),
        quoteLegAt(AT + index * SECOND_MS, { id: `pay-${index}`, qty: '-100', change: '-100' }),
      ]);
      const order = newWalk();
      order.world.log = [
        spotAt(AT, { id: 'order', qty: '0.003', fee: '0.000003', change: '0.002997' }),
        quoteLegAt(AT, { id: 'pay' }),
      ];

      await fills.run();
      await order.run();

      expect(sumByHolding(fills)).toEqual({
        'holding-BTC:unified': BOUGHT_BTC,
        'holding-USDT:unified': PAID_USDT,
      });
      expect(sumByHolding(order)).toEqual(sumByHolding(fills));
      expect(fills.rows()).toHaveLength(6);
      expect(order.rows()).toHaveLength(2);
    });

    it('a change past the scale of its coin rounds, and still imports', async () => {
      const walk = newWalk();
      walk.world.log = [spotAt(AT, { qty: '0.003000004', fee: '0.000003', change: '0.002997004' })];

      await walk.run();

      expect(walk.rows().map((row) => row.amountMinorUnits)).toEqual([BOUGHT_BTC]);
      expect(walk.marks().pending).toEqual([]);
    });

    it('a log leg that rounds to zero writes no row and leaves the other leg', async () => {
      const walk = newWalk();
      walk.world.log = [
        spotAt(AT, { id: 'dust', qty: '0.000000004', fee: '0', change: '0.000000004' }),
        quoteLegAt(AT, { id: 'pay' }),
      ];

      await walk.run();

      expect(walk.rows().map((row) => [row.externalId, row.amountMinorUnits])).toEqual([
        [keyOf('pay', AT, 'USDT'), PAID_USDT],
      ]);
      expect(walk.marks().pending).toEqual([]);
      expect(walk.deps.ensureHoldings).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ metadataKey: 'BTC:unified' })]),
      );
    });

    it('an amount past the safe integer owes its point, lists its coin as oversized, and its neighbour imports', async () => {
      const walk = newWalk();
      walk.world.log = [
        spotAt(AT, { id: 'huge', qty: '99999999999', fee: '0', change: '99999999999' }),
        spotAt(AT + SECOND_MS, { id: 'good' }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual([keyOf('good', AT + SECOND_MS, 'BTC')]);
      expect(walk.marks().pending).toEqual([pointAt(AT)]);
      expect(coinListPatchesOf(walk.deps)).toContainEqual({
        kind: 'coinList',
        coins: 'oversizedCoins',
        list: 'history',
        tickers: ['BTC'],
      });
      expect(loggedCodes(warn)).toEqual(['amount-too-large']);
    });
  });

  describe('the key of a row', () => {
    it("the page's repeated id keeps rows apart by coin and by time", async () => {
      const walk = newWalk();
      walk.world.log = [
        spotAt(AT, { id: 'same' }),
        quoteLegAt(AT, { id: 'same' }),
        spotAt(AT + SECOND_MS, { id: 'same' }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual([
        keyOf('same', AT, 'BTC'),
        keyOf('same', AT, 'USDT'),
        keyOf('same', AT + SECOND_MS, 'BTC'),
      ]);
    });

    it('one key with two values owes both of their point, and its neighbour imports', async () => {
      const walk = newWalk();
      walk.world.log = [
        spotAt(AT, { id: 'key' }),
        spotAt(AT, { id: 'key', qty: '0.002003', change: '0.002' }),
        spotAt(AT + SECOND_MS, { id: 'good' }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual([keyOf('good', AT + SECOND_MS, 'BTC')]);
      expect(walk.marks().pending).toEqual([pointAt(AT)]);
      expect(loggedCodes(warn)).toEqual(['log-key-conflict']);
    });

    it('a row read twice in one span, with the same change, imports once', async () => {
      const walk = newWalk();
      walk.world.log = [spotAt(AT, { id: 'key' }), spotAt(AT, { id: 'key' })];

      const result = await walk.run();

      expect(result.imported).toBe(1);
      expect(walk.marks().pending).toEqual([]);
    });

    it('a point owed by a conflict is read again, and imports once the read shows one value', async () => {
      const walk = newWalk();
      walk.world.log = [
        spotAt(AT, { id: 'key' }),
        spotAt(AT, { id: 'key', qty: '0.002003', change: '0.002' }),
      ];
      await walk.run();

      walk.world.log = [spotAt(AT, { id: 'key' })];
      walk.clock.now = NOW + DAY_MS;
      await walk.run();

      expect(walk.keys()).toEqual([keyOf('key', AT, 'BTC')]);
      expect(walk.marks().pending).toEqual([]);
    });
  });

  describe('a row the walk cannot trust owes its span as one range, never a point', () => {
    it.each([
      ['qty is not change plus fee', { qty: '0.004' }],
      [
        'a linear-shaped row, whose qty is a size and whose change is only the fee',
        { qty: '88', fee: '0.0190872', change: '-0.0190872' },
      ],
      ['change is empty', { change: '' }],
      ['qty is empty', { qty: '' }],
      ['change is an exponent', { change: '2.997e-3' }],
      ['change holds a plus sign', { change: '+0.002997' }],
      ['fee is text', { fee: 'a lot' }],
    ])('%s: no row, one range, and the neighbour imports', async (_name, overrides) => {
      const walk = newWalk();
      walk.world.log = [
        spotAt(AT, { id: 'bad', ...overrides }),
        spotAt(AT + SECOND_MS, { id: 'good' }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual([keyOf('good', AT + SECOND_MS, 'BTC')]);
      expect(walk.marks().pending).toEqual([wholeSpan]);
      expect(walk.marks().cursor).toBe(NOW);
      expect(loggedCodes(warn)).toEqual(['log-spot-check-failed']);
    });

    it('an empty fee counts as zero', async () => {
      const walk = newWalk();
      walk.world.log = [spotAt(AT, { fee: '', qty: '0.002997', change: '0.002997' })];

      await walk.run();

      expect(walk.rows().map((row) => row.amountMinorUnits)).toEqual([BOUGHT_BTC]);
      expect(walk.marks().pending).toEqual([]);
    });

    it.each(['fee', 'qty', 'change', 'orderId', 'id', 'symbol'])(
      'a spot row with no %s did not parse: no row, one range',
      async (field) => {
        const walk = newWalk();
        walk.world.log = [
          served(AT, withoutField(spotLogRow({ transactionTime: String(AT) }), field)),
          spotAt(AT + SECOND_MS, { id: 'good' }),
        ];

        await walk.run();

        expect(walk.keys()).toEqual([keyOf('good', AT + SECOND_MS, 'BTC')]);
        expect(walk.marks().pending).toEqual([wholeSpan]);
        expect(loggedCodes(warn)).toEqual(['log-row-unreadable']);
      },
    );

    it('a spot row of a coin the client left as a row but the app does not track owes its span', async () => {
      const spot = spotAt(AT, { id: 'odd', currency: 'PEPE' }).row;
      const page = {
        rows: [
          {
            kind: 'row',
            times: [AT],
            row: {
              logKind: 'spotTrade',
              ...spot,
              hasTradeId: true,
              time: { start: AT, end: AT },
            },
          },
        ],
        nextPageCursor: undefined,
      };
      const readPage = jest
        .fn()
        .mockResolvedValueOnce(page)
        .mockResolvedValue({ rows: [], nextPageCursor: undefined });
      const walk = newWalk({ overrides: { fetchLogPage: readPage as never } });

      await walk.run();

      expect(walk.keys()).toEqual([]);
      expect(walk.marks().pending).toEqual([wholeSpan]);
      expect(loggedCodes(warn)).toEqual(['log-row-unreadable']);
    });

    it('an item that is no row owes its span, and the neighbour imports', async () => {
      const walk = newWalk();
      walk.world.log = [
        served(AT, 'not a row' as unknown as Record<string, unknown>),
        spotAt(AT + SECOND_MS, { id: 'good' }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual([keyOf('good', AT + SECOND_MS, 'BTC')]);
      expect(walk.marks().pending).toEqual([wholeSpan]);
    });

    it.each([
      ['empty', ''],
      ['zero', '0'],
      ['absent', undefined],
    ])('a spot row whose time is %s makes no row and owes its span', async (_name, time) => {
      const walk = newWalk();
      walk.world.log = [spotAt(AT, { id: 'late', transactionTime: time })];

      await walk.run();

      expect(walk.keys()).toEqual([]);
      expect(walk.marks().pending).toEqual([wholeSpan]);
      expect(walk.marks().cursor).toBe(NOW);
      expect(loggedCodes(warn)).toEqual(['log-time-missing']);
    });

    it('a range owed is read again by a later run and clears once the row passes the check', async () => {
      const walk = newWalk();
      walk.world.log = [spotAt(AT, { id: 'late', qty: '0.004' })];
      await walk.run();

      walk.world.log = [spotAt(AT, { id: 'late' })];
      walk.clock.now = NOW + DAY_MS;
      await walk.run();

      expect(walk.keys()).toEqual([keyOf('late', AT, 'BTC')]);
      expect(walk.marks().pending).toEqual([]);
    });

    it.each([
      ['a third coin: the row is in a coin the symbol does not hold', { currency: 'ETH' }],
      ['a symbol that is the coin alone', { symbol: 'BTC' }],
      ['a symbol with the coin at both ends', { symbol: 'BTCUSDBTC' }],
      ['an other coin that no asset marker can name', { symbol: 'BTC:X' }],
    ])('%s: no row, one range', async (_name, overrides) => {
      const walk = newWalk();
      walk.world.log = [
        spotAt(AT, { id: 'odd', ...overrides }),
        spotAt(AT + SECOND_MS, { id: 'good' }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual([keyOf('good', AT + SECOND_MS, 'BTC')]);
      expect(walk.marks().pending).toEqual([wholeSpan]);
      expect(loggedCodes(warn)).toEqual(['log-coin-pair-unreadable']);
    });
  });

  describe('the tradeId guard', () => {
    it('a spot row with an empty tradeId writes nothing and owes one range', async () => {
      const walk = newWalk();
      walk.world.log = [
        spotAt(AT, { id: 'bare', tradeId: '' }),
        spotAt(AT + SECOND_MS, { id: 'good' }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual([keyOf('good', AT + SECOND_MS, 'BTC')]);
      expect(walk.marks().pending).toEqual([wholeSpan]);
      expect(loggedCodes(warn)).toEqual(['log-trade-id-missing']);
    });

    it('a summary row with an empty tradeId does not double, and a summary row with one is the named double', async () => {
      const fillsOf = (summaryTradeId: string) => [
        ...[1, 2, 3].map((index) =>
          spotAt(AT + index * SECOND_MS, {
            id: `fill-${index}`,
            qty: '0.001',
            fee: '0.000001',
            change: '0.000999',
            tradeId: `trade-${index}`,
          }),
        ),
        spotAt(AT + 5 * SECOND_MS, { id: 'summary', tradeId: summaryTradeId }),
      ];
      const guarded = newWalk();
      guarded.world.log = fillsOf('');
      const doubled = newWalk();
      doubled.world.log = fillsOf('trade-summary');

      await guarded.run();
      await doubled.run();

      expect(sumByHolding(guarded)).toEqual({ 'holding-BTC:unified': BOUGHT_BTC });
      expect(guarded.marks().pending).toEqual([wholeSpan]);
      expect(sumByHolding(doubled)).toEqual({ 'holding-BTC:unified': 2 * BOUGHT_BTC });
    });

    it('the value of a tradeId and the fields never read reach no row, mark or log', async () => {
      const walk = newWalk();
      walk.world.log = [spotAt(AT)];

      await walk.run();

      const written = JSON.stringify([
        walk.rows(),
        walk.marks(),
        (walk.deps.patchExchangeState as jest.Mock).mock.calls,
        warn.mock.calls,
      ]);

      expect(written).not.toContain(SPOT_TRADE_ID);
      expect(written).not.toContain(NEVER_READ);
    });
  });

  describe('a failed spot shape on the busy seed', () => {
    it('every spot row of 5,000 failing leaves at most 12 ranges and no point', async () => {
      const first = NOW - 140 * DAY_MS;
      const walk = newWalk({}, { cursor: first });
      walk.world.log = Array.from({ length: 5_000 }, (_unused, index) =>
        spotAt(first + Math.floor((index * 140 * DAY_MS) / 5_000), {
          id: `row-${index}`,
          qty: '0.004',
        }),
      );

      await Array.from({ length: 30 }).reduce<Promise<void>>(
        (previous) =>
          previous.then(async () => {
            if (walk.marks().cursor !== NOW) {
              await walk.run();
            }
          }),
        Promise.resolve(),
      );
      const pending = walk.marks().pending as { kind?: string }[];

      expect(walk.marks().cursor).toBe(NOW);
      expect(walk.keys()).toEqual([]);
      expect(pending.length).toBeGreaterThan(0);
      expect(pending.length).toBeLessThanOrEqual(12);
      expect(pending.filter((ground) => ground.kind === 'point')).toEqual([]);
    });
  });

  describe('an untracked coin', () => {
    it('a leg against an untracked coin carries the asset marker and lists the coin', async () => {
      const walk = newWalk();
      walk.world.log = [
        quoteLegAt(AT, { id: 'pay', symbol: 'PEPEUSDT', orderId: ORDER }),
        spotAt(AT, {
          id: 'got',
          symbol: 'PEPEUSDT',
          currency: 'PEPE',
          qty: '1000',
          fee: '1',
          change: '999',
          orderId: ORDER,
        }),
      ];

      await walk.run();

      expect(
        walk
          .rows()
          .map((row) => [
            row.externalId,
            row.amountMinorUnits,
            row.untrackedCounterpart,
            row.exchangePairId,
            row.exchangeCounterpartHoldingId,
          ]),
      ).toEqual([[keyOf('pay', AT, 'USDT'), PAID_USDT, 'asset:PEPE', undefined, undefined]]);
      expect(coinListPatchesOf(walk.deps)).toEqual([
        { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['PEPE'] },
      ]);
      expect(walk.marks().pending).toEqual([]);
    });

    it('a trade of two untracked coins writes no row and lists both', async () => {
      const walk = newWalk();
      walk.world.log = [
        spotAt(AT, { id: 'one', symbol: 'PEPESHIB', currency: 'PEPE', qty: '1', fee: '0' }),
        spotAt(AT, { id: 'two', symbol: 'PEPESHIB', currency: 'SHIB', qty: '-1', fee: '0' }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual([]);
      expect(
        coinListPatchesOf(walk.deps)
          .flatMap(({ tickers }) => tickers)
          .sort(),
      ).toEqual(['PEPE', 'SHIB']);
      expect(walk.marks().pending).toEqual([]);
    });
  });

  describe('an entry that is no spot trade', () => {
    it('a trade outside spot writes no row and names its kind in the state', async () => {
      const walk = newWalk();
      walk.world.log = [
        entryAt(AT, 'TRADE', { category: 'linear' }),
        entryAt(AT + SECOND_MS, 'TRADE', { category: 'option' }),
        entryAt(AT + 2 * SECOND_MS, 'TRADE', { category: 'inverse' }),
        entryAt(AT + 3 * SECOND_MS, 'TRADE', { category: 'event' }),
        entryAt(AT + 4 * SECOND_MS, 'SETTLEMENT'),
        entryAt(AT + 5 * SECOND_MS, 'STOCK_TRADE_BUY'),
        entryAt(AT + 6 * SECOND_MS, 'A_WORD_OFF_THE_PAGE'),
        served(AT + 7 * SECOND_MS, withoutField(entryAt(AT, 'TRADE').row, 'type')),
        spotAt(AT + 8 * SECOND_MS, { id: 'good' }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual([keyOf('good', AT + 8 * SECOND_MS, 'BTC')]);
      expect((await storedStateOf(walk)).logKinds).toEqual(['derivatives', 'other', 'stocks']);
      expect(walk.marks().pending).toEqual([]);
      expect(walk.marks().cursor).toBe(NOW);
    });

    it('an entry of the transfer or convert list never imports from the log', async () => {
      const walk = newWalk();
      walk.world.log = [
        entryAt(AT, 'TRANSFER_IN'),
        entryAt(AT + SECOND_MS, 'TRANSFER_OUT'),
        entryAt(AT + 2 * SECOND_MS, 'CURRENCY_BUY'),
        entryAt(AT + 3 * SECOND_MS, 'CURRENCY_SELL'),
        entryAt(AT + 4 * SECOND_MS, 'CONVERT'),
      ];

      await walk.run();

      expect(walk.keys()).toEqual([]);
      expect((await storedStateOf(walk)).logKinds).toEqual(['convertEntries']);
      expect(walk.marks().pending).toEqual([]);
    });

    it('an entry whose time cannot be read owes nothing, and its kind is still named', async () => {
      const walk = newWalk();
      walk.world.log = [
        entryAt(AT, 'SETTLEMENT', { transactionTime: 'not a time' }),
        entryAt(AT + SECOND_MS, 'AIRDROP', { transactionTime: '' }),
      ];

      await walk.run();

      expect((await storedStateOf(walk)).logKinds).toEqual(['bonuses', 'derivatives']);
      expect(walk.marks()).toEqual({ cursor: NOW, pending: [] });
      expect(warn).not.toHaveBeenCalled();
    });

    it('names the kinds before the cursor moves', async () => {
      const walk = newWalk();
      walk.world.log = [entryAt(AT, 'SETTLEMENT')];

      await walk.run();

      const calls = (walk.deps.patchExchangeState as jest.Mock).mock.calls.map(
        ([, written]) => written as { kind: string; field?: string }[],
      );
      const kindsAt = calls.findIndex((written) => written.some(({ kind }) => kind === 'logKinds'));
      const cursorAt = calls.findIndex((written) =>
        written.some(({ field }) => field === 'cursor'),
      );

      expect(kindsAt).toBeGreaterThanOrEqual(0);
      expect(cursorAt).toBeGreaterThanOrEqual(0);
      expect(kindsAt).toBeLessThan(cursorAt);
    });

    it('writes no kinds patch for a span that met none', async () => {
      const walk = newWalk();
      walk.world.log = [spotAt(AT)];

      await walk.run();

      const kinds = (walk.deps.patchExchangeState as jest.Mock).mock.calls.filter(([, written]) =>
        (written as { kind: string }[]).some(({ kind }) => kind === 'logKinds'),
      );

      expect(kinds).toEqual([]);
    });
  });

  it('holds the cursor when a holding cannot be found for a leg', async () => {
    const walk = newWalk({ overrides: { ensureHoldings: jest.fn(async () => undefined) } });
    walk.world.log = [spotAt(AT)];

    await walk.run();

    expect(walk.keys()).toEqual([]);
    expect(walk.marks().cursor).toBe(CURSOR);
    expect(loggedCodes(warn)).toContain('log-holding-missing');
  });
});
