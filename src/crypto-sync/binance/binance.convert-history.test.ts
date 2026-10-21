import { DAY_MS } from '@kiko/dates';
import {
  coinListPatchesOf,
  numberMarkWritesOfAnyWalk,
  walkStateFake,
} from '@kiko/test-support/walk-marks';
import {
  AMOUNT_STOP_CODES,
  BinanceWalkStop,
  type WalkResult,
} from '@kiko/crypto-sync/exchange/walk';
import type { HoldingRow } from '@kiko/db';
import { createExchangeRun } from '@kiko/crypto-sync/exchange/budget';

import {
  type BinanceConvertHistoryDeps,
  CONVERT_FORWARD_OWES,
  CONVERT_WINDOW_MS,
  convertOutcomeOf,
  syncBinanceConvertHistory,
} from './binance.convert-history';
import {
  CONVERT_CREATED_AT,
  convertPageOf,
  convertRecordOf,
  convertServerOf,
} from './binance.convert-test-fixtures';
import { NOW } from './binance.pay-test-fixtures';
import { BinanceRateLimitError } from './binance.client';
import { HISTORY_FLOOR_MS } from './binance.transactions';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { type BinanceRunBudget, createBinanceHistoryRun } from './binance.history-budget';
import { type BinanceConvertRecord, BinanceHistoryParseError } from './binance.history-client';

const ACCOUNT = 'acc-1';
const PAIR = `${ACCOUNT}:convert:order-1`;
const UAH_OUT = -100_000;
const REFUSED = {
  kind: 'refused',
  entry: `convert-unrecognized:order-1:${CONVERT_CREATED_AT}`,
};

const outcomeOf = (over: Partial<BinanceConvertRecord> = {}) =>
  convertOutcomeOf({ accountId: ACCOUNT, record: convertRecordOf(over) });

const rowsOf = (over: Partial<BinanceConvertRecord> = {}) => {
  const outcome = outcomeOf(over);

  if (outcome.kind !== 'rows') {
    throw new Error(`expected rows, got ${outcome.kind}`);
  }

  return outcome;
};

const stopOf = (over: Partial<BinanceConvertRecord> = {}): BinanceWalkStop | undefined => {
  try {
    outcomeOf(over);
  } catch (error) {
    return error instanceof BinanceWalkStop ? error : undefined;
  }

  return undefined;
};

const codeOf = (over: Partial<BinanceConvertRecord> = {}): string | undefined => stopOf(over)?.code;

