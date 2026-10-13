import { match } from 'ts-pattern';
import { DAY_MS } from '@kiko/dates';
import {
  BINANCE_EARN_HISTORY_CURSOR_FIELD,
  BINANCE_EARN_PENDING_OVERLAP_FIELD,
  BINANCE_EARN_POINT_CURSOR_FIELD,
  BINANCE_EARN_RANGE_CURSOR_FIELD,
  BINANCE_EARN_RESCAN_CURSOR_FIELD,
  BINANCE_EARN_SPAN_HINTS_FIELD,
  binanceWalkCursorOf,
} from '@kiko/holdings/holding-metadata';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { transactionsRepo } from '@kiko/transactions/repo';
import { type ExchangeHolding, holdingsRepo } from '@kiko/holdings/repo';

import {
  advanceWalkMarks,
  BinanceWalkStop,
  btcSatoshis,
  dropReadPoints,
  type OwedWindow,
  planWalkPasses,
  readPendingMark,
  readWalkRoundRobins,
  resolveWalletHoldings,
  roundRobinHooksOf,
  runWalkPlan,
  type SpanCommit,
  type SpanRead,
  type WalkMarkFields,
  type WalkMarks,
  walkSpans,
  type WalkPass,
  type WalkPlan,
  type WalkResult,
  walkWritersOf,
  type WalkWindow,
} from './binance.history-walk';
import {
  type BinanceWalletKey,
  binanceKeyOf,
  EARN_KEY,
  FUNDING_KEY,
  SPOT_KEY,
} from './binance.holding-keys';
import {
  type EarnRecordByKind,
  type EarnRecordKind,
  fetchEarnRecords,
  type TotalPage,
  type TotalQuery,
} from './binance.history-client';
import {
  commitSettledSpan,
  instantAt,
  joinSettled,
  type SettledSpan,
  settleRecords,
  settleUnreadable,
} from './binance.history-records';
import type { FetchAccountOptions } from './binance.client';
import type { BinanceHistoryRow } from './binance.transfer-history';
import { type BinanceHistoryRun, COSTS } from './binance.history-budget';
import { readSeriesSpan, type SeriesSpan } from './binance.history-paging';
import { HISTORY_FLOOR_MS, RESYNC_OVERLAP_MS } from './binance.transactions';
import { type BinanceCredentials, readCredentials } from './binance.credentials';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { type BinanceWalkWriteDeps, defaultWalkWriteDeps } from './binance.walk-write-deps';

/** The widest range an Earn history read takes is 30 days. */
export const EARN_WINDOW_MS = 30 * DAY_MS;

/** Simple Earn launched after this day, so nothing earlier is read. */
export const EARN_FLOOR_MS = Date.UTC(2022, 0, 1);

/** Safety stop on the window walk. */
const MAX_WINDOWS = 12;

/** Safety stop on paging one kind within a span of one millisecond (100 rows x 50 pages). */
const MAX_PAGES_PER_SPAN = 50;

/** The status Binance gives a subscription or redemption that went through. */
export const EARN_SETTLED_STATUS = 'SUCCESS';

/** The statuses of a record that did not go through and never will: nothing is owed for it. */
export const EARN_FAILED_STATUSES: readonly string[] = ['FAILED'];

/**
 * The six record kinds a span is read in, the two reward kinds first: a reward is paid every
 * day or hour, so they are the likely dense kinds, and a span too full for one page is halved
 * before the other four are paid for.
 */
export const EARN_SERIES: readonly EarnRecordKind[] = [
  'flexibleRewards',
  'lockedRewards',
  'flexibleSubscription',
  'flexibleRedemption',
  'lockedSubscription',
  'lockedRedemption',
];

const EARN_NOT_SETTLED = 'earn-not-settled';

const EARN_SPLIT_MISMATCH = 'earn-split-mismatch';

const EARN_AMOUNT_INVALID = 'earn-amount-invalid';

const EARN_ID_MISSING = 'earn-id-missing';

