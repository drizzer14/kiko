import {
  coinListPatchesOf,
  numberMarkWritesOfAnyWalk,
  walkMarkWritesOf,
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
import { HISTORY_FLOOR_MS } from './binance.transactions';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { BinanceHistoryTooOldError, BinanceRateLimitError } from './binance.client';
import { type BinanceConvertRecord, BinanceHistoryParseError } from './binance.history-client';
import { type BinanceRunBudget, COSTS, createBinanceHistoryRun } from './binance.history-budget';

const ACCOUNT = 'acc-1';
const PAIR = `${ACCOUNT}:convert:quote-1`;
const UAH_OUT = -100_000;
const REFUSED = {
  kind: 'refused',
  entry: `convert-unrecognized:quote-1:${CONVERT_CREATED_AT}`,
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
      rows: [{ externalId: 'acc-2:convert:quote-1:UAH:funding' }, {}],
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
  ])('refuses a settled conversion with %s into one entry, and owes nothing', (_name, over) => {
    expect(outcomeOf(over)).toEqual(REFUSED);
  });

  it('reads the status and the wallet before a blank coin', () => {
    expect(codeOf({ orderStatus: 'PROCESS', fromAsset: '' })).toBe('convert-not-settled');
    expect(outcomeOf({ walletType: 'MAIN', fromAsset: '' })).toEqual(REFUSED);
    expect(outcomeOf({ orderStatus: 'FAIL', fromAsset: '' })).toEqual({ kind: 'none' });
  });

  it('refuses a blank coin before it reads any amount, and owes the amount of a tracked pair', () => {
    expect(outcomeOf({ fromAsset: '', toAmount: undefined })).toEqual(REFUSED);
    expect(outcomeOf({ fromAsset: '', fromAmount: undefined })).toEqual(REFUSED);
    expect(codeOf({ toAmount: undefined })).toBe('convert-row-unreadable');
    expect(codeOf({ fromAmount: '0' })).toBe('convert-amount-invalid');
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
    const pairId = `${accountId}:convert:quote-1`;

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
      `convert-unrecognized:quote-1:${CONVERT_CREATED_AT}`,
    ]);
    expect(coinListPatchesOf(deps)).toEqual([]);
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
      `convert-unrecognized:quote-1:${CONVERT_CREATED_AT}`,
    ]);
  });

  it('writes a conversion with a blank coin as one entry, goes past it, and owes nothing', async () => {
    const world = recentWorld();
    const server = convertServerOf([convertRecordOf({ toAsset: '' })]);

    const first = world.depsOf({ fetchConvertHistory: server });
    await world.walk(first);

    expect(first.addTransactions).not.toHaveBeenCalled();
    expect(world.fake.notImported()).toEqual([
      `convert-unrecognized:quote-1:${CONVERT_CREATED_AT}`,
    ]);
    expect(CURSOR(world)).toBe(NOW);
    expect(world.fake.marksOf('convert').pending ?? []).toEqual([]);

    await world.walk(world.depsOf({ fetchConvertHistory: server }));

    expect(world.fake.notImported()).toEqual([
      `convert-unrecognized:quote-1:${CONVERT_CREATED_AT}`,
    ]);
    expect(world.fake.marksOf('convert').pending ?? []).toEqual([]);
    expect(stopCodes()).toEqual([]);
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
      expect(coinListPatchesOf(deps)).toEqual([]);
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
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(stopCodes()).toEqual(['convert-page-stuck']);
  });

  it('owes the span of the re-scan, with no row, when one millisecond of it still has more data', async () => {
    const world = recentWorld();
    const stuckAt = NOW - HOUR_MS - 5 * 60_000;
    const deps = world.depsOf({
      fetchConvertHistory: jest.fn(
        async (_apiKey: string, _secret: string, query: { startTime: number; endTime: number }) =>
          convertPageOf([], {
            moreData: query.startTime <= stuckAt && stuckAt <= query.endTime,
          }),
      ),
    });

    const result = await world.walk(deps, wideRun());

    expect(result.complete).toBe(false);
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(world.fake.marksOf('convert').pending).toEqual([
      { start: stuckAt - 1, end: stuckAt + 1 },
    ]);
    expect(CURSOR(world)).toBe(NOW);
    expect(stopCodes()).toEqual(['convert-page-stuck', 'convert-page-stuck']);
  });

  it('leaves a point window that ran out of calls after a stuck millisecond a resume that owes it', async () => {
    const world = recentWorld();
    const stuckAt = NOW - 2 * CONVERT_WINDOW_MS;
    world.fake.seed('convert', {
      pending: [{ start: stuckAt - 1, end: stuckAt + 1, kind: 'point' }],
    });
    let exhausted = false;
    const deps = world.depsOf({
      fetchConvertHistory: jest.fn(
        async (_apiKey: string, _secret: string, query: { startTime: number; endTime: number }) => {
          const dense = query.startTime <= stuckAt && stuckAt <= query.endTime;

          exhausted = exhausted || (dense && query.endTime - query.startTime === 1);

          return convertPageOf([], { moreData: dense });
        },
      ),
    });

    const result = await world.walk(deps, spiedRun(() => !exhausted).run);

    expect(result.complete).toBe(false);
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(world.fake.marksOf('convert').spanHints).toMatchObject({
      point: [
        {
          start: stuckAt - 1,
          end: stuckAt + 1,
          resume: { from: stuckAt, returned: [], stuck: [{ start: stuckAt - 1, end: stuckAt }] },
        },
      ],
    });
  });
});