describe('convertOutcomeOf', () => {
  it('maps a settled Funding conversion into two legs on Funding, each naming the other holding', () => {
    expect(rowsOf()).toEqual({
      kind: 'rows',
      untracked: [],
      rows: [
        {
          wallet: 'UAH:funding',
          counterpartWallet: 'USDT:funding',
          amountMinorUnits: UAH_OUT,
          time: CONVERT_CREATED_AT,
          externalId: `${PAIR}:UAH:funding`,
          exchangePairId: PAIR,
          description: '',
          operation: 'convert',
        },
        {
          wallet: 'USDT:funding',
          counterpartWallet: 'UAH:funding',
          amountMinorUnits: 2_410_000_000,
          time: CONVERT_CREATED_AT,
          externalId: `${PAIR}:USDT:funding`,
          exchangePairId: PAIR,
          description: '',
          operation: 'convert',
        },
      ],
    });
  });

  it('maps a settled Spot conversion into two legs on Spot, keyed by the bare coin', () => {
    const { rows } = rowsOf({ walletType: 'SPOT' });

    expect(
      rows.map(({ wallet, counterpartWallet, externalId }) => [
        wallet,
        counterpartWallet,
        externalId,
      ]),
    ).toEqual([
      ['UAH', 'USDT', `${PAIR}:UAH`],
      ['USDT', 'UAH', `${PAIR}:USDT`],
    ]);
  });

  it('gives both legs the pair id of the account and the record id, and operation convert', () => {
    const { rows } = rowsOf({ recordId: 'q-77' });

    expect(rows.map(({ exchangePairId }) => exchangePairId)).toEqual([
      `${ACCOUNT}:convert:q-77`,
      `${ACCOUNT}:convert:q-77`,
    ]);
    expect(rows.map(({ operation }) => operation)).toEqual(['convert', 'convert']);
  });

  it('keys the legs of two accounts apart for one record', () => {
    const other = convertOutcomeOf({ accountId: 'acc-2', record: convertRecordOf() });

    expect(other).toMatchObject({
      rows: [{ externalId: 'acc-2:convert:order-1:UAH:funding' }, {}],
    });
  });

  it.each(['PROCESS', 'ACCEPT_SUCCESS'])(
    'owes the point of a %s conversion whatever its wallet, and reads nothing else',
    (orderStatus) => {
      expect(codeOf({ orderStatus })).toBe('convert-not-settled');
      expect(codeOf({ orderStatus, walletType: 'MAIN' })).toBe('convert-not-settled');
      expect(
        codeOf({
          orderStatus,
          walletType: undefined,
          fromAsset: undefined,
          toAsset: '',
          fromAmount: undefined,
        }),
      ).toBe('convert-not-settled');
    },
  );

  it.each([undefined, '', 'SPOT_FUNDING', 'MAIN', 'funding'])(
    'refuses a settled conversion whose wallet is %p into one entry, with no leg',
    (walletType) => {
      expect(outcomeOf({ walletType })).toEqual(REFUSED);
    },
  );

  it.each([['EXPIRED'], [''], [undefined], ['success']])(
    'refuses a conversion whose status is %p into one entry without reading its wallet or coins',
    (orderStatus) => {
      expect(
        outcomeOf({
          orderStatus,
          walletType: undefined,
          fromAsset: undefined,
          toAsset: undefined,
          fromAmount: undefined,
          toAmount: undefined,
        }),
      ).toEqual(REFUSED);
    },
  );

  it.each([['FUNDING'], ['MAIN'], [undefined], ['SPOT']])(
    'gives a FAIL conversion with wallet %p no row and no entry',
    (walletType) => {
      expect(outcomeOf({ orderStatus: 'FAIL', walletType, fromAsset: undefined })).toEqual({
        kind: 'none',
      });
    },
  );

  it('names the refused record by kind, record id and time', () => {
    expect(outcomeOf({ recordId: 'q-9', createTime: 1_234, orderStatus: 'EXPIRED' })).toEqual({
      kind: 'refused',
      entry: 'convert-unrecognized:q-9:1234',
    });
  });

  it('keeps the tracked leg alone when the other coin is not tracked, marking it with that coin', () => {
    expect(
      rowsOf({ fromAsset: 'USDT', fromAmount: '50', toAsset: 'PEPE', toAmount: 'oops' }),
    ).toEqual({
      kind: 'rows',
      untracked: ['PEPE'],
      rows: [
        {
          wallet: 'USDT:funding',
          amountMinorUnits: -5_000_000_000,
          time: CONVERT_CREATED_AT,
          externalId: `${PAIR}:USDT:funding`,
          untrackedCounterpart: 'asset:PEPE',
          description: '',
          operation: 'convert',
        },
      ],
    });
  });

  it('gives a lone received leg a positive amount and no pair id', () => {
    const { rows, untracked } = rowsOf({
      fromAsset: 'PEPE',
      fromAmount: 'oops',
      toAsset: 'USDT',
      toAmount: '1',
    });

    expect(untracked).toEqual(['PEPE']);
    expect(rows).toEqual([
      expect.objectContaining({
        wallet: 'USDT:funding',
        amountMinorUnits: 100_000_000,
        untrackedCounterpart: 'asset:PEPE',
        operation: 'convert',
      }),
    ]);
    expect(rows[0]).not.toHaveProperty('exchangePairId');
    expect(rows[0]).not.toHaveProperty('counterpartWallet');
  });

  it('puts a lone leg on the Spot holding for a Spot conversion', () => {
    expect(rowsOf({ walletType: 'SPOT', toAsset: 'PEPE', toAmount: '1' }).rows).toMatchObject([
      { wallet: 'UAH', externalId: `${PAIR}:UAH` },
    ]);
  });

  it('lists both coins and writes no row when neither side is tracked', () => {
    expect(rowsOf({ fromAsset: 'PEPE', toAsset: 'SHIB', fromAmount: 'x', toAmount: '-' })).toEqual({
      kind: 'rows',
      rows: [],
      untracked: ['PEPE', 'SHIB'],
    });
  });

  it.each([
    ['a tracked coin', 'USDT'],
    ['a coin that is not tracked', 'PEPE'],
  ])('refuses a settled conversion of %s into itself into one entry', (_name, asset) => {
    expect(outcomeOf({ fromAsset: asset, toAsset: asset })).toEqual(REFUSED);
  });

  it('does not refuse a conversion of a coin into itself that is not settled', () => {
    expect(codeOf({ orderStatus: 'PROCESS', fromAsset: 'USDT', toAsset: 'USDT' })).toBe(
      'convert-not-settled',
    );
    expect(outcomeOf({ orderStatus: 'FAIL', fromAsset: 'USDT', toAsset: 'USDT' })).toEqual({
      kind: 'none',
    });
  });

  it('refuses the unrecognized wallet before it looks at the coins', () => {
    expect(outcomeOf({ walletType: 'MAIN', fromAsset: undefined, toAsset: undefined })).toEqual(
      REFUSED,
    );
  });

  it.each([
    ['a missing from coin', { fromAsset: undefined }],
    ['a blank from coin', { fromAsset: '' }],
    ['a missing to coin', { toAsset: undefined }],
    ['a blank to coin', { toAsset: '' }],
    ['two blank coins', { fromAsset: '', toAsset: '' }],
  ])('owes the point of a settled conversion with %s: it is unreadable', (_name, over) => {
    expect(codeOf(over)).toBe('convert-row-unreadable');
  });

  it('owes the point of a lone leg whose other coin has no usable code', () => {
    expect(codeOf({ toAsset: 'A:B' })).toBe('convert-row-unreadable');
  });

  it('lists a coin with no usable code when neither side is tracked', () => {
    expect(rowsOf({ fromAsset: 'A:B', toAsset: 'PEPE' })).toEqual({
      kind: 'rows',
      rows: [],
      untracked: ['A:B', 'PEPE'],
    });
  });

  it.each([
    ['absent from amount', { fromAmount: undefined }, 'convert-row-unreadable'],
    ['absent to amount', { toAmount: undefined }, 'convert-row-unreadable'],
    ['zero', { fromAmount: '0' }, 'convert-amount-invalid'],
    ['zero with decimals', { toAmount: '0.00000000' }, 'convert-amount-invalid'],
    ['negative', { fromAmount: '-1' }, 'convert-amount-invalid'],
    ['in exponent form', { fromAmount: '1e-3' }, 'amount-malformed'],
    ['over-precise for UAH', { fromAmount: '1.005' }, 'amount-precision'],
    ['blank', { toAmount: '' }, 'amount-malformed'],
  ])(
    'owes the point of a settled conversion with a tracked side whose amount is %s',
    (_name, over, code) => {
      expect(codeOf(over)).toBe(code);
    },
  );

  it('names the coin of an amount past the safe integer, so the walk lists it as oversized', () => {
    expect(stopOf({ toAmount: '90071992.54740992' })).toMatchObject({
      code: 'amount-too-large',
      oversizedTicker: 'USDT',
    });
  });

  it('reads the amount of a tracked side only, so an untracked side may be unreadable', () => {
    expect(rowsOf({ toAsset: 'PEPE', toAmount: undefined }).rows).toHaveLength(1);
    expect(codeOf({ toAsset: 'PEPE', fromAmount: undefined })).toBe('convert-row-unreadable');
  });

  it('owes the point of every stop it throws and goes past it in the forward pass', () => {
    expect(CONVERT_FORWARD_OWES).toEqual([
      'convert-not-settled',
      'convert-row-unreadable',
      'convert-amount-invalid',
      ...AMOUNT_STOP_CODES,
    ]);
  });
});

