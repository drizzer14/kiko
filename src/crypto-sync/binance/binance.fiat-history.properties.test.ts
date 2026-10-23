import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import {
  type BinanceFiatOrder,
  BinanceHistoryParseError,
  type FiatTransactionType,
} from './binance.history-client';
import { NOW } from './binance.pay-test-fixtures';
import { HISTORY_FLOOR_MS } from './binance.transactions';
import { BinanceHistoryTooOldError } from './binance.client';
import { createBinanceHistoryRun } from './binance.history-budget';
import { FIAT_WINDOW_MS, syncBinanceFiatOrderHistory } from './binance.fiat-history';
import { fiatOrderOf, fiatPageOf, fiatServerOf } from './binance.fiat-test-fixtures';

/**
 * The fiat orders walk (a lane of three calls, so a run reads forward or behind) driven over
 * generated worlds through `syncBinanceFiatOrderHistory` itself, in several runs. The clock of the
 * runs stands still, moves on by a millisecond, an hour or a day a run, or is set back to before
 * the walk's cursor. A world holds records Binance writes late (older than the walk's cursor and
 * the overlap day), a new record on some runs, and, in some worlds, owed ground anywhere between
 * the history floor and the cursor, inside the 2-year re-scan window too, that no read clears (a
 * page that drifts, a page that throws) or that Binance refuses as older than it serves. What must
 * be imported is decided by the records the generator made, never read back from the walk.
 */

const HOUR_MS = 3_600_000;

/** Runs enough for the longest bound (three failing days in the window: 28) and a record after. */
const RUNS = 60;
const SEEDS = Array.from({ length: 12 }, (_unused, position) => 5 + position * 7);
const ACCOUNT_ID = 'acc-fiat-orders-properties';
const FIRST_RUN_AT = NOW;

/** The cursor the walk starts with: an hour behind the first run. */
const START_CURSOR = FIRST_RUN_AT - HOUR_MS;

/** The run the clock is set back at, in the worlds that set it back. */
const SET_BACK_RUN = 4;

type RunClock = {
  label: string;
  /** The clock of a run. */
  at: (run: number) => number;
  /** A new record is written this far behind the clock of the run that first serves it, at most. */
  reachMs: number;
};

const steadyClock = (gapMs: number, reachMs: number): RunClock => ({
  label: `${gapMs} ms apart`,
  at: (run) => FIRST_RUN_AT + run * gapMs,
  reachMs,
});

/** Runs a gap apart whose clock is set back by `backMs` at `SET_BACK_RUN`, to before the cursor. */
const setBackClock = (gapMs: number, backMs: number): RunClock => ({
  label: `${gapMs} ms apart, set back ${backMs} ms`,
  at: (run) => FIRST_RUN_AT + run * gapMs - (run >= SET_BACK_RUN ? backMs : 0),
  reachMs: gapMs,
});

/** The clock moves between two runs by nothing, a millisecond, an hour or a day, or is set back. */
const CLOCKS: RunClock[] = [
  steadyClock(0, HOUR_MS),
  steadyClock(1, 1),
  steadyClock(HOUR_MS, HOUR_MS),
  steadyClock(DAY_MS, DAY_MS),
  setBackClock(HOUR_MS, 5 * HOUR_MS),
  setBackClock(DAY_MS, 5 * DAY_MS),
];

/** The runs between two reads of the re-scan: forward, owed, forward, re-scan. */
const RESCAN_EVERY_RUNS = 4;

/**
 * A run reads forward or behind, and the run after a behind run reads forward. While owed ground is
 * left the behind runs alternate the owed windows and the re-scan, so the runs go forward, owed,
 * forward, re-scan: the re-scan, which one record is waiting for, is read on every fourth run, one
 * read (two of the lane's three calls) a turn.
 *
 * With no owed day in the 2-year window a pass is one read, and a record served just after it waits
 * for the next pass: the fourth run counting the one it is served in. Each owed day in the window
 * that fails is found by a failing read, which marks it, and the pass then reads around it, in
 * a piece before it and a piece after it: the first pass of a window with `z` such days takes
 * `2z + 1` reads (a record in its last piece waits for all of them), and a pass after it `z + 1`.
 * So a record served from run `v` is imported by the `4 * (2z + 1)`th run it is within the reach of
 * the clock from `v` on (a run whose clock is before the record cannot read it).
 */
const importRunsOf = (zonesInWindow: number): number => RESCAN_EVERY_RUNS * (2 * zonesInWindow + 1);

/** Late records are written between 2 days and this many days behind the run that serves them. */
const LATE_BACK_DAYS = 600;

/** Binance serves history this far back; the tooOld worlds refuse a read that starts earlier. */
const SERVED_BACK_MS = 1_000 * DAY_MS;

type Stuck = 'none' | 'drift' | 'throw' | 'tooOld';

type Place = 'anywhere' | 'in the window';