const EARN_ACCOUNT_UNKNOWN = 'earn-account-unknown';

const EARN_REWARD_TYPE_UNKNOWN = 'earn-reward-type-unknown';

const EARN_PAGE_DRIFT = 'earn-page-drift';

/** The stop of a row the client could not read: logged by its code alone, never its content. */
const EARN_ROW_UNREADABLE = 'earn-row-unreadable';

/**
 * The stops of one record that the forward pass owes and goes past, as the Transfer walk does:
 * the record stays owed at its own point until it settles or the floor drops it, so no later
 * read of the span settles it differently, and holding the cursor behind it would keep every
 * newer record from importing. Only a record with a usable time owes a point
 * (`commitSettledSpan`): a row with no time owes the whole span, and a stop that is no one
 * record's (`earn-page-drift`, `earn-holding-missing`) is not in this list, so both hold the
 * cursor back. Emptying this list holds the cursor at any stuck record again.
 */
export const EARN_FORWARD_OWES: readonly string[] = [
  EARN_NOT_SETTLED,
  EARN_SPLIT_MISMATCH,
  EARN_AMOUNT_INVALID,
  EARN_ID_MISSING,
  EARN_ACCOUNT_UNKNOWN,
  EARN_REWARD_TYPE_UNKNOWN,
  EARN_ROW_UNREADABLE,
];

const EARN_MARK_FIELDS: WalkMarkFields = {
  cursor: BINANCE_EARN_HISTORY_CURSOR_FIELD,
  rescan: BINANCE_EARN_RESCAN_CURSOR_FIELD,
  point: BINANCE_EARN_POINT_CURSOR_FIELD,
  range: BINANCE_EARN_RANGE_CURSOR_FIELD,
  hints: BINANCE_EARN_SPAN_HINTS_FIELD,
  pending: BINANCE_EARN_PENDING_OVERLAP_FIELD,
};

/** The description of a reward: income, so no "Transfer to/from" label applies. */
const REWARD_DESCRIPTION = 'Binance Earn';

type EarnProduct = 'flexible' | 'locked';

/**
 * A row mapped from an Earn record, before its wallets are turned into holdings: `wallet` is the
 * one it sits on, `counterpartWallet` the other leg's of a move between two wallets.
 */
type PlannedEarnRow = {
  wallet: BinanceWalletKey;
  counterpartWallet?: BinanceWalletKey;
  amountMinorUnits: number;
  time: number;
  externalId: string;
  exchangePairId?: string;
  description: string;
};

/** The satoshis of an amount that must be above zero. */
const positiveSatoshis = (amount: string): number => {
  const satoshis = btcSatoshis(amount);

  if (satoshis === null || satoshis <= 0) {
    throw new BinanceWalkStop(EARN_AMOUNT_INVALID);
  }

  return satoshis;
};

/** The satoshis of one of the two split fields of a subscription: zero when it is left out. */
const splitSatoshis = (amount: string | undefined): number => {
  if (amount === undefined) {
    return 0;
  }

  const satoshis = btcSatoshis(amount);

  if (satoshis === null || satoshis < 0) {
    throw new BinanceWalkStop(EARN_AMOUNT_INVALID);
  }

  return satoshis;
};

/**
 * Whether a subscription or redemption went through: a failed one is ignored (nothing is owed
 * for it), any status that is neither settled nor failed is not settled yet and is a stop.
 */
const isSettled = (status: string): boolean => {
  if (EARN_FAILED_STATUSES.includes(status)) {
    return false;
  }

  if (status !== EARN_SETTLED_STATUS) {
    throw new BinanceWalkStop(EARN_NOT_SETTLED);
  }

  return true;
};

/** The wallet an account name of Binance stands for, among the two Kiko tracks. */
const walletOfAccount = (account: string | undefined): BinanceWalletKey =>
  match(account)
    .returnType<BinanceWalletKey>()
    .with('SPOT', () => SPOT_KEY)
    .with('FUNDING', () => FUNDING_KEY)
    .otherwise(() => {
      throw new BinanceWalkStop(EARN_ACCOUNT_UNKNOWN);
    });