// `cooldownUntilByAccount` is module-level and has no exported reset, so every case uses its own
// account id.
let accountSequence = 0;

const holdingWith = (id: string, metadata: Record<string, unknown>): HoldingRow =>
  ({ id, metadata }) as unknown as HoldingRow;

const FUNDING_HOLDINGS = [
  holdingWith('h-uah-funding', { binanceAsset: 'UAH:funding' }),
  holdingWith('h-usdt-funding', { binanceAsset: 'USDT:funding' }),
];

const HOUR_MS = 3_600_000;

type Query = { startTime: number; endTime: number };

type AddedRow = {
  holdingId: string;
  exchangeCounterpartHoldingId?: string;
  amountMinorUnits: number;
  externalId: string;
  exchangePairId?: string;
  untrackedCounterpart?: string;
  operation: string;
};

/** A run with no call cap, so a case can read as many requests as it needs in one run. */
const wideRun = () => {
  const budget: BinanceRunBudget = { canAfford: () => true, record: jest.fn() };

  return createExchangeRun({
    intervalMs: 0,
    clock: { now: () => NOW, sleep: async () => undefined },
    budget,
  });
};

const freshRun = () => createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined });

/** A connected account with its walk state, and the walk's deps over that one state. */
const worldOf = () => {
  accountSequence += 1;
  const accountId = `acc-convert-${accountSequence}`;
  const fake = walkStateFake({ accountId, alongside: FUNDING_HOLDINGS });
  const depsOf = (over: Partial<BinanceConvertHistoryDeps> = {}): BinanceConvertHistoryDeps => ({
    now: () => NOW,
    fetchImpl: (async () => ({})) as unknown as typeof fetch,
    readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
    ensureHoldings: jest.fn(async () => undefined),
    addTransactions: jest.fn(async (rows: unknown[]) => rows.length),
    fetchConvertHistory: jest.fn(async () => convertPageOf()),
    ...fake.freshDeps(),
    listHoldings: fake.listHoldings,
    ...over,
  });
  const walk = (deps: BinanceConvertHistoryDeps, run = freshRun()) =>
    syncBinanceConvertHistory({ targetAccountId: accountId, run }, deps);

  return { accountId, fake, depsOf, walk };
};