describe('a start Binance refuses', () => {
  it('rejects the walk, moves no mark and writes no row when a window is answered -5026', async () => {
    const world = worldOf();
    const deps = world.depsOf({
      fetchConvertHistory: jest.fn(async () => {
        throw new BinanceHistoryTooOldError('Binance request failed: 400');
      }),
    });

    await expect(world.walk(deps)).rejects.toBeInstanceOf(BinanceHistoryTooOldError);

    expect(numberMarkWritesOfAnyWalk(deps)).toEqual([]);
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(CURSOR(world)).toBeUndefined();
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

  it('reads nothing while the account is cooling down, not even its credentials or its marks', async () => {
    const { accountId, depsOf, walk } = worldOf();
    setBinanceCooldownUntil(accountId, NOW + 60_000);
    const readCredentials = jest.fn(async () => ({ apiKey: 'api-key', secret: 'secret' }));
    const deps = depsOf({ readCredentials });

    await walk(deps);

    expect(readCredentials).not.toHaveBeenCalled();
    expect(deps.readExchangeState).not.toHaveBeenCalled();
    expect(deps.patchExchangeState).not.toHaveBeenCalled();
  });

  it('reads nothing and reports unfinished when the clock stands at the history floor', async () => {
    const { depsOf, walk } = worldOf();
    const deps = depsOf({ now: () => HISTORY_FLOOR_MS });

    const result = await walk(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.fetchConvertHistory).not.toHaveBeenCalled();
  });

  it('takes the time from the wall clock when no clock is given', async () => {
    const world = recentWorld();
    const { now: _givenClock, ...deps } = world.depsOf();
    const wallClock = jest.spyOn(Date, 'now').mockReturnValue(NOW);

    try {
      await world.walk(deps as BinanceConvertHistoryDeps);
    } finally {
      wallClock.mockRestore();
    }

    expect(CURSOR(world)).toBe(NOW);
    expect(queriesOf(deps as BinanceConvertHistoryDeps).map(({ endTime }) => endTime)).toContain(
      NOW,
    );
  });
});

type BudgetSpy = {
  canAfford: jest.Mock<boolean, Parameters<BinanceRunBudget['canAfford']>>;
  record: jest.Mock<void, Parameters<BinanceRunBudget['record']>>;
};

/** A run whose budget affords a call while `affords` says so, and keeps every ask and record. */
const spiedRun = (affords: (recorded: number) => boolean = () => true) => {
  let recorded = 0;
  const spy: BudgetSpy = {
    canAfford: jest.fn<boolean, Parameters<BinanceRunBudget['canAfford']>>(() => affords(recorded)),
    record: jest.fn<void, Parameters<BinanceRunBudget['record']>>(() => {
      recorded += 1;
    }),
  };

  return {
    spy,
    run: createExchangeRun({
      intervalMs: 0,
      clock: { now: () => NOW, sleep: async () => undefined },
      budget: spy,
    }),
  };
};

describe('the Convert walk and its budget', () => {
  it('asks for, and records, every call on the convert lane at the convert cost', async () => {
    const world = recentWorld();
    const page = convertPageOf([convertRecordOf()]);
    const { spy, run } = spiedRun();

    await world.walk(world.depsOf({ fetchConvertHistory: jest.fn(async () => page) }), run);

    expect(spy.canAfford.mock.calls.length).toBeGreaterThan(0);
    expect(spy.canAfford.mock.calls.map(([lane, cost]) => [lane, cost])).toEqual(
      spy.canAfford.mock.calls.map(() => ['convert', COSTS.convert]),
    );
    expect(spy.record.mock.calls.length).toBeGreaterThan(0);
    expect(spy.record.mock.calls).toEqual(spy.record.mock.calls.map(() => ['convert', page]));
  });

  it('reads no further span once the budget cannot afford one, and reports the walk unfinished', async () => {
    const world = recentWorld();
    const fetchConvertHistory = jest
      .fn()
      .mockResolvedValueOnce(convertPageOf([], { moreData: true }))
      .mockResolvedValue(convertPageOf());
    const deps = world.depsOf({ fetchConvertHistory });

    const result = await world.walk(deps, spiedRun((recorded) => recorded < 1).run);

    expect(queriesOf(deps)).toHaveLength(1);
    expect(result.complete).toBe(false);
  });

  it('reads no other window once Binance has rate limited it, though the budget has calls left', async () => {
    const world = recentWorld();
    const deps = world.depsOf({
      fetchConvertHistory: jest.fn(async () => {
        throw new BinanceRateLimitError(429, 30_000);
      }),
    });

    const result = await world.walk(deps, spiedRun().run);

    expect(queriesOf(deps)).toHaveLength(1);
    expect(result.complete).toBe(false);
    expect(isBinanceCoolingDown(world.accountId, NOW + 1_000)).toBe(true);
  });
});

describe('what the Convert walk writes to the lists and marks', () => {
  it('lists the coin of an amount past the safe integer as oversized, and owes the point', async () => {
    const world = recentWorld();
    const deps = world.depsOf({
      fetchConvertHistory: convertServerOf([convertRecordOf({ toAmount: '90071992.54740992' })]),
    });

    await world.walk(deps);

    expect(coinListPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'oversizedCoins', list: 'history', tickers: ['USDT'] },
    ]);
    expect(deps.addTransactions).not.toHaveBeenCalled();
  });

  it('owes the point of a conversion whose holding cannot be resolved, naming that stop', async () => {
    const world = recentWorld();
    const deps = world.depsOf({
      listHoldings: async () => [],
      fetchConvertHistory: convertServerOf([convertRecordOf()]),
    });

    await world.walk(deps);

    expect(stopCodes()).toEqual(['convert-holding-missing']);
    expect(deps.addTransactions).not.toHaveBeenCalled();
  });

  it('owes all the ground before the cursor when the stored pending list is unreadable', async () => {
    const world = recentWorld();
    world.fake.seed('convert', { pending: 'unreadable' });
    const deps = world.depsOf();

    await world.walk(deps);

    expect(walkMarkWritesOf(deps, 'convert', 'pending')[0]).toEqual([
      { start: HISTORY_FLOOR_MS, end: NOW - HOUR_MS },
    ]);
    expect(stopCodes()).toContain('pending-malformed');
  });
});
