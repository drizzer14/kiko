import { match } from 'ts-pattern';
import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import type { ExchangeHolding } from '@kiko/holdings/repo';

import type {
  EarnRecordByKind,
  EarnRecordKind,
  TotalPage,
  TotalQuery,
} from './binance.history-client';
import { NOW } from './binance.pay-test-fixtures';
import { BinanceWalkStop } from './binance.history-walk';
import { createBinanceHistoryRun } from './binance.history-budget';
import type { BinanceHistoryRow } from './binance.transfer-history';
import { EARN_KEY, FUNDING_KEY, SPOT_KEY } from './binance.holding-keys';
import { type BinanceEarnHistoryDeps, syncBinanceEarnHistory } from './binance.earn-history';

export const agoMs = (days: number): number => NOW - days * DAY_MS;

/** A flexible subscription of 0.001 BTC from Spot, settled, two days before `NOW`. */
export const flexibleSubscriptionOf = (
  over: Partial<EarnRecordByKind['flexibleSubscription']> = {},
): EarnRecordByKind['flexibleSubscription'] => ({
  amount: '0.001',
  asset: 'BTC',
  time: agoMs(2),
  purchaseId: 'p-1',
  productId: 'BTC001',
  type: 'NORMAL',
  sourceAccount: undefined,
  amtFromSpot: '0.001',
  amtFromFunding: '0',
  status: 'SUCCESS',
  ...over,
});

export const lockedSubscriptionOf = (
  over: Partial<EarnRecordByKind['lockedSubscription']> = {},
): EarnRecordByKind['lockedSubscription'] => ({
  positionId: 'pos-1',
  purchaseId: 'p-1',
  time: agoMs(2),
  asset: 'BTC',
  amount: '0.001',
  type: 'NORMAL',
  sourceAccount: undefined,
  amtFromSpot: '0.001',
  amtFromFunding: '0',
  status: 'SUCCESS',
  ...over,
});

/** A flexible redemption of 0.001 BTC to Spot, settled (Binance spells a settled one PAID). */
export const flexibleRedemptionOf = (
  over: Partial<EarnRecordByKind['flexibleRedemption']> = {},
): EarnRecordByKind['flexibleRedemption'] => ({
  amount: '0.001',
  asset: 'BTC',
  time: agoMs(2),
  projectId: 'BTC001',
  redeemId: 'r-1',
  destAccount: 'SPOT',
  status: 'PAID',
  ...over,
});

/** A locked redemption at maturity (principal back to Spot), settled and complete. */
export const lockedRedemptionOf = (
  over: Partial<EarnRecordByKind['lockedRedemption']> = {},
): EarnRecordByKind['lockedRedemption'] => ({
  positionId: 'pos-1',
  redeemId: 'r-1',
  time: agoMs(2),
  asset: 'BTC',
  amount: '0.001',
  originalAmount: '0.001',
  type: 'MATURE',
  status: 'PAID',
  isComplete: true,
  ...over,
});

/** A flexible `REALTIME` reward of 0.00000012 BTC. */
export const flexibleRewardOf = (
  over: Partial<EarnRecordByKind['flexibleRewards']> = {},
): EarnRecordByKind['flexibleRewards'] => ({
  asset: 'BTC',
  rewards: '0.00000012',
  projectId: 'BTC001',
  type: 'REALTIME',
  time: agoMs(2),
  ...over,
});

export const lockedRewardOf = (
  over: Partial<EarnRecordByKind['lockedRewards']> = {},
): EarnRecordByKind['lockedRewards'] => ({
  positionId: 'pos-1',
  time: agoMs(2),
  asset: 'BTC',
  amount: '0.00000012',
  type: 'Booster',
  ...over,
});

/** The code of the `BinanceWalkStop` `attempt` throws, if it throws one. */
export const stopCodeOf = (attempt: () => unknown): string | undefined => {
  try {
    attempt();
  } catch (error) {
    return error instanceof BinanceWalkStop ? error.code : undefined;
  }

  return undefined;
};