/** A world whose walk is an hour behind, so one run reads the conversions of the last hour. */
const recentWorld = () => {
  const world = worldOf();

  world.fake.seed('convert', { cursor: NOW - HOUR_MS });

  return world;
};

const queriesOf = (deps: BinanceConvertHistoryDeps): Query[] =>
  (deps.fetchConvertHistory as jest.Mock).mock.calls.map((call) => call[2] as Query);

const addedRows = (deps: BinanceConvertHistoryDeps): AddedRow[] =>
  (deps.addTransactions as jest.Mock).mock.calls.flatMap((call) => call[0] as AddedRow[]);

const CURSOR = (world: ReturnType<typeof worldOf>) => world.fake.marksOf('convert').cursor;

let warn: jest.SpyInstance;

const stopCodes = (): string[] => warn.mock.calls.map(([, detail]) => detail.code);

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('the Convert walk windows', () => {
  it('reads 30-day windows forward from the history floor, oldest first, 20 to a run', async () => {
    const { depsOf, walk } = worldOf();
    const deps = depsOf();

    await walk(deps);

    const queries = queriesOf(deps);
    expect(queries).toHaveLength(20);
    expect(queries[0].startTime).toBe(HISTORY_FLOOR_MS);

    for (const [index, query] of queries.entries()) {
      expect(query.startTime).toBe(HISTORY_FLOOR_MS + index * CONVERT_WINDOW_MS);
      expect(query.endTime - query.startTime).toBe(CONVERT_WINDOW_MS);
    }
  });

  describe('a conversion behind 103 empty windows', () => {
    const JANUARY = convertRecordOf({ recordId: 'jan', createTime: Date.UTC(2026, 0, 15) });

    const sixRuns = async () => {
      const world = worldOf();
      const server = convertServerOf([JANUARY]);
      const runs: { deps: BinanceConvertHistoryDeps; result: WalkResult }[] = [];

      for (let run = 0; run < 6; run += 1) {
        const deps = world.depsOf({ fetchConvertHistory: server });

        runs.push({ deps, result: await world.walk(deps) });
      }

      return { server, runs };
    };

    it('lies in window 104 of 113', () => {
      expect(Math.floor((JANUARY.createTime - HISTORY_FLOOR_MS) / CONVERT_WINDOW_MS) + 1).toBe(104);
      expect(Math.ceil((NOW - HISTORY_FLOOR_MS) / CONVERT_WINDOW_MS)).toBe(113);
    });

    it('is imported at run 6 of 6, and at no run before', async () => {
      const { runs } = await sixRuns();

      expect(runs.map(({ result }) => result.imported)).toEqual([0, 0, 0, 0, 0, 2]);
      expect(runs.map(({ deps }) => addedRows(deps).length)).toEqual([0, 0, 0, 0, 0, 2]);
      expect(runs.map(({ result }) => result.complete)).toEqual([
        false,
        false,
        false,
        false,
        false,
        true,
      ]);
    });

    it('reads every window once, empty ones included, to now', async () => {
      const { server } = await sixRuns();
      const starts = (server.mock.calls as unknown as [string, string, Query][]).map(
        ([, , query]) => query.startTime,
      );
      const onGrid = starts.filter((start) => (start - HISTORY_FLOOR_MS) % CONVERT_WINDOW_MS === 0);

      expect(onGrid).toHaveLength(113);
      expect(new Set(onGrid).size).toBe(113);
      expect(
        Math.max(
          ...(server.mock.calls as unknown as [string, string, Query][]).map(
            ([, , query]) => query.endTime,
          ),
        ),
      ).toBe(NOW);
    });
  });
});

