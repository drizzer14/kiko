import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import { NOW } from './binance.pay-test-fixtures';
import { createBinanceHistoryRun } from './binance.history-budget';
import { syncBinanceConvertHistory } from './binance.convert-history';
import { convertPageOf, convertRecordOf } from './binance.convert-test-fixtures';
import type { BinanceConvertRecord, ConvertHistoryPage } from './binance.history-client';

/**
 * The Convert walk driven over random sets of conversions through `syncBinanceConvertHistory`
 * itself, in several runs a clock gap apart. Records are made after the first run, and some wait
 * on Binance (`PROCESS`) until a later run settles them. The expected rows, entries and tickers
 * are decided by the category a record is made from, never read back from the walk.
 */

const HOUR_MS = 3_600_000;
const RUN_GAPS = [0, HOUR_MS, DAY_MS];
const RUNS = 5;
const SEEDS = Array.from({ length: 25 }, (_unused, position) => 3 + position * 8);
const ACCOUNT_ID = 'acc-convert-properties';
const FIRST_RUN_AT = NOW;
const HISTORY_DAYS = 25;

type Category =
  | 'fundingPair'
  | 'spotPair'
  | 'lone'
  | 'bothUntracked'
  | 'refusedWallet'
  | 'refusedStatus'
  | 'failed';

/** A category twice in the list is drawn twice as often. */
const CATEGORIES: Category[] = [
  'fundingPair',
  'fundingPair',
  'spotPair',
  'lone',
  'bothUntracked',
  'refusedWallet',
  'refusedStatus',
  'failed',
];

/** A conversion as the generator made it, with the run that settles it when it waits. */
type Made = { category: Category; record: BinanceConvertRecord; settlesAtRun: number | undefined };

type Expected = { keys: string[]; entries: string[]; untracked: string[] };

/** A seeded generator (Lehmer), so a failing run replays. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed;

  return () => {
    state = (state * 48_271) % 2_147_483_647;

    return state / 2_147_483_647;
  };
};

const holdingWith = (id: string, metadata: Record<string, unknown>): HoldingRow =>
  ({ id, metadata }) as unknown as HoldingRow;

const HOLDINGS = ['UAH:funding', 'USDT:funding', 'UAH', 'USDT'].map((key) =>
  holdingWith(`h-${key}`, { binanceAsset: key }),
);

const pick = <Item>(random: () => number, items: readonly Item[]): Item =>
  items[Math.floor(random() * items.length)];

const SHAPES: Record<Category, Partial<BinanceConvertRecord>> = {
  fundingPair: { fromAsset: 'UAH', toAsset: 'USDT', walletType: 'FUNDING' },
  spotPair: { fromAsset: 'USDT', toAsset: 'UAH', walletType: 'SPOT' },
  lone: { fromAsset: 'USDT', toAsset: 'PEPE', walletType: 'FUNDING' },
  bothUntracked: { fromAsset: 'PEPE', toAsset: 'SHIB', walletType: 'FUNDING' },
  refusedWallet: { walletType: 'MAIN' },
  refusedStatus: { orderStatus: 'EXPIRED' },
  failed: { orderStatus: 'FAIL', walletType: 'MAIN' },
};

const madeOf = (random: () => number, index: number, gapMs: number): Made => {
  const category = pick(random, CATEGORIES);
  const span = HISTORY_DAYS * DAY_MS + (RUNS - 1) * gapMs;
  const waits = category !== 'refusedStatus' && category !== 'failed' && random() < 0.3;

  return {
    category,
    settlesAtRun: waits ? 1 + Math.floor(random() * 2) : undefined,
    record: convertRecordOf({
      recordId: `rec-${index}`,
      createTime: FIRST_RUN_AT - HISTORY_DAYS * DAY_MS + Math.floor(random() * span),
      ...SHAPES[category],
    }),
  };
};

const legKey = (record: BinanceConvertRecord, asset: string): string =>
  `${ACCOUNT_ID}:convert:${record.recordId}:${asset}${record.walletType === 'FUNDING' ? ':funding' : ''}`;

const NOTHING: Expected = { keys: [], entries: [], untracked: [] };

const pairOf = (record: BinanceConvertRecord): Expected => ({
  ...NOTHING,
  keys: [legKey(record, 'UAH'), legKey(record, 'USDT')],
});

const refusalOf = (record: BinanceConvertRecord): Expected => ({
  ...NOTHING,
  entries: [`convert-unrecognized:${record.recordId}:${record.createTime}`],
});

const EXPECTED: Record<Category, (record: BinanceConvertRecord) => Expected> = {
  fundingPair: pairOf,
  spotPair: pairOf,
  lone: (record) => ({ ...NOTHING, keys: [legKey(record, 'USDT')], untracked: ['PEPE'] }),
  bothUntracked: () => ({ ...NOTHING, untracked: ['PEPE', 'SHIB'] }),
  refusedWallet: refusalOf,
  refusedStatus: refusalOf,
  failed: () => NOTHING,
};

/** The record as Binance shows it at run `run`: still waiting before the run that settles it. */
const shownAt = ({ record, settlesAtRun }: Made, run: number): BinanceConvertRecord =>
  settlesAtRun !== undefined && run < settlesAtRun ? { ...record, orderStatus: 'PROCESS' } : record;