type SubscriptionRecord =
  | EarnRecordByKind['flexibleSubscription']
  | EarnRecordByKind['lockedSubscription'];

type RedemptionRecord =
  | EarnRecordByKind['flexibleRedemption']
  | EarnRecordByKind['lockedRedemption'];

type Debit = { wallet: BinanceWalletKey; satoshis: number };

/**
 * Where a subscription's money came from: the two split fields when either is given (left out
 * reads as zero, and their sum must be the amount), else the one account it names.
 */
const debitsOf = (record: SubscriptionRecord, satoshis: number): Debit[] => {
  if (record.amtFromSpot === undefined && record.amtFromFunding === undefined) {
    return [{ wallet: walletOfAccount(record.sourceAccount), satoshis }];
  }

  const debits: Debit[] = [
    { wallet: SPOT_KEY, satoshis: splitSatoshis(record.amtFromSpot) },
    { wallet: FUNDING_KEY, satoshis: splitSatoshis(record.amtFromFunding) },
  ];

  if (debits[0].satoshis + debits[1].satoshis !== satoshis) {
    throw new BinanceWalkStop(EARN_SPLIT_MISMATCH);
  }

  return debits.filter((debit) => debit.satoshis > 0);
};

/** One leg of a move between two wallets, under the pair id both legs share. */
const legOf = (input: {
  pairId: string;
  time: number;
  wallet: BinanceWalletKey;
  counterpart: BinanceWalletKey;
  signedSatoshis: number;
}): PlannedEarnRow => ({
  wallet: input.wallet,
  counterpartWallet: input.counterpart,
  amountMinorUnits: input.signedSatoshis,
  time: input.time,
  externalId: `${input.pairId}:${input.wallet}`,
  exchangePairId: input.pairId,
  description: '',
});

/**
 * The rows of one subscription: a debit on Spot and Funding for what each paid, and the credit
 * on Earn, all under one pair id. A debit leg names Earn as the other wallet; the Earn leg names
 * the larger debit (Spot when they are equal). A failed subscription gives none; one the walk
 * cannot trust (not settled, no id, no positive amount, a split that is not the amount, an
 * account Kiko does not track) throws a `BinanceWalkStop`: a skipped one would be silent loss.
 */
export const subscriptionRowsOf = (
  accountId: string,
  product: EarnProduct,
  record: SubscriptionRecord,
): PlannedEarnRow[] => {
  if (!isSettled(record.status)) {
    return [];
  }

  if (record.purchaseId === '') {
    throw new BinanceWalkStop(EARN_ID_MISSING);
  }

  const satoshis = positiveSatoshis(record.amount);
  const debits = debitsOf(record, satoshis);
  const larger = debits.reduce((best, debit) => (debit.satoshis > best.satoshis ? debit : best));
  const pairId = `${accountId}:earn:sub:${product}:${record.purchaseId}`;
  const time = record.time;

  return [
    ...debits.map((debit) =>
      legOf({
        pairId,
        time,
        wallet: debit.wallet,
        counterpart: EARN_KEY,
        signedSatoshis: -debit.satoshis,
      }),
    ),
    legOf({ pairId, time, wallet: EARN_KEY, counterpart: larger.wallet, signedSatoshis: satoshis }),
  ];
};

/**
 * The rows of one redemption: Earn out, the destination in, under one pair id. A locked
 * redemption names no destination, and its principal returns to Spot; its reward is not here,
 * it comes from the rewards record.
 */