describe('what the Convert walk imports', () => {
  it('imports a Funding conversion as two legs on the Funding holdings, each naming the other', async () => {
    const { accountId, depsOf, walk } = recentWorld();
    const deps = depsOf({ fetchConvertHistory: convertServerOf([convertRecordOf()]) });
    const pairId = `${accountId}:convert:order-1`;

    const result = await walk(deps);

    expect(result.imported).toBe(2);
    expect(addedRows(deps)).toEqual([
      {
        holdingId: 'h-uah-funding',
        exchangeCounterpartHoldingId: 'h-usdt-funding',
        amountMinorUnits: -100_000,
        time: CONVERT_CREATED_AT,
        source: 'binance',
        externalId: `${pairId}:UAH:funding`,
        exchangePairId: pairId,
        description: '',
        operation: 'convert',
      },
      {
        holdingId: 'h-usdt-funding',
        exchangeCounterpartHoldingId: 'h-uah-funding',
        amountMinorUnits: 2_410_000_000,
        time: CONVERT_CREATED_AT,
        source: 'binance',
        externalId: `${pairId}:USDT:funding`,
        exchangePairId: pairId,
        description: '',
        operation: 'convert',
      },
    ]);
  });

  it('imports the tracked leg alone, marked with the other coin, and lists that coin', async () => {
    const { depsOf, walk } = recentWorld();
    const deps = depsOf({
      fetchConvertHistory: convertServerOf([
        convertRecordOf({
          fromAsset: 'USDT',
          fromAmount: '5',
          toAsset: 'PEPE',
          toAmount: '900000',
        }),
      ]),
    });

    await walk(deps);

    expect(addedRows(deps)).toEqual([
      expect.objectContaining({
        holdingId: 'h-usdt-funding',
        amountMinorUnits: -500_000_000,
        untrackedCounterpart: 'asset:PEPE',
        operation: 'convert',
      }),
    ]);
    expect(addedRows(deps)[0].exchangePairId).toBeUndefined();
    expect(addedRows(deps)[0].exchangeCounterpartHoldingId).toBeUndefined();
    expect(coinListPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['PEPE'] },
    ]);
  });

  it('imports nothing of a conversion of two untracked coins and lists both', async () => {
    const { depsOf, walk } = recentWorld();
    const deps = depsOf({
      fetchConvertHistory: convertServerOf([
        convertRecordOf({ fromAsset: 'PEPE', toAsset: 'SHIB' }),
      ]),
    });

    const result = await walk(deps);

    expect(result.imported).toBe(0);
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(coinListPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['PEPE', 'SHIB'] },
    ]);
  });

  it('writes a conversion a rule refuses as one entry, imports no row, and goes past it', async () => {
    const world = recentWorld();
    const deps = world.depsOf({
      fetchConvertHistory: convertServerOf([convertRecordOf({ walletType: 'MAIN' })]),
    });

    const result = await world.walk(deps);

    expect(result.imported).toBe(0);
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(world.fake.notImported()).toEqual([
      `convert-unrecognized:order-1:${CONVERT_CREATED_AT}`,
    ]);
    expect(CURSOR(world)).toBe(NOW);
  });

  it('adds no second entry when a later run reads the refused conversion again', async () => {
    const world = recentWorld();
    const server = convertServerOf([convertRecordOf({ walletType: 'MAIN' })]);

    await world.walk(world.depsOf({ fetchConvertHistory: server }));
    const second = world.depsOf({ fetchConvertHistory: server });
    await world.walk(second);

    expect(queriesOf(second).length).toBeGreaterThan(0);
    expect(world.fake.notImported()).toEqual([
      `convert-unrecognized:order-1:${CONVERT_CREATED_AT}`,
    ]);
  });

  it.each(['FAIL', 'PROCESS', 'ACCEPT_SUCCESS'])(
    'writes no row and no entry for a %s conversion, whatever its wallet',
    async (orderStatus) => {
      const world = recentWorld();
      const deps = world.depsOf({
        fetchConvertHistory: convertServerOf([
          convertRecordOf({ orderStatus, walletType: 'MAIN' }),
        ]),
      });

      await world.walk(deps);

      expect(deps.addTransactions).not.toHaveBeenCalled();
      expect(world.fake.notImported()).toEqual([]);
      expect(CURSOR(world)).toBe(NOW);
    },
  );

  it('owes the point of a conversion that waits, and still imports the others of its window', async () => {
    const world = recentWorld();
    const waiting = convertRecordOf({ recordId: 'waits', orderStatus: 'PROCESS' });
    const deps = world.depsOf({
      fetchConvertHistory: convertServerOf([waiting, convertRecordOf({ recordId: 'done' })]),
    });

    const result = await world.walk(deps);

    expect(result.imported).toBe(2);
    expect(world.fake.marksOf('convert').pending).toContainEqual({
      start: CONVERT_CREATED_AT - 1,
      end: CONVERT_CREATED_AT + 1,
      kind: 'point',
    });
    expect(CURSOR(world)).toBe(NOW);
    expect(stopCodes()).toContain('convert-not-settled');
  });

  it('owes the point of an unreadable record with a time, and goes past it', async () => {
    const world = recentWorld();
    const deps = world.depsOf({
      fetchConvertHistory: jest.fn(async () =>
        convertPageOf([], { unreadable: [{ time: CONVERT_CREATED_AT }] }),
      ),
    });

    await world.walk(deps);

    expect(world.fake.marksOf('convert').pending).toContainEqual({
      start: CONVERT_CREATED_AT - 1,
      end: CONVERT_CREATED_AT + 1,
      kind: 'point',
    });
    expect(CURSOR(world)).toBe(NOW);
  });

  it('holds the walk at the window of an unreadable record with no time', async () => {
    const world = recentWorld();
    const deps = world.depsOf({
      fetchConvertHistory: jest.fn(async () =>
        convertPageOf([], { unreadable: [{ time: undefined }] }),
      ),
    });

    const result = await world.walk(deps);

    expect(result.complete).toBe(false);
    expect(CURSOR(world)).toBe(NOW - HOUR_MS);
    expect(stopCodes()).toContain('convert-row-unreadable');
  });

  it('writes no multi-coin marks, as it reads every coin from the floor', async () => {
    const world = worldOf();
    const deps = world.depsOf();

    await world.walk(deps);

    expect(world.fake.writes().length).toBeGreaterThan(0);
    expect(
      world.fake
        .writes()
        .filter(({ field }) => field === 'multiCoinSeen' || field === 'multiCoinSince'),
    ).toEqual([]);
  });
});

