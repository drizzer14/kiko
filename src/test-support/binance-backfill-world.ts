/**
 * The world the backfill tests of the four Binance history walks (capital, Pay, Transfer, Earn)
 * share: the records an account holds as the endpoints serve them, the walks run through the real
 * client over those, and the rows they hand over to the store.
 */
import { match } from 'ts-pattern';
import {
  createBinanceHistoryRun,
  syncBinanceEarnHistory,
  syncBinancePayHistory,
  syncBinanceTransactions,
  syncBinanceTransferHistory,
} from '@kiko/crypto-sync/binance';
import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import type { OwedGround } from '@kiko/crypto-sync/exchange/walk';
import { type Currency, currencyScale } from '@kiko/currency/currency';

import { type WalkMarkSeed, walkStateFake } from './walk-marks';

export const NOW = Date.UTC(2026, 9, 10);

export const ACCOUNT_ID = 'acc-1';

/** Where the walks started to read every coin: the ground before it is the backfill's. */
export const SINCE = NOW - 20 * DAY_MS;

/**
 * A time before every walk's re-scan window (89 days for capital and Pay, 30 for Transfer and
 * Earn) and after every floor, so only the backfill reads a record there.
 */
export const BACKFILL_AT = NOW - 120 * DAY_MS;

export type BackfillWalk = 'capital' | 'pay' | 'transfer' | 'earn';

export const BACKFILL_WALKS: BackfillWalk[] = ['capital', 'pay', 'transfer', 'earn'];

/** The rows one settled record of a tracked coin gives: a transfer has a leg on each wallet. */
export const ROWS_PER_RECORD: Record<BackfillWalk, number> = {
  capital: 1,
  pay: 1,
  transfer: 2,
  earn: 1,
};

type RecordKind = 'deposit' | 'withdraw' | 'pay' | 'transfer' | 'earn';

/** The kind of record a test serves to each walk: a deposit is the capital walk's. */
export const KIND_OF: Record<BackfillWalk, RecordKind> = {
  capital: 'deposit',
  pay: 'pay',
  transfer: 'transfer',
  earn: 'earn',
};

/** One record as Binance serves it, with the millisecond a read of a window filters it by. */
export type ServedRecord = { kind: RecordKind; time: number; body: Record<string, unknown> };

type RecordInput = {
  id: string;
  coin: Currency;
  time: number;
  units: number;
  /** A Pay order the user sent; the others are received. */
  send?: boolean;
  /** The amount text as Binance writes it, instead of the one `units` gives. */
  amount?: string;
};

const SECOND_MS = 1_000;
const OWN_UID = 1001;
const OTHER_UID = 2002;
const PAGE = 100;
const CAPITAL_PAGE = 1_000;
const TRANSACTION_HASH_FIELD = 'txId';

const amountOf = (input: RecordInput): string =>
  input.amount ?? `0.${String(input.units).padStart(currencyScale[input.coin], '0')}`;

const timestampOf = (time: number): string =>
  new Date(time).toISOString().slice(0, 19).replace('T', ' ');

const payOrderOf = (input: RecordInput): ServedRecord => {
  const amount = amountOf(input);
  const own = { name: 'Me', binanceId: String(OWN_UID) };
  const other = { name: 'Ann', binanceId: String(OTHER_UID) };

  return {
    kind: 'pay',
    time: input.time,
    body: {
      orderType: 'C2C',
      transactionId: input.id,
      transactionTime: input.time,
      amount: input.send === true ? `-${amount}` : amount,
      currency: input.coin,
      walletType: 2,
      fundsDetail: [{ currency: input.coin, amount, walletAssetCost: { '2': amount } }],
      payerInfo: input.send === true ? own : other,
      receiverInfo: input.send === true ? other : own,
    },
  };
};