export const redemptionRowsOf = (
  accountId: string,
  product: EarnProduct,
  record: RedemptionRecord,
): PlannedEarnRow[] => {
  if (!isSettled(record.status)) {
    return [];
  }

  if (record.redeemId === '') {
    throw new BinanceWalkStop(EARN_ID_MISSING);
  }

  const satoshis = positiveSatoshis(record.amount);
  const destination = 'destAccount' in record ? walletOfAccount(record.destAccount) : SPOT_KEY;
  const pairId = `${accountId}:earn:redeem:${product}:${record.redeemId}`;
  const time = record.time;

  return [
    legOf({ pairId, time, wallet: EARN_KEY, counterpart: destination, signedSatoshis: -satoshis }),
    legOf({ pairId, time, wallet: destination, counterpart: EARN_KEY, signedSatoshis: satoshis }),
  ];
};

/** One reward record of either product, as the walk reads it. */
export type EarnReward = { ownerId: string; type: string; time: number; amount: string };

/**
 * The rewards that share a product, a project (or position), a type and a time. Binance gives
 * a reward no id, so the rows of a group are numbered within it, and the group is the unit the
 * walk trusts or does not: its members share one time, so a read that returns one returns all.
 */
type EarnRewardGroup = {
  product: EarnProduct;
  ownerId: string;
  type: string;
  time: number;
  records: EarnReward[];
};

export const rewardGroupsOf = (product: EarnProduct, records: EarnReward[]): EarnRewardGroup[] => {
  const groups = new Map<string, EarnRewardGroup>();

  for (const record of records) {
    const key = JSON.stringify([record.ownerId, record.type, record.time]);
    const group = groups.get(key);

    if (group === undefined) {
      groups.set(key, {
        product,
        ownerId: record.ownerId,
        type: record.type,
        time: record.time,
        records: [record],
      });
    } else {
      group.records.push(record);
    }
  }

  return [...groups.values()];
};

/**
 * The wallet a reward group is income on: a flexible `REALTIME` reward accrues in Earn, a
 * flexible `BONUS` reward and every locked reward go to Spot. Any other flexible type is a
 * stop: no wallet is guessed.
 */
const rewardWalletOf = (group: EarnRewardGroup): BinanceWalletKey =>
  match(group.product)
    .returnType<BinanceWalletKey>()
    .with('locked', () => SPOT_KEY)
    .with('flexible', () =>
      match(group.type)
        .returnType<BinanceWalletKey>()
        .with('REALTIME', () => EARN_KEY)
        .with('BONUS', () => SPOT_KEY)
        .otherwise(() => {
          throw new BinanceWalkStop(EARN_REWARD_TYPE_UNKNOWN);
        }),
    )
    .exhaustive();

/**
 * The rows of one reward group, numbered from 0 by their satoshis, ascending, so the same set of
 * rewards is keyed the same way in every read. One member that cannot be trusted stops the whole
 * group: a group numbered without it would be numbered two ways.
 */
export const rewardGroupRowsOf = (accountId: string, group: EarnRewardGroup): PlannedEarnRow[] => {
  if (group.ownerId === '') {
    throw new BinanceWalkStop(EARN_ID_MISSING);
  }

  const wallet = rewardWalletOf(group);
  const satoshis = group.records.map((record) => positiveSatoshis(record.amount));

  return satoshis
    .sort((left, right) => left - right)
    .map((amountMinorUnits, position) => ({
      wallet,
      amountMinorUnits,
      time: group.time,
      externalId: `${accountId}:earn:reward:${group.product}:${group.ownerId}:${group.type}:${group.time}:${position}`,
      description: REWARD_DESCRIPTION,
    }));
};

type TaggedEarnRecord<Kind extends EarnRecordKind> = {
  [Key in Kind]: { kind: Key; record: EarnRecordByKind[Key] };
}[Kind];

/** A record of any of the six kinds, with the kind it was read under. */
export type EarnRecord = TaggedEarnRecord<EarnRecordKind>;

const taggedPage = <Kind extends EarnRecordKind>(
  kind: Kind,
  page: TotalPage<EarnRecordByKind[Kind]>,
): TotalPage<TaggedEarnRecord<Kind>> => ({
  ...page,
  rows: page.rows.map((record) => ({ kind, record })),
});