describe('a Convert page with more data', () => {
  it('reads the first half of the span instead, then the span after it, twice as wide', async () => {
    const { depsOf, walk } = recentWorld();
    const fetchConvertHistory = jest
      .fn()
      .mockResolvedValueOnce(convertPageOf([], { moreData: true }))
      .mockResolvedValue(convertPageOf());
    const deps = depsOf({ fetchConvertHistory });

    await walk(deps);

    const [whole, half, after] = queriesOf(deps);
    expect(half).toEqual({
      startTime: whole.startTime,
      endTime: whole.startTime + Math.floor((whole.endTime - whole.startTime) / 2),
    });
    expect(after.startTime).toBe(half.endTime);
    expect(after.endTime).toBe(
      Math.min(whole.endTime, half.endTime + 2 * (half.endTime - half.startTime)),
    );
  });

  it('owes the span and holds the walk when one millisecond still has more data', async () => {
    const world = recentWorld();
    // Only the forward window is dense; the re-scan window behind it answers empty.
    const deps = world.depsOf({
      fetchConvertHistory: jest.fn(
        async (_apiKey: string, _secret: string, query: { startTime: number }) =>
          convertPageOf([], { moreData: query.startTime >= NOW - HOUR_MS }),
      ),
    });

    const result = await world.walk(deps, wideRun());
    const forward = queriesOf(deps).filter(({ startTime }) => startTime >= NOW - HOUR_MS);

    expect(result.complete).toBe(false);
    expect(forward.at(-1)).toEqual({
      startTime: NOW - HOUR_MS,
      endTime: NOW - HOUR_MS + 1,
    });
    expect(CURSOR(world)).toBe(NOW - HOUR_MS);
    expect(stopCodes()).toEqual(['convert-page-stuck']);
  });
});