export const SPOT_FIELDS = {
  cursor: 'binanceEarnHistoryCursor',
  rescan: 'binanceEarnRescanCursor',
  pending: 'binanceEarnPendingOverlap',
  point: 'binanceEarnPointCursor',
  range: 'binanceEarnRangeCursor',
  hints: 'binanceEarnSpanHints',
} as const;

/** What Binance holds: a row (or one the client could not read) and the kind it is read under. */
type EarnEntry =
  | { kind: EarnRecordKind; time: number; row: EarnRecordByKind[EarnRecordKind] }
  | { kind: EarnRecordKind; time: number | undefined; unreadable: true };

export const entryOf = <Kind extends EarnRecordKind>(
  kind: Kind,
  row: EarnRecordByKind[Kind],
): EarnEntry => ({ kind, time: row.time, row });

export const unreadableEntryOf = (kind: EarnRecordKind, time: number | undefined): EarnEntry => ({
  kind,
  time,
  unreadable: true,
});

const PAGE_SIZE = 100;

export const pageOf = (over: Partial<TotalPage<EarnRecordByKind[EarnRecordKind]>> = {}) => ({
  rows: [],
  unreadable: [],
  gathered: 0,
  total: 0,
  usedUidWeight1m: undefined,
  usedIpWeight1m: undefined,
  ...over,
});

type Precision = 'millisecond' | 'second';

type EarnRead = TotalQuery & { kind: EarnRecordKind };

type Answer = (query: EarnRead) => TotalPage<EarnRecordByKind[EarnRecordKind]> | undefined;

/** A page the server shows full, with more rows behind it, so the walk halves the span. */
export const fullPage = (): TotalPage<EarnRecordByKind[EarnRecordKind]> =>
  pageOf({ gathered: PAGE_SIZE, total: PAGE_SIZE + 50 });

const SECOND_MS = 1_000;

/**
 * Whether a read of `query` returns a record at `time`: each end compared to the millisecond or,
 * as the live Earn endpoints do, to the second the end falls in.
 */
const reaches = (query: TotalQuery, time: number, precision: Precision): boolean =>
  match(precision)
    .with('second', () => {
      const floorOf = (millisecond: number): number =>
        Math.floor(millisecond / SECOND_MS) * SECOND_MS;

      return floorOf(query.startTime) <= time && time <= floorOf(query.endTime);
    })
    .with('millisecond', () => query.startTime <= time && time <= query.endTime)
    .exhaustive();

/**
 * Binance's answer for one kind, one range (both ends included) and one page of 100. `answer` may
 * replace the page of a read (a full page that makes the walk halve the span, a drift).
 */
const serverOf = (entries: EarnEntry[], answer?: Answer, precision: Precision = 'millisecond') =>
  jest.fn(
    async (
      _apiKey: string,
      _secret: string,
      kind: EarnRecordKind,
      query: TotalQuery,
    ): Promise<TotalPage<EarnRecordByKind[EarnRecordKind]>> => {
      const replaced = answer?.({ ...query, kind });

      if (replaced !== undefined) {
        return replaced;
      }

      const inRange = entries.filter(
        (entry) =>
          entry.kind === kind &&
          (entry.time === undefined || reaches(query, entry.time, precision)),
      );
      const page = inRange.slice((query.current - 1) * PAGE_SIZE, query.current * PAGE_SIZE);

      return pageOf({
        rows: page.flatMap((entry) => ('row' in entry ? [entry.row] : [])),
        unreadable: page.flatMap((entry) => ('unreadable' in entry ? [{ time: entry.time }] : [])),
        gathered: page.length,
        total: inRange.length,
      });
    },
  );

const holdingWith = (id: string, metadata: Record<string, unknown>): HoldingRow =>
  ({ id, metadata }) as unknown as HoldingRow;

type World = {
  metadata: Record<string, unknown>;
  others: HoldingRow[];
  added: BinanceHistoryRow[];
  events: string[];
};

/**
 * The Spot holding of a connected account, which carries the walk's marks, and what the repos
 * hold: the other holdings, the rows written, and the writes in order.
 */