/** What the walk trusts or does not as one: a subscription, a redemption or a reward group. */
type EarnUnit = { series: EarnRecordKind; time: number; rows: () => PlannedEarnRow[] };

const REWARD_SERIES: Record<EarnProduct, EarnRecordKind> = {
  flexible: 'flexibleRewards',
  locked: 'lockedRewards',
};

type ProductReward = { product: EarnProduct; reward: EarnReward };

const rewardOf = (entry: EarnRecord): ProductReward | undefined =>
  match(entry)
    .returnType<ProductReward | undefined>()
    .with({ kind: 'flexibleRewards' }, ({ record }) => ({
      product: 'flexible',
      reward: {
        ownerId: record.projectId,
        type: record.type,
        time: record.time,
        amount: record.rewards,
      },
    }))
    .with({ kind: 'lockedRewards' }, ({ record }) => ({
      product: 'locked',
      reward: {
        ownerId: record.positionId,
        type: record.type,
        time: record.time,
        amount: record.amount,
      },
    }))
    .otherwise(() => undefined);

const flowUnitsOf = (accountId: string, entries: EarnRecord[]): EarnUnit[] =>
  entries.flatMap((entry) =>
    match(entry)
      .returnType<EarnUnit[]>()
      .with({ kind: 'flexibleSubscription' }, ({ kind, record }) => [
        {
          series: kind,
          time: record.time,
          rows: () => subscriptionRowsOf(accountId, 'flexible', record),
        },
      ])
      .with({ kind: 'lockedSubscription' }, ({ kind, record }) => [
        {
          series: kind,
          time: record.time,
          rows: () => subscriptionRowsOf(accountId, 'locked', record),
        },
      ])
      .with({ kind: 'flexibleRedemption' }, ({ kind, record }) => [
        {
          series: kind,
          time: record.time,
          rows: () => redemptionRowsOf(accountId, 'flexible', record),
        },
      ])
      .with({ kind: 'lockedRedemption' }, ({ kind, record }) => [
        {
          series: kind,
          time: record.time,
          rows: () => redemptionRowsOf(accountId, 'locked', record),
        },
      ])
      .otherwise(() => []),
  );

/**
 * The reward groups of a span. A group at the time of a reward row the client could not read is
 * not trusted: the unreadable row may belong to it, and the group numbered without it would be
 * numbered two ways, so it stops with that row at the same point.
 */
const rewardUnitsOf = (
  accountId: string,
  entries: EarnRecord[],
  unreadableTimes: Map<EarnRecordKind, Set<number>>,
): EarnUnit[] => {
  const rewards = entries.flatMap(
    (entry) => foldMap(maybe(rewardOf(entry)), (found) => [found]) ?? [],
  );

  return (['flexible', 'locked'] as const).flatMap((product) =>
    rewardGroupsOf(
      product,
      rewards.filter((found) => found.product === product).map((found) => found.reward),
    ).map((group) => ({
      series: REWARD_SERIES[product],
      time: group.time,
      rows: () => {
        if (unreadableTimes.get(REWARD_SERIES[product])?.has(group.time)) {
          throw new BinanceWalkStop(EARN_ROW_UNREADABLE);
        }

        return rewardGroupRowsOf(accountId, group);
      },
    })),
  );
};

/** The times of the rows the client could not read, for each kind. */
const unreadableTimesOf = (
  read: SeriesSpan<EarnRecordKind, EarnRecord>,
): Map<EarnRecordKind, Set<number>> =>
  new Map(
    read.read.map(({ series, unreadable }) => [
      series,
      new Set(
        unreadable.flatMap((row) => foldMap(maybe(row.time), (time) => [Number(time)]) ?? []),
      ),
    ]),
  );

/**
 * The records of one span, each on its own (see `settleRecords`): a subscription, a redemption
 * or a reward group the walk cannot trust, or a row the client could not read, owes its own
 * point in the kind it was read under and the others still import. A kind whose pages drifted
 * is no one record's stop: the span is owed, as a range, in every kind, and the kinds that did
 * not drift still commit.
 */