describe('a start Binance refuses', () => {
  const DEPTH = HISTORY_FLOOR_MS + 10 * DAY_MS;

  it('is narrowed to the start Binance serves, imports above it, and owes nothing below', async () => {
    const world = worldOf();
    const above = convertRecordOf({ recordId: 'above', createTime: DEPTH + 5 * DAY_MS });
    const below = convertRecordOf({ recordId: 'below', createTime: DEPTH - 5 * DAY_MS });
    const server = convertServerOf([above, below], DEPTH);
    const deps = world.depsOf({ fetchConvertHistory: server });

    const result = await world.walk(deps, wideRun());

    expect(result.imported).toBe(2);
    expect(addedRows(deps).map(({ externalId }) => externalId)).toEqual([
      `${world.accountId}:convert:above:UAH:funding`,
      `${world.accountId}:convert:above:USDT:funding`,
    ]);
    expect(world.fake.marksOf('convert').pending ?? []).toEqual([]);
    expect(world.fake.notImported()).toEqual([]);
    expect(numberMarkWritesOfAnyWalk(deps)[0]).toBe(HISTORY_FLOOR_MS + CONVERT_WINDOW_MS);
  });

  it('drops the whole owed range it narrowed, as the ground below the served start is not kept', async () => {
    const world = worldOf();
    world.fake.seed('convert', {
      cursor: NOW - HOUR_MS,
      pending: [{ start: HISTORY_FLOOR_MS, end: HISTORY_FLOOR_MS + CONVERT_WINDOW_MS }],
    });
    const deps = world.depsOf({ fetchConvertHistory: convertServerOf([], DEPTH) });

    await world.walk(deps, wideRun());

    const owed = (world.fake.marksOf('convert').pending as { start: number }[] | undefined) ?? [];
    expect(owed.filter(({ start }) => start < NOW - 2 * DAY_MS)).toEqual([]);
  });

  it('goes on to the windows after the narrowed one, each read from its own start', async () => {
    const { depsOf, walk } = worldOf();
    const deps = depsOf({ fetchConvertHistory: convertServerOf([], DEPTH) });

    await walk(deps, wideRun());

    // The refused read, the read from the start Binance serves, then the 19 windows after it.
    const reads = queriesOf(deps).filter(({ startTime, endTime }) => endTime - startTime > 1);
    expect(reads.slice(2).map(({ startTime }) => startTime)).toEqual(
      Array.from(
        { length: 19 },
        (_unused, index) => HISTORY_FLOOR_MS + (index + 1) * CONVERT_WINDOW_MS,
      ),
    );
  });

  it('finishes the narrowing of a window holding the depth under the lane budget and goes on', async () => {
    const world = worldOf();
    const deps = world.depsOf({ fetchConvertHistory: convertServerOf([], DEPTH) });

    await world.walk(deps, freshRun());

    expect(numberMarkWritesOfAnyWalk(deps)[0]).toBe(HISTORY_FLOOR_MS + CONVERT_WINDOW_MS);
    expect(queriesOf(deps).map(({ startTime }) => startTime)).toContain(
      HISTORY_FLOOR_MS + CONVERT_WINDOW_MS,
    );
  });

  it('records every request on the lane, the refused read of a span too', async () => {
    const run = freshRun();
    const record = jest.spyOn(run.budget, 'record');
    const world = worldOf();
    const deps = world.depsOf({ fetchConvertHistory: convertServerOf([], DEPTH) });

    await world.walk(deps, run);

    expect(queriesOf(deps).length).toBeGreaterThan(24);
    expect(record).toHaveBeenCalledTimes(queriesOf(deps).length);
  });
});