type World = { stuck: Stuck; place: Place };

/** Owed ground anywhere behind the cursor, and, for the two failing kinds, in the last 500 days. */
const WORLDS: World[] = [
  { stuck: 'none', place: 'anywhere' },
  { stuck: 'drift', place: 'anywhere' },
  { stuck: 'drift', place: 'in the window' },
  { stuck: 'throw', place: 'anywhere' },
  { stuck: 'throw', place: 'in the window' },
  { stuck: 'tooOld', place: 'anywhere' },
];

/** The last owed days of the in-window worlds sit this far behind the walk's cursor, at most. */
const IN_WINDOW_MS = 500 * DAY_MS;

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

const servedWorldOf = (random: () => number, clock: RunClock): Served[] => {
  const served: Served[] = [];
  const add = (orderNo: string, createTime: number, servedFromRun: number): void => {
    served.push({
      servedFromRun,
      type: served.length % 2 === 0 ? '0' : '1',
      record: fiatOrderOf({ orderNo, createTime }),
    });
  };

  for (let run = 0; run < RUNS; run += 1) {
    const reachMs = run === 0 ? Math.min(clock.reachMs, HOUR_MS) : clock.reachMs;

    for (let count = Math.floor(random() * 3); count > 0; count -= 1) {
      add(`new-${served.length}`, clock.at(run) - Math.floor(random() * reachMs), run);
    }
  }

  // The first late record is served from the first run, so the first pass over the window, which
  // takes the most reads when a day in it fails, is one a record waits for.
  const lateCount = 2 + Math.floor(random() * 5);

  for (let index = 0; index < lateCount; index += 1) {
    const servedFromRun = index === 0 ? 0 : Math.floor(random() * RUNS);
    const backDays = 2 + Math.floor(random() * LATE_BACK_DAYS);

    add(`late-${served.length}`, clock.at(servedFromRun) - backDays * DAY_MS, servedFromRun);
  }

  return served;
};

/** One to three owed days, each placed by the world: anywhere from the floor to the cursor. */
const owedRangesOf = (random: () => number, world: World): Span[] => {
  const earliest = world.place === 'in the window' ? START_CURSOR - IN_WINDOW_MS : HISTORY_FLOOR_MS;

  return world.stuck === 'none'
    ? []
    : Array.from({ length: 1 + Math.floor(random() * 3) }, () => {
        const start = earliest + Math.floor(random() * (START_CURSOR - DAY_MS - earliest));

        return { start, end: start + DAY_MS };
      });
};

/** The owed days whose ground the re-scan reads, as far back as any run of the clock reads. */
const zonesInWindowOf = (owed: Span[], clock: RunClock): number => {
  const earliestRead =
    Math.min(...Array.from({ length: RUNS }, (_unused, run) => clock.at(run))) - FIAT_WINDOW_MS;

  return owed.filter((range) => range.end >= earliestRead).length;
};

describe.each(CLOCKS)('the fiat orders walk over generated worlds, runs $label', (clock) => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe.each(WORLDS)('with $stuck owed ground placed $place', (world) => {
    const { stuck } = world;

    it.each(SEEDS)(
      'imports every record Binance serves within the bound, each once: seed %i',
      async (seed) => {
        const random = seededRandom(seed);
        const served = servedWorldOf(random, clock);
        const owed = owedRangesOf(random, world);
        const importRuns = importRunsOf(zonesInWindowOf(owed, clock));
        const fake = walkStateFake({ accountId: ACCOUNT_ID, alongside: HOLDINGS });
        const offers: Offer[] = [];
        let run = 0;

        fake.seed('fiatOrders', { cursor: START_CURSOR, pending: owed });

        const fetchFiatOrders = async (
          apiKey: string,
          secret: string,
          type: FiatTransactionType,
          span: Span,
          page: number,
        ) => {
          const runNow = clock.at(run);
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
          const runNow = clock.at(run);

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
        // A server that fails every read touching an owed day serves no record inside it.
        const isReadable = ({ record }: Served): boolean =>
          stuck === 'tooOld' ||
          !owed.some((range) => record.createTime >= range.start && record.createTime <= range.end);
        const dueRunOf = ({ record, servedFromRun }: Served): number | undefined =>
          Array.from({ length: RUNS - servedFromRun }, (_unused, offset) => servedFromRun + offset)
            .filter((reachable) => record.createTime <= clock.at(reachable))
            .at(importRuns - 1);
        const missing = served
          .filter(isReadable)
          .flatMap(
            (item) =>
              foldMap(maybe(dueRunOf(item)), (dueRun) => [
                {
                  orderNo: item.record.orderNo,
                  servedFromRun: item.servedFromRun,
                  dueRun,
                  importedAtRun: importedAtRun(item.record.orderNo),
                },
              ]) ?? [],
          )
          .filter(({ dueRun, importedAtRun: at }) => at === undefined || at > dueRun);
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