/** A settled deposit, withdrawal, Pay order, MAIN_FUNDING transfer or flexible reward. */
export const recordOf = (kind: RecordKind, input: RecordInput): ServedRecord => {
  const amount = amountOf(input);

  return match(kind)
    .returnType<ServedRecord>()
    .with('deposit', () => ({
      kind,
      time: input.time,
      body: {
        id: input.id,
        amount,
        coin: input.coin,
        [TRANSACTION_HASH_FIELD]: `hash-${input.id}`,
        insertTime: input.time,
        status: 1,
        walletType: 0,
      },
    }))
    .with('withdraw', () => ({
      kind,
      time: input.time,
      body: {
        id: input.id,
        amount,
        transactionFee: '0',
        coin: input.coin,
        [TRANSACTION_HASH_FIELD]: `hash-${input.id}`,
        applyTime: timestampOf(input.time),
        status: 6,
        walletType: 0,
      },
    }))
    .with('pay', () => payOrderOf(input))
    .with('transfer', () => ({
      kind,
      time: input.time,
      body: {
        asset: input.coin,
        amount,
        type: 'MAIN_FUNDING',
        status: 'CONFIRMED',
        tranId: input.id,
        timestamp: input.time,
      },
    }))
    .with('earn', () => ({
      kind,
      time: input.time,
      body: {
        asset: input.coin,
        rewards: amount,
        projectId: input.id,
        type: 'REALTIME',
        time: input.time,
      },
    }))
    .exhaustive();
};

/** A Pay send in USDC that was paid from USDT and BTC: a row for each of the two coins. */
export const mixedPaySendOf = (input: { id: string; time: number }): ServedRecord => ({
  kind: 'pay',
  time: input.time,
  body: {
    orderType: 'C2C',
    transactionId: input.id,
    transactionTime: input.time,
    amount: '-1',
    currency: 'USDC',
    walletType: 2,
    fundsDetail: [
      { currency: 'USDT', amount: '3', walletAssetCost: { '2': '3' } },
      { currency: 'BTC', amount: '0.003', walletAssetCost: { '2': '0.003' } },
    ],
    payerInfo: { name: 'Me', binanceId: String(OWN_UID) },
    receiverInfo: { name: 'Ann', binanceId: String(OTHER_UID) },
  },
});

const inWindow = (
  records: ServedRecord[],
  kind: RecordKind,
  query: URLSearchParams,
  precision: number,
): ServedRecord[] => {
  const floored = (time: number) => Math.floor(time / precision) * precision;
  const start = floored(Number(query.get('startTime')));
  const end = floored(Number(query.get('endTime')));

  return records.filter((entry) => entry.kind === kind && start <= entry.time && entry.time <= end);
};

/** What each endpoint answers to a read: the records whose time lies in the window asked for. */
const bodyOf = (records: ServedRecord[], url: URL): unknown => {
  const { searchParams: query, pathname } = url;
  const offset = Number(query.get('offset') ?? 0);
  const current = Number(query.get('current') ?? 1);
  const bodiesOf = (served: ServedRecord[]) => served.map((entry) => entry.body);
  const totalOf = (served: ServedRecord[]) => ({
    rows: bodiesOf(served.slice((current - 1) * PAGE, current * PAGE)),
    total: served.length,
  });

  if (pathname === '/api/v3/account') {
    return { balances: [], uid: OWN_UID };
  }

  if (pathname.endsWith('/capital/deposit/hisrec')) {
    return bodiesOf(inWindow(records, 'deposit', query, 1).slice(offset, offset + CAPITAL_PAGE));
  }

  if (pathname.endsWith('/capital/withdraw/history')) {
    return bodiesOf(
      inWindow(records, 'withdraw', query, SECOND_MS).slice(offset, offset + CAPITAL_PAGE),
    );
  }

  if (pathname.endsWith('/pay/transactions')) {
    return { code: '000000', data: bodiesOf(inWindow(records, 'pay', query, 1)) };
  }

  if (pathname.endsWith('/asset/transfer')) {
    return totalOf(
      inWindow(records, 'transfer', query, 1).filter(
        (entry) => entry.body.type === query.get('type'),
      ),
    );
  }

  if (pathname.endsWith('/flexible/history/rewardsRecord')) {
    return totalOf(inWindow(records, 'earn', query, SECOND_MS));
  }

  return totalOf([]);
};

/** A read window as the endpoint is asked for it. */
export type AskedWindow = { start: number; end: number };

/** A body no client reads: the page of a window that Binance serves off its contract. */
const OFF_CONTRACT_BODY = { unexpected: true };

const isRefused = (url: URL, refusing: ((window: AskedWindow) => boolean) | undefined): boolean =>
  url.pathname.endsWith('/capital/withdraw/history') &&
  refusing?.({
    start: Number(url.searchParams.get('startTime')),
    end: Number(url.searchParams.get('endTime')),
  }) === true;

