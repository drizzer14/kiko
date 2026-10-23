import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import {
  type BinanceFiatOrder,
  BinanceHistoryParseError,
  type FiatTransactionType,
} from './binance.history-client';
import { NOW } from './binance.pay-test-fixtures';
import { BinanceHistoryTooOldError } from './binance.client';
import { createBinanceHistoryRun } from './binance.history-budget';
import { syncBinanceFiatOrderHistory } from './binance.fiat-history';
import { fiatOrderOf, fiatPageOf, fiatServerOf } from './binance.fiat-test-fixtures';

/**
 * The fiat orders walk (a lane of three calls, so a run reads forward or behind) driven over
 * generated worlds through `syncBinanceFiatOrderHistory` itself, in several runs a clock gap apart.
 * A world holds records Binance writes late (older than the walk's cursor and the overlap day), a
 * new record on some runs, and, in some worlds, owed ground older than the re-scan that no read
 * clears (a page that drifts, a page that throws) or that Binance refuses as older than it
 * serves. What must be imported is decided by the records the generator made, never read back
 * from the walk.
 */

const HOUR_MS = 3_600_000;

/** The clock moves between two runs, by a millisecond at least. */
const RUN_GAPS = [1, HOUR_MS, DAY_MS];
const RUNS = 16;
const SEEDS = Array.from({ length: 12 }, (_unused, position) => 5 + position * 7);
const ACCOUNT_ID = 'acc-fiat-orders-properties';
const FIRST_RUN_AT = NOW;

/**
 * A record served from run `v` is imported by run `v + IMPORT_RUNS - 1`. A run reads forward or
 * behind, and the run after a behind run reads forward. While owed ground is left the behind runs
 * alternate the owed windows and the re-scan, so the runs go forward, owed, forward, re-scan: a
 * record served just after a re-scan waits for the next one, which is the fourth run counting the
 * one it is served in. The window a re-scan reads holds every late record the generator makes,
 * so none needs a second read.
 */
const IMPORT_RUNS = 4;

/** Late records are written between 2 days and this many days behind the run that serves them. */
const LATE_BACK_DAYS = 600;

/** Binance serves history this far back; the tooOld worlds refuse a read that starts earlier. */
const SERVED_BACK_MS = 1_000 * DAY_MS;

/** The owed ranges sit this far back, behind both the re-scan and the served depth. */
const OWED_DAYS_BACK = 1_500;

type Stuck = 'none' | 'drift' | 'throw' | 'tooOld';

const STUCK_KINDS: Stuck[] = ['none', 'drift', 'throw', 'tooOld'];

type Served = { record: BinanceFiatOrder; type: FiatTransactionType; servedFromRun: number };

type Span = { start: number; end: number };

type Offer = { run: number; externalId: string };

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

const HOLDINGS = [holdingWith('h-eur-spot', { binanceAsset: 'EUR' })];

const orderNoOf = (externalId: string): string | undefined => externalId.split(':')[2];

const servedWorldOf = (random: () => number, gapMs: number): Served[] => {
  const served: Served[] = [];
  const add = (orderNo: string, createTime: number, servedFromRun: number): void => {
    served.push({
      servedFromRun,
      type: served.length % 2 === 0 ? '0' : '1',
      record: fiatOrderOf({ orderNo, createTime }),
    });
  };

  for (let run = 0; run < RUNS; run += 1) {
    const reachMs = run === 0 ? Math.min(gapMs, HOUR_MS) : gapMs;

    for (let count = Math.floor(random() * 3); count > 0; count -= 1) {
      add(`new-${served.length}`, FIRST_RUN_AT + run * gapMs - Math.floor(random() * reachMs), run);
    }
  }

  for (let count = 2 + Math.floor(random() * 5); count > 0; count -= 1) {
    const servedFromRun = Math.floor(random() * (RUNS - IMPORT_RUNS + 1));
    const backDays = 2 + Math.floor(random() * LATE_BACK_DAYS);

    add(
      `late-${served.length}`,
      FIRST_RUN_AT + servedFromRun * gapMs - backDays * DAY_MS,
      servedFromRun,
    );
  }

  return served;
};