describe.each(RUN_GAPS)('the Convert walk over random conversions, runs %i ms apart', (gapMs) => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it.each(SEEDS)(
    'imports each once, lists each refusal once, and ends current: seed %i',
    async (seed) => {
      const random = seededRandom(seed);
      const made = Array.from({ length: 12 + Math.floor(random() * 20) }, (_unused, index) =>
        madeOf(random, index, gapMs),
      );
      const fake = walkStateFake({ accountId: ACCOUNT_ID, alongside: HOLDINGS });
      const stored = new Map<string, unknown>();
      let run = 0;
      let runNow = FIRST_RUN_AT;

      const fetchConvertHistory = async (
        _apiKey: string,
        _secret: string,
        query: { startTime: number; endTime: number },
      ): Promise<ConvertHistoryPage> =>
        convertPageOf(
          made
            .map((item) => shownAt(item, run))
            .filter(
              ({ createTime }) =>
                createTime >= query.startTime &&
                createTime <= query.endTime &&
                createTime <= runNow,
            ),
        );

      fake.seed('convert', { cursor: FIRST_RUN_AT - 28 * DAY_MS });

      let last = { imported: 0, complete: false };

      for (run = 0; run < RUNS; run += 1) {
        runNow = FIRST_RUN_AT + run * gapMs;
        last = await syncBinanceConvertHistory(
          {
            targetAccountId: ACCOUNT_ID,
            run: createBinanceHistoryRun({ now: () => runNow, sleep: async () => undefined }),
          },
          {
            now: () => runNow,
            readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
            fetchConvertHistory,
            ensureHoldings: async () => undefined,
            addTransactions: async (rows) => {
              for (const row of rows) {
                stored.set(row.externalId, row);
              }

              return rows.length;
            },
            ...fake.freshDeps(),
            listHoldings: fake.listHoldings,
          },
        );
      }

      const expected = made.map(({ category, record }) => EXPECTED[category](record));
      expect([...stored.keys()].sort()).toEqual(expected.flatMap(({ keys }) => keys).sort());
      expect([...fake.notImported()].sort()).toEqual(
        expected.flatMap(({ entries }) => entries).sort(),
      );
      expect(last.complete).toBe(true);
      expect(fake.marksOf('convert').cursor).toBe(runNow);
      expect(
        ((fake.marksOf('convert').pending as { kind?: string }[] | undefined) ?? []).filter(
          ({ kind }) => kind === 'point',
        ),
      ).toEqual([]);
    },
  );
});