describe('a failure of the Convert walk', () => {
  it('keeps the window and the cursor on a refusal other than a depth, and reads it again', async () => {
    const world = recentWorld();
    const failing = world.depsOf({
      fetchConvertHistory: jest.fn(async () => {
        throw new Error('Binance request failed: 400: -1127');
      }),
    });

    await expect(world.walk(failing)).rejects.toThrow('-1127');

    const next = world.depsOf({ fetchConvertHistory: convertServerOf([convertRecordOf()]) });
    const result = await world.walk(next);

    expect(CURSOR(world)).toBe(NOW);
    expect(queriesOf(next)[0].startTime).toBe(NOW - HOUR_MS);
    expect(result.imported).toBe(2);
  });

  it('keeps the window and the cursor when a page carries no moreData flag', async () => {
    const world = recentWorld();
    const failing = world.depsOf({
      fetchConvertHistory: jest.fn(async () => {
        throw new BinanceHistoryParseError();
      }),
    });

    await expect(world.walk(failing)).rejects.toBeInstanceOf(BinanceHistoryParseError);

    expect(CURSOR(world)).toBe(NOW - HOUR_MS);
    expect(numberMarkWritesOfAnyWalk(failing)).toEqual([]);
  });

  it('does not set a cooldown on a failure that is not a rate limit', async () => {
    const world = worldOf();
    const deps = world.depsOf({
      fetchConvertHistory: jest.fn(async () => {
        throw new Error('Binance request failed: 403');
      }),
    });

    await expect(world.walk(deps, wideRun())).rejects.toThrow('403');
    expect(isBinanceCoolingDown(world.accountId, NOW)).toBe(false);
  });
});

describe('when the Convert walk reads nothing', () => {
  it('makes no request while the account is cooling down', async () => {
    const { accountId, depsOf, walk } = worldOf();
    setBinanceCooldownUntil(accountId, NOW + 60_000);
    const deps = depsOf();

    const result = await walk(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.fetchConvertHistory).not.toHaveBeenCalled();
  });

  it('makes no request without credentials and reports complete', async () => {
    const { depsOf, walk } = worldOf();
    const deps = depsOf({ readCredentials: async () => undefined });

    const result = await walk(deps);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(deps.fetchConvertHistory).not.toHaveBeenCalled();
  });

  it('sets the cooldown and stops on a rate limit, keeping the cursor of what it committed', async () => {
    const world = worldOf();
    let calls = 0;
    const deps = world.depsOf({
      fetchConvertHistory: jest.fn(async () => {
        calls += 1;

        if (calls === 3) {
          throw new BinanceRateLimitError(429, 30_000);
        }

        return convertPageOf();
      }),
    });

    const result = await world.walk(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(CURSOR(world)).toBe(HISTORY_FLOOR_MS + 2 * CONVERT_WINDOW_MS);
    expect(isBinanceCoolingDown(world.accountId, NOW + 29_000)).toBe(true);
    expect(isBinanceCoolingDown(world.accountId, NOW + 30_000)).toBe(false);
  });
});