export const settledEarnOf = (input: {
  accountId: string;
  span: WalkWindow;
  read: SeriesSpan<EarnRecordKind, EarnRecord>;
}): SettledSpan<PlannedEarnRow> => {
  const { accountId, span, read } = input;
  const entries = read.read.flatMap(({ rows }) => rows);
  const drift: SettledSpan<PlannedEarnRow> = {
    rows: [],
    codes: [EARN_PAGE_DRIFT],
    owed: [span],
    returned: [],
  };

  return joinSettled<PlannedEarnRow>([
    ...(read.drifted.length > 0 ? [drift] : []),
    settleRecords({
      span,
      records: [
        ...flowUnitsOf(accountId, entries),
        ...rewardUnitsOf(accountId, entries, unreadableTimesOf(read)),
      ],
      rowsOf: (unit) => unit.rows(),
      extentOf: (unit) => instantAt(unit.time),
      seriesOf: (unit) => unit.series,
    }),
    settleUnreadable({
      span,
      unreadable: read.read.flatMap(({ series, unreadable }) =>
        unreadable.map((row) => ({ ...row, series })),
      ),
      code: EARN_ROW_UNREADABLE,
      extentOf: (row) => foldMap(maybe(row.time), (time) => instantAt(Number(time))),
      seriesOf: (row) => row.series,
    }),
  ]);
};

/**
 * The injectable seams of the Earn walk: the credential and holding reads, the Earn read (one
 * page of one kind of one range), the insert-only holding creation, the deduping import, and
 * the mark writes. Pacing and the weight budget come from the run.
 */
export type BinanceEarnHistoryDeps = BinanceWalkWriteDeps & {
  now: () => number;
  fetchImpl: typeof fetch;
  readCredentials: (accountId: string) => Promise<BinanceCredentials | undefined>;
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  fetchEarnRecords: typeof fetchEarnRecords;
  ensureHoldings: (holdings: ExchangeHolding[]) => Promise<void>;
  addTransactions: (rows: BinanceHistoryRow[]) => Promise<number>;
};

const defaultEarnHistoryDeps: BinanceEarnHistoryDeps = {
  ...defaultWalkWriteDeps,
  now: () => Date.now(),
  fetchImpl: fetch,
  readCredentials,
  listHoldings: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  fetchEarnRecords,
  ensureHoldings: (holdings) => holdingsRepo.ensureExchangeHoldings(holdings),
  addTransactions: (rows) => transactionsRepo.addManyDedup(rows),
};

type EarnContext = {
  deps: BinanceEarnHistoryDeps;
  run: BinanceHistoryRun;
  accountId: string;
  spot: HoldingRow;
  apiKey: string;
  secret: string;
  options: FetchAccountOptions;
  marks: WalkMarks;
  plan: WalkPlan;
};

/** The kinds a window is read in: every one, or the ones its owed points name. */
const kindsOf = (window: OwedWindow): readonly EarnRecordKind[] =>
  window.series === undefined
    ? EARN_SERIES
    : EARN_SERIES.filter((kind) => window.series?.includes(kind));

/** The calls one read of a window costs: one for each kind it asks. */
const callsOf = (window: OwedWindow): number => kindsOf(window).length;

/**
 * One span read in every kind of `window`. A kind whose first page is full with more rows behind
 * it halves the span (every kind is read again in the half). `undefined` is a clean stop: the
 * budget cannot afford every kind, or Binance rate-limited (which also sets the account's
 * cooldown). `keep` calls stay unspent for the passes that come later in the run.
 */
