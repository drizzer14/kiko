import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import { NOW } from './binance.pay-test-fixtures';
import { syncBinanceDustHistory } from './binance.dust-history';
import { createBinanceHistoryRun } from './binance.history-budget';
import type { BinanceDustEntry, BinanceDustRecord } from './binance.history-client';
import { dustEntryOf, dustPageOf, dustRecordOf } from './binance.dust-test-fixtures';

/**
 * The dust read driven over random record sets through `syncBinanceDustHistory` itself, in
 * several runs a clock gap apart. Records arrive between the runs and Binance shows only the
 * newest 100 of those that have, so the window slides. The expected rows are decided by the kind
 * each entry is made from, never read back from the read.
 */

const HOUR_MS = 3_600_000;
const RUN_GAPS = [0, HOUR_MS, DAY_MS];
const RUNS = 5;
const SEEDS = Array.from({ length: 25 }, (_unused, position) => 5 + position * 8);
const ACCOUNT_ID = 'acc-dust-properties';
const FIRST_RUN_AT = NOW;
const HISTORY_DAYS = 25;
const WINDOW = 100;
const BNB_DIGITS = 7;
const COIN_DIGITS = 4;
const TRACKED = ['TRX', 'DOGE'];
const COINS = [...TRACKED, 'PEPE', 'SHIB'];

type Kind = 'ok' | 'badSource' | 'zeroSource' | 'badReceived' | 'belowScaleReceived';

/** A kind twice in the list is drawn twice as often. */
const KINDS: Kind[] = [
  'ok',
  'ok',
  'ok',
  'badSource',
  'zeroSource',
  'badReceived',
  'belowScaleReceived',
];

type MadeEntry = { coin: string; kind: Kind; sourceUnits: number; receivedUnits: number };

/** A record as the generator made it, with the run from which Binance shows it. */
type Made = { record: BinanceDustRecord; entries: MadeEntry[]; arrivesAtRun: number };

type ExpectedLeg = { key: string; bnbUnits: number | undefined };

/** A seeded generator (Lehmer), so a failing run replays. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed;

  return () => {
    state = (state * 48_271) % 2_147_483_647;

    return state / 2_147_483_647;
  };
};

const holdingWith = (id: string, key: string): HoldingRow =>
  ({ id, metadata: { binanceAsset: key } }) as unknown as HoldingRow;

const HOLDINGS = [...TRACKED, 'BNB'].map((coin) => holdingWith(`h-${coin}`, coin));

const pick = <Item>(random: () => number, items: readonly Item[]): Item =>
  items[Math.floor(random() * items.length)] as Item;

const textOf = (units: number, digits: number): string => (units / 10 ** digits).toFixed(digits);

const sourceTextOf = ({ kind, sourceUnits }: MadeEntry): string => {
  if (kind === 'badSource') {
    return 'abc';
  }

  return textOf(kind === 'zeroSource' ? 0 : sourceUnits, COIN_DIGITS);
};

const receivedTextOf = ({ kind, receivedUnits }: MadeEntry): string => {
  if (kind === 'badReceived') {
    return 'abc';
  }

  return kind === 'belowScaleReceived' ? '0.00000004' : textOf(receivedUnits, BNB_DIGITS);
};

const entryOf = (entry: MadeEntry): BinanceDustEntry =>
  dustEntryOf({
    fromAsset: entry.coin,
    amount: sourceTextOf(entry),
    transferedAmount: receivedTextOf(entry),
  });

const madeOf = (random: () => number, index: number, gapMs: number): Made => {
  const arrivesAtRun = Math.floor(random() * RUNS);
  const coins = COINS.filter(() => random() < 0.5);
  const entries = (coins.length > 0 ? coins : [pick(random, COINS)]).map(
    (coin): MadeEntry => ({
      coin,
      kind: pick(random, KINDS),
      sourceUnits: 1 + Math.floor(random() * 500),
      receivedUnits: 1 + Math.floor(random() * 1_000_000),
    }),
  );

  return {
    arrivesAtRun,
    entries,
    record: dustRecordOf({
      transId: `rec-${index}`,
      operateTime:
        FIRST_RUN_AT -
        HISTORY_DAYS * DAY_MS +
        Math.floor(random() * (HISTORY_DAYS * DAY_MS + arrivesAtRun * gapMs)),
      entries: entries.map(entryOf),
    }),
  };
};

const legsOf = ({ record }: Made, { coin, kind, receivedUnits }: MadeEntry): ExpectedLeg[] => {
  const pairId = `${ACCOUNT_ID}:dust:${record.transId}:${coin}`;
  const bnbLeg = { key: `${pairId}:BNB`, bnbUnits: receivedUnits };

  if (kind === 'badReceived' || kind === 'belowScaleReceived') {
    return [];
  }

  // An untracked coin's amount is never read, so only the received amount decides its BNB leg.
  if (!TRACKED.includes(coin)) {
    return [bnbLeg];
  }

  return kind === 'ok' ? [{ key: `${pairId}:${coin}`, bnbUnits: undefined }, bnbLeg] : [];
};

const importableOf = (made: Made): ExpectedLeg[] =>
  made.entries.flatMap((entry) => legsOf(made, entry));

describe.each(RUN_GAPS)('the dust read over random records, runs %i ms apart', (gapMs) => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it.each(SEEDS)(
    'imports each importable entry once, none that is refused, and the BNB legs sum exactly: seed %i',
    async (seed) => {
      const random = seededRandom(seed);
      const made = Array.from({ length: 20 + Math.floor(random() * 140) }, (_unused, index) =>
        madeOf(random, index, gapMs),
      );
      const fake = walkStateFake({ accountId: ACCOUNT_ID, alongside: HOLDINGS });
      const stored = new Map<string, { amountMinorUnits: number }>();
      const served = new Set<Made>();
      let imported = 0;
      let run = 0;
      let runNow = FIRST_RUN_AT;

      const fetchDustHistory = async () => {
        const shown = made
          .filter(({ arrivesAtRun }) => arrivesAtRun <= run)
          .sort((first, second) => second.record.operateTime - first.record.operateTime)
          .slice(0, WINDOW);

        for (const item of shown) {
          served.add(item);
        }

        return dustPageOf(
          shown.map(({ record }) => record),
          { unreadable: random() < 0.3 ? [{ time: undefined }] : [] },
        );
      };

      for (run = 0; run < RUNS; run += 1) {
        runNow = FIRST_RUN_AT + run * gapMs;
        const result = await syncBinanceDustHistory(
          {
            targetAccountId: ACCOUNT_ID,
            run: createBinanceHistoryRun({ now: () => runNow, sleep: async () => undefined }),
          },
          {
            now: () => runNow,
            readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
            fetchDustHistory,
            ensureHoldings: async () => undefined,
            addTransactions: async (rows) => {
              const added = rows.filter(({ externalId }) => !stored.has(externalId));

              for (const row of added) {
                stored.set(row.externalId, row);
              }

              return added.length;
            },
            ...fake.freshDeps(),
            listHoldings: fake.listHoldings,
          },
        );
        imported += result.imported;
      }

      const expected = [...served].flatMap(importableOf);
      expect([...stored.keys()].sort()).toEqual(expected.map(({ key }) => key).sort());
      expect(imported).toBe(expected.length);
      expect(
        [...stored.entries()]
          .filter(([key]) => key.endsWith(':BNB'))
          .reduce((sum, [, row]) => sum + row.amountMinorUnits, 0),
      ).toBe(expected.reduce((sum, { bnbUnits }) => sum + (bnbUnits ?? 0), 0));
    },
  );
});