export const worldOf = (
  metadata: Record<string, unknown> = {},
  others: HoldingRow[] = [
    holdingWith('h-funding', { binanceAsset: FUNDING_KEY }),
    holdingWith('h-earn', { binanceAsset: EARN_KEY }),
  ],
): World => ({
  metadata: { binanceAsset: SPOT_KEY, ...metadata },
  others,
  added: [],
  events: [],
});

const depsOf = (
  world: World,
  server: ReturnType<typeof serverOf>,
  over: Partial<BinanceEarnHistoryDeps> = {},
): BinanceEarnHistoryDeps => ({
  now: () => NOW,
  fetchImpl: (async () => ({})) as unknown as typeof fetch,
  readCredentials: async () => ({ apiKey: 'test-key', secret: 'secret' }),
  listHoldings: async () => [holdingWith('h-spot', world.metadata), ...world.others],
  fetchEarnRecords: server as unknown as BinanceEarnHistoryDeps['fetchEarnRecords'],
  ensureHoldings: jest.fn(async (created: Omit<ExchangeHolding, 'renameFromDefault'>[]) => {
    for (const holding of created) {
      world.events.push(`ensure:${holding.metadataKey}`);
      world.others.push(
        holdingWith(`created-${holding.metadataKey}`, { binanceAsset: holding.metadataKey }),
      );
    }
  }),
  addTransactions: jest.fn(async (rows: BinanceHistoryRow[]) => {
    world.events.push('rows');
    world.added.push(...rows);

    return rows.length;
  }),
  writeWalkCursor: jest.fn(async (_holdingId: string, field: string, cursorMs: number) => {
    world.events.push(`cursor:${field}`);
    world.metadata = { ...world.metadata, [field]: cursorMs };
  }),
  writeWalkPending: jest.fn(async (_holdingId: string, field: string, ranges: unknown[]) => {
    world.events.push('list');
    world.metadata = { ...world.metadata, [field]: ranges };
  }),
  writeWalkHints: jest.fn(async (_holdingId: string, field: string, hints: unknown) => {
    world.metadata = { ...world.metadata, [field]: hints };
  }),
  ...over,
});

export const freshRun = () =>
  createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined });

const requestsOf = (deps: BinanceEarnHistoryDeps): EarnRead[] =>
  (deps.fetchEarnRecords as unknown as jest.Mock).mock.calls.map((call) => ({
    ...(call[3] as TotalQuery),
    kind: call[2] as EarnRecordKind,
  }));

/** One run of the walk on `world`, with Binance answering from `entries`. */
export const walkOnce = async (input: {
  world: World;
  entries?: EarnEntry[];
  answer?: Answer;
  precision?: Precision;
  accountId?: string;
  run?: ReturnType<typeof freshRun>;
  now?: number;
  over?: Partial<BinanceEarnHistoryDeps>;
}) => {
  const { world, entries = [], answer, accountId = 'acc-1', run = freshRun() } = input;
  const deps = depsOf(world, serverOf(entries, answer, input.precision), {
    ...foldMap(maybe(input.now), (nowMs) => ({ now: () => nowMs })),
    ...input.over,
  });
  const result = await syncBinanceEarnHistory({ targetAccountId: accountId, run }, deps);

  return { result, deps, requests: requestsOf(deps), accountId };
};

export const listOf = (world: World): unknown[] =>
  (world.metadata[SPOT_FIELDS.pending] as unknown[] | undefined) ?? [];

export const pointsIn = (list: unknown[]): unknown[] =>
  list.filter((ground) => (ground as { kind?: string }).kind === 'point');

export const pointOf = (time: number, series: EarnRecordKind, reach = 1) => ({
  start: time - reach,
  end: time + reach,
  kind: 'point',
  series,
});

const STOP_TAG = '[binance sync] history window stopped';

export const stopCodes = (spy: jest.SpyInstance): string[] =>
  spy.mock.calls
    .filter((call) => call[0] === STOP_TAG)
    .map((call) => (call[1] as { code: string }).code);

/** The ids of the rows written, once each, in order. */
export const idsOf = (world: World): string[] => [
  ...new Set(world.added.map((row) => row.externalId)),
];