/**
 * The fetch of an account that holds `records`. A withdrawal read of a window that `refusing`
 * names is answered off the contract, which the capital walk reads as a page that cannot be read.
 */
export const servedFetch = (
  records: ServedRecord[],
  refusing?: (window: AskedWindow) => boolean,
): typeof fetch =>
  (async (input: string) => {
    const url = new URL(input);
    const body = isRefused(url, refusing) ? OFF_CONTRACT_BODY : bodyOf(records, url);

    return { ok: true, status: 200, headers: new Headers(), json: async () => body };
  }) as unknown as typeof fetch;

type WrittenRow = { externalId: string; holdingId: string; amountMinorUnits: number };

/** The coin a written row sits on, from the holding the world gave the walk. */
export const coinOfRow = (row: WrittenRow): string =>
  row.holdingId === 'h-spot' ? 'BTC' : row.holdingId.slice('h-'.length).split(':')[0];

/** The ranges a walk owes to the backfill: the ground of its list that is no point. */
export const backfillRangesOf = (marks: WalkMarkSeed): OwedGround[] =>
  ((marks.pending as OwedGround[] | undefined) ?? []).filter(
    (ground) => ground.scope === 'backfill' && ground.kind !== 'point',
  );

/** The most runs `walkUntilRead` spends on one walk. */
export const MAXIMUM_RUNS = 40;

/**
 * An account that holds `records`, walked by the four walks through the real client over a served
 * fetch. Every row a walk hands over is kept in order, and the rows by key as a store holds them.
 */
export const backfillWorldOf = (input: {
  marks?: Partial<Record<BackfillWalk, WalkMarkSeed>>;
  records?: ServedRecord[];
  /** The withdrawal windows Binance serves off its contract, in every run. */
  refusing?: (window: AskedWindow) => boolean;
}) => {
  const records = input.records ?? [];
  const state = walkStateFake({ accountId: ACCOUNT_ID, marks: input.marks });
  const created: { id: string; metadata: { binanceAsset: string } }[] = [];
  const written: WrittenRow[] = [];
  const stored = new Map<string, WrittenRow>();

  const listed = async () => [...(await state.listHoldings()), ...created] as HoldingRow[];

  const ensureHoldings = async (holdings: { metadataKey: string }[]) => {
    for (const { metadataKey } of holdings) {
      const known = (await listed()).some(
        (holding) =>
          (holding.metadata as { binanceAsset?: string } | null)?.binanceAsset === metadataKey,
      );

      if (!known) {
        created.push({ id: `h-${metadataKey}`, metadata: { binanceAsset: metadataKey } });
      }
    }
  };

  const addTransactions = async (rows: WrittenRow[]) => {
    for (const row of rows) {
      written.push(row);
      stored.set(row.externalId, row);
    }

    return rows.length;
  };

  /** One run of a walk at the time `now`. */
  const walk = (name: BackfillWalk, now = NOW) => {
    const deps = {
      ...state.freshDeps(),
      now: () => now,
      fetchImpl: servedFetch(records, input.refusing),
      readCredentials: async () => ({ apiKey: 'key', secret: 'secret' }),
      listHoldings: listed,
      ensureHoldings,
      addTransactions,
      storedExternalIds: async (keys: string[]) => new Set(keys.filter((key) => stored.has(key))),
      latestTransactionTime: async () => undefined,
    };
    const request = {
      targetAccountId: ACCOUNT_ID,
      run: createBinanceHistoryRun({ now: () => now, sleep: async () => undefined }),
    };

    return match(name)
      .with('capital', () => syncBinanceTransactions(request, deps))
      .with('pay', () => syncBinancePayHistory(request, deps))
      .with('transfer', () => syncBinanceTransferHistory(request, deps))
      .with('earn', () => syncBinanceEarnHistory(request, deps))
      .exhaustive();
  };

  const owed = (name: BackfillWalk): OwedGround[] => backfillRangesOf(state.marksOf(name));

  /** Runs `name` until it owes no backfill range, at most `MAXIMUM_RUNS` times. */
  const walkUntilRead = async (name: BackfillWalk): Promise<number> => {
    for (let run = 1; run <= MAXIMUM_RUNS; run += 1) {
      await walk(name);

      if (owed(name).length === 0) {
        return run;
      }
    }

    return MAXIMUM_RUNS;
  };

  return { state, written, stored, walk, owed, walkUntilRead };
};