const readSpan = (
  context: EarnContext,
  window: OwedWindow,
  span: WalkWindow,
  keep: number,
): Promise<SpanRead<SeriesSpan<EarnRecordKind, EarnRecord>> | undefined> => {
  const { deps, run, accountId, apiKey, secret, options } = context;

  return readSeriesSpan<EarnRecordKind, EarnRecord>({
    run,
    lane: 'earn',
    cost: COSTS.earn,
    span,
    keep,
    series: kindsOf(window),
    maxPages: MAX_PAGES_PER_SPAN,
    fetchPage: async (kind, read, current) =>
      taggedPage(
        kind,
        await deps.fetchEarnRecords(
          apiKey,
          secret,
          kind,
          { startTime: read.start, endTime: read.end, current } satisfies TotalQuery,
          options,
        ),
      ),
    onRateLimit: (error) => setBinanceCooldownUntil(accountId, deps.now() + error.retryAfterMs),
  });
};

const uniqueRowsOf = (planned: PlannedEarnRow[]): PlannedEarnRow[] => [
  ...new Map(planned.map((row) => [row.externalId, row])).values(),
];

/** Every wallet the rows sit on or name as their other leg. */
const walletsOf = (planned: PlannedEarnRow[]): BinanceWalletKey[] => [
  ...new Set(
    planned.flatMap((row) => [
      row.wallet,
      ...(foldMap(maybe(row.counterpartWallet), (key) => [key]) ?? []),
    ]),
  ),
];

/**
 * Turn the planned rows into importable ones, creating a missing wallet holding at zero first. A
 * wallet that cannot be resolved even after creation is no one record's stop: the span is owed.
 */
const placeRows = async (
  context: EarnContext,
  planned: PlannedEarnRow[],
): Promise<BinanceHistoryRow[]> => {
  if (planned.length === 0) {
    return [];
  }

  const { accountId, deps } = context;
  const holdings = await resolveWalletHoldings({
    accountId,
    keys: walletsOf(planned),
    listHoldings: deps.listHoldings,
    ensureHoldings: deps.ensureHoldings,
  });

  return planned.map(({ wallet, counterpartWallet, ...row }) => {
    const holding = holdings.get(wallet);
    const counterpart = foldMap(maybe(counterpartWallet), (key) => holdings.get(key));

    if (holding === undefined || (counterpartWallet !== undefined && counterpart === undefined)) {
      throw new BinanceWalkStop('earn-holding-missing');
    }

    return {
      ...row,
      holdingId: holding.id,
      source: 'binance',
      ...foldMap(maybe(counterpart), (found) => ({ exchangeCounterpartHoldingId: found.id })),
    };
  });
};

/**
 * Commit one span's read: place and write the rows of the records the walk can trust, then move
 * the walk's marks (see `commitSettledSpan`: rows first, marks second, so a crash between the two
 * just re-imports idempotently, and a record the walk cannot trust stays owed at its own point
 * or stops the forward pass). One row per key: a record on the boundary of two spans is read
 * twice.
 */
const commitSpan = (
  context: EarnContext,
  span: WalkWindow,
  read: SeriesSpan<EarnRecordKind, EarnRecord>,
  pass: WalkPass,
): Promise<SpanCommit | undefined> => {
  const { deps, accountId, spot, plan, marks } = context;

  return commitSettledSpan({
    pass,
    span,
    settled: settledEarnOf({ accountId, span, read }),
    forwardOwes: EARN_FORWARD_OWES,
    place: (planned) => placeRows(context, uniqueRowsOf(planned)),
    add: deps.addTransactions,
    advance: ({ owed }) =>
      advanceWalkMarks({
        pass,
        span,
        owed,
        plan,
        marks,
        restartMs: HISTORY_FLOOR_MS,
        fields: EARN_MARK_FIELDS,
        write: (field, cursorMs) => deps.writeWalkCursor(spot.id, field, cursorMs),
        writePending: (field, ranges) => deps.writeWalkPending(spot.id, field, ranges),
      }),
  });
};