const owedRangesOf = (random: () => number, stuck: Stuck): Span[] =>
  stuck === 'none'
    ? []
    : Array.from({ length: 1 + Math.floor(random() * 3) }, (_unused, index) => {
        const start = FIRST_RUN_AT - (OWED_DAYS_BACK - 60 * index) * DAY_MS;

        return { start, end: start + DAY_MS };
      });

describe.each(RUN_GAPS)('the fiat orders walk over generated worlds, runs %i ms apart', (gapMs) => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe.each(STUCK_KINDS)('with owed ground older than the re-scan: %s', (stuck) => {
    it.each(SEEDS)(
      'imports every record Binance serves within the bound, each once: seed %i',
      async (seed) => {
        const random = seededRandom(seed);
        const served = servedWorldOf(random, gapMs);
        const owed = owedRangesOf(random, stuck);
        const fake = walkStateFake({ accountId: ACCOUNT_ID, alongside: HOLDINGS });
        const offers: Offer[] = [];
        let run = 0;

        fake.seed('fiatOrders', { cursor: FIRST_RUN_AT - HOUR_MS, pending: owed });

        const fetchFiatOrders = async (
          apiKey: string,
          secret: string,
          type: FiatTransactionType,
          span: Span,
          page: number,
        ) => {
          const runNow = FIRST_RUN_AT + run * gapMs;
          const servedNow = served.filter(
            (item) => item.servedFromRun <= run && item.record.createTime <= runNow,
          );
          const touchesOwed = owed.some(
            (range) => span.start <= range.end && span.end >= range.start,
          );

          if (stuck === 'drift' && touchesOwed) {
            return fiatPageOf<BinanceFiatOrder>([], { total: 5 });
          }

          if (stuck === 'throw' && touchesOwed) {
            throw new BinanceHistoryParseError();
          }

          if (stuck === 'tooOld' && span.start < runNow - SERVED_BACK_MS) {
            throw new BinanceHistoryTooOldError('Binance request failed: 400: too old');
          }

          const recordsOf = (wanted: FiatTransactionType): BinanceFiatOrder[] =>
            servedNow.filter((item) => item.type === wanted).map(({ record }) => record);

          return fiatServerOf({ '0': recordsOf('0'), '1': recordsOf('1') }, 500)(
            apiKey,
            secret,
            type,
            span,
            page,
          );
        };

        for (run = 0; run < RUNS; run += 1) {
          const runNow = FIRST_RUN_AT + run * gapMs;

          await syncBinanceFiatOrderHistory(
            {
              targetAccountId: ACCOUNT_ID,
              run: createBinanceHistoryRun({ now: () => runNow, sleep: async () => undefined }),
            },
            {
              now: () => runNow,
              fetchImpl: (async () => ({})) as unknown as typeof fetch,
              readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
              fetchFiatOrders,
              ensureHoldings: async () => undefined,
              addTransactions: async (rows) => {
                offers.push(...rows.map(({ externalId }) => ({ run, externalId })));

                return rows.length;
              },
              ...fake.freshDeps(),
              listHoldings: fake.listHoldings,
            },
          ).catch((error: unknown) => {
            if (!(error instanceof BinanceHistoryParseError)) {
              throw error;
            }
          });
        }

        const importedAtRun = (orderNo: string): number | undefined =>
          offers.find(({ externalId }) => orderNoOf(externalId) === orderNo)?.run;
        const missing = served
          .filter(({ servedFromRun }) => servedFromRun + IMPORT_RUNS <= RUNS)
          .map(({ record, servedFromRun }) => ({
            orderNo: record.orderNo,
            servedFromRun,
            importedAtRun: importedAtRun(record.orderNo),
          }))
          .filter(
            ({ servedFromRun, importedAtRun: at }) =>
              at === undefined || at >= servedFromRun + IMPORT_RUNS,
          );
        const keysOfOrder = new Map<string, Set<string>>();

        for (const { externalId } of offers) {
          const orderNo = orderNoOf(externalId) ?? '';

          keysOfOrder.set(orderNo, new Set([...(keysOfOrder.get(orderNo) ?? []), externalId]));
        }

        expect(missing).toEqual([]);
        expect(
          [...keysOfOrder].filter(
            ([orderNo, keys]) =>
              keys.size !== 1 || !served.some(({ record }) => record.orderNo === orderNo),
          ),
        ).toEqual([]);
      },
    );
  });
});