const runSync = async (
  deps: BinanceEarnHistoryDeps,
  accountId: string,
  run: BinanceHistoryRun,
): Promise<WalkResult> => {
  const now = deps.now();

  if (isBinanceCoolingDown(accountId, now)) {
    return { imported: 0, complete: false };
  }

  const holdings = await deps.listHoldings(accountId);
  const spot = holdings.find((holding) => binanceKeyOf(holding) === SPOT_KEY);
  const credentials = await deps.readCredentials(accountId);

  if (spot === undefined || credentials === undefined) {
    return { imported: 0, complete: true };
  }

  const cursor = binanceWalkCursorOf(EARN_MARK_FIELDS.cursor, spot.metadata);
  const rescanCursor = binanceWalkCursorOf(EARN_MARK_FIELDS.rescan, spot.metadata);
  const writers = walkWritersOf(spot.id, deps);
  const roundRobins = await readWalkRoundRobins({
    fields: EARN_MARK_FIELDS,
    metadata: spot.metadata,
    ...writers,
  });
  const pending = await readPendingMark({
    field: EARN_MARK_FIELDS.pending,
    metadata: spot.metadata,
    owedIfUnreadable: { start: EARN_FLOOR_MS, end: cursor ?? EARN_FLOOR_MS },
    knownSeries: EARN_SERIES,
    write: (field, ranges) => deps.writeWalkPending(spot.id, field, ranges),
  });
  const plan = planWalkPasses({
    cursor,
    rescanCursor,
    pointCursor: roundRobins.pointCursor,
    rangeCursor: roundRobins.rangeCursor,
    pending,
    floorMs: EARN_FLOOR_MS,
    endTime: now,
    windowMs: EARN_WINDOW_MS,
    overlapMs: RESYNC_OVERLAP_MS,
    maxWindows: MAX_WINDOWS,
  });

  if (plan.forward.length === 0 && plan.rescan.length === 0) {
    return { imported: 0, complete: false };
  }

  const context: EarnContext = {
    deps,
    run,
    accountId,
    spot,
    apiKey: credentials.apiKey,
    secret: credentials.secret,
    options: { fetchImpl: deps.fetchImpl, now: deps.now },
    marks: { cursor, rescanCursor, ...roundRobins, pending },
    plan,
  };

  return runWalkPlan({
    plan,
    callsOf,
    canAfford: (keep) =>
      run.budget.canAfford('earn', COSTS.earn, keep) &&
      !isBinanceCoolingDown(accountId, deps.now()),
    runWindow: (window, pass, keep, hint) =>
      walkSpans({
        window,
        read: (span, keepCalls) => readSpan(context, window, span, keepCalls),
        commit: (span, read) => commitSpan(context, span, read, pass),
        keep,
        hint,
        onComplete: (read) =>
          dropReadPoints({
            pass,
            window,
            read,
            marks: context.marks,
            fields: EARN_MARK_FIELDS,
            writePending: (field, ranges) => deps.writeWalkPending(spot.id, field, ranges),
          }),
      }),
    ...roundRobinHooksOf({ marks: context.marks, fields: EARN_MARK_FIELDS, ...writers }),
  });
};

/**
 * Import the user's BTC Simple Earn history (subscriptions and redemptions of the flexible and
 * locked products, and their rewards) as transactions, committing a span's rows before advancing
 * the mark past it. A run goes forward from the watermark first, then reads the overlap ground
 * earlier runs left owed, then re-scans the last window behind the watermark, then reads the
 * owed points, each on what budget is left (see `planWalkPasses`); every span asks all six
 * kinds. `complete: false` means history, owed ground or the re-scan remains and a later run
 * resumes from the stored marks; a failure other than a rate limit rejects, so the caller can
 * log it without failing the balance sync.
 */
export const syncBinanceEarnHistory = (
  request: { targetAccountId: string; run: BinanceHistoryRun },
  overrides: Partial<BinanceEarnHistoryDeps> = {},
): Promise<WalkResult> =>
  runSync({ ...defaultEarnHistoryDeps, ...overrides }, request.targetAccountId, request.run);
