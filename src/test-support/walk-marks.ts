/**
 * The one place a test reaches the marks of a Binance history walk (its cursors, owed ground and
 * span hints), so the place those marks live in is named here and in no test.
 */
import {
  BINANCE_EARN_HISTORY_CURSOR_FIELD,
  BINANCE_EARN_PENDING_OVERLAP_FIELD,
  BINANCE_EARN_POINT_CURSOR_FIELD,
  BINANCE_EARN_RANGE_CURSOR_FIELD,
  BINANCE_EARN_RESCAN_CURSOR_FIELD,
  BINANCE_EARN_SPAN_HINTS_FIELD,
  BINANCE_HISTORY_CURSOR_FIELD,
  BINANCE_HISTORY_PENDING_OVERLAP_FIELD,
  BINANCE_HISTORY_POINT_CURSOR_FIELD,
  BINANCE_HISTORY_RANGE_CURSOR_FIELD,
  BINANCE_HISTORY_RESCAN_CURSOR_FIELD,
  BINANCE_HISTORY_SPAN_HINTS_FIELD,
  BINANCE_PAY_HISTORY_CURSOR_FIELD,
  BINANCE_PAY_PENDING_OVERLAP_FIELD,
  BINANCE_PAY_POINT_CURSOR_FIELD,
  BINANCE_PAY_RANGE_CURSOR_FIELD,
  BINANCE_PAY_RESCAN_CURSOR_FIELD,
  BINANCE_PAY_SPAN_HINTS_FIELD,
  BINANCE_TRANSFER_HISTORY_CURSOR_FIELD,
  BINANCE_TRANSFER_PENDING_OVERLAP_FIELD,
  BINANCE_TRANSFER_POINT_CURSOR_FIELD,
  BINANCE_TRANSFER_RANGE_CURSOR_FIELD,
  BINANCE_TRANSFER_RESCAN_CURSOR_FIELD,
  BINANCE_TRANSFER_SPAN_HINTS_FIELD,
} from '@kiko/holdings/holding-metadata';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import type { DatabaseSync } from 'node:sqlite';
import type { BinanceWalkWriteDeps } from '@kiko/crypto-sync/exchange/walk';

export type WalkId = 'capital' | 'pay' | 'transfer' | 'earn';

export type WalkField =
  | 'cursor'
  | 'rescan'
  | 'pending'
  | 'pointCursor'
  | 'rangeCursor'
  | 'spanHints';

/** Any value, because a test also seeds a malformed mark to prove the walk reads it as none. */
export type WalkMarks = Partial<Record<WalkField, unknown>>;

const SPOT_HOLDING_ID = 'h-spot';

/** The marks a walk writes as one number: the writer of a cursor takes all four. */
export const NUMBER_MARK_FIELDS = ['cursor', 'rescan', 'pointCursor', 'rangeCursor'] as const;

const KEYS = {
  capital: {
    cursor: BINANCE_HISTORY_CURSOR_FIELD,
    rescan: BINANCE_HISTORY_RESCAN_CURSOR_FIELD,
    pending: BINANCE_HISTORY_PENDING_OVERLAP_FIELD,
    pointCursor: BINANCE_HISTORY_POINT_CURSOR_FIELD,
    rangeCursor: BINANCE_HISTORY_RANGE_CURSOR_FIELD,
    spanHints: BINANCE_HISTORY_SPAN_HINTS_FIELD,
  },
  pay: {
    cursor: BINANCE_PAY_HISTORY_CURSOR_FIELD,
    rescan: BINANCE_PAY_RESCAN_CURSOR_FIELD,
    pending: BINANCE_PAY_PENDING_OVERLAP_FIELD,
    pointCursor: BINANCE_PAY_POINT_CURSOR_FIELD,
    rangeCursor: BINANCE_PAY_RANGE_CURSOR_FIELD,
    spanHints: BINANCE_PAY_SPAN_HINTS_FIELD,
  },
  transfer: {
    cursor: BINANCE_TRANSFER_HISTORY_CURSOR_FIELD,
    rescan: BINANCE_TRANSFER_RESCAN_CURSOR_FIELD,
    pending: BINANCE_TRANSFER_PENDING_OVERLAP_FIELD,
    pointCursor: BINANCE_TRANSFER_POINT_CURSOR_FIELD,
    rangeCursor: BINANCE_TRANSFER_RANGE_CURSOR_FIELD,
    spanHints: BINANCE_TRANSFER_SPAN_HINTS_FIELD,
  },
  earn: {
    cursor: BINANCE_EARN_HISTORY_CURSOR_FIELD,
    rescan: BINANCE_EARN_RESCAN_CURSOR_FIELD,
    pending: BINANCE_EARN_PENDING_OVERLAP_FIELD,
    pointCursor: BINANCE_EARN_POINT_CURSOR_FIELD,
    rangeCursor: BINANCE_EARN_RANGE_CURSOR_FIELD,
    spanHints: BINANCE_EARN_SPAN_HINTS_FIELD,
  },
} as const satisfies Record<WalkId, Record<WalkField, string>>;

const WALK_IDS = Object.keys(KEYS) as WalkId[];

const FIELDS = Object.keys(KEYS.capital) as WalkField[];

type WalkWriter = keyof BinanceWalkWriteDeps;

const WRITERS: Record<WalkField, WalkWriter> = {
  cursor: 'writeWalkCursor',
  rescan: 'writeWalkCursor',
  pointCursor: 'writeWalkCursor',
  rangeCursor: 'writeWalkCursor',
  pending: 'writeWalkPending',
  spanHints: 'writeWalkHints',
};

type Metadata = Record<string, unknown>;

type MarksSource = DatabaseSync | HoldingRow[] | Metadata;

const SPOT_ASSET = 'BTC';

const isRecord = (value: unknown): value is Metadata =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isDatabase = (source: MarksSource): source is DatabaseSync =>
  'prepare' in source && typeof source.prepare === 'function';

const metadataOf = (source: MarksSource, accountId: string): Metadata => {
  if (Array.isArray(source)) {
    const spot = source.find(
      (holding) => isRecord(holding.metadata) && holding.metadata.binanceAsset === SPOT_ASSET,
    );

    return isRecord(spot?.metadata) ? spot.metadata : {};
  }

  if (isDatabase(source)) {
    const stored = source
      .prepare(
        `SELECT metadata FROM holdings
          WHERE account_id = ? AND json_extract(metadata, '$.binanceAsset') = ?
          ORDER BY sort_order, created_at LIMIT 1`,
      )
      .get(accountId, SPOT_ASSET) as { metadata: string } | undefined;

    return foldMap(maybe(stored), (row) => JSON.parse(row.metadata) as Metadata) ?? {};
  }

  return source;
};

/** A field is left out of the result when the walk holds no mark for it. */
export const walkMarksOf = (source: MarksSource, accountId: string, walkId: WalkId): WalkMarks => {
  const metadata = metadataOf(source, accountId);

  return Object.fromEntries(
    FIELDS.filter((field) => KEYS[walkId][field] in metadata).map((field) => [
      field,
      metadata[KEYS[walkId][field]],
    ]),
  );
};

/** A mark given as `undefined` is left out, as a seed with no such key. */
export const withWalkMarks = (
  seed: Metadata,
  _accountId: string,
  walkId: WalkId,
  marks: WalkMarks,
): Metadata => ({
  ...seed,
  ...Object.fromEntries(
    FIELDS.filter((field) => marks[field] !== undefined).map((field) => [
      KEYS[walkId][field],
      marks[field],
    ]),
  ),
});

type WriteOptions = { last?: boolean; holdingId?: string };

export const expectWalkMarkWritten = (
  deps: Partial<BinanceWalkWriteDeps>,
  _accountId: string,
  walkId: WalkId,
  field: WalkField,
  value: unknown,
  { last = false, holdingId = SPOT_HOLDING_ID }: WriteOptions = {},
): void => {
  const writer = expect(deps[WRITERS[field]]);

  if (last) {
    writer.toHaveBeenLastCalledWith(holdingId, KEYS[walkId][field], value);
  } else {
    writer.toHaveBeenCalledWith(holdingId, KEYS[walkId][field], value);
  }
};

/** Several fields give the writes of all of them, as the one writer that takes them saw them. */
export const walkMarkWritesOf = (
  deps: Partial<BinanceWalkWriteDeps>,
  walkId: WalkId,
  field: WalkField | readonly WalkField[],
): unknown[] => {
  const fields = typeof field === 'string' ? [field] : field;
  const keys = new Set<string>(fields.map((each) => KEYS[walkId][each]));
  const writers = new Set(fields.map((each) => WRITERS[each]));

  return [...writers].flatMap((writer) =>
    ((deps[writer] as jest.Mock | undefined)?.mock.calls ?? [])
      .filter((call) => keys.has(call[1] as string))
      .map((call) => call[2] as unknown),
  );
};

/** `order` is the jest call order of the writer, to compare with a call of any other mock. */
type WalkWrite = { walkId: WalkId; field: WalkField; value: unknown; order: number };

type WalkWorld = {
  accountId?: string;
  holdingId?: string;
  metadata?: Metadata;
  marks?: Partial<Record<WalkId, WalkMarks>>;
  /** Called before the fake applies the write, so a test can log the order of writes. */
  onWrite?: (write: WalkWrite) => void;
};

type WalkStateDeps = {
  [Writer in WalkWriter]: jest.Mock<Promise<void>, Parameters<BinanceWalkWriteDeps[Writer]>>;
};

const OWNER_OF_KEY = new Map<string, { walkId: WalkId; field: WalkField }>(
  WALK_IDS.flatMap((walkId) =>
    FIELDS.map((field): [string, { walkId: WalkId; field: WalkField }] => [
      KEYS[walkId][field],
      { walkId, field },
    ]),
  ),
);

/** Throws on a key no walk owns: a fake that accepted one would hide a mistyped mark. */
export const walkStateFake = (world: WalkWorld = {}) => {
  const accountId = world.accountId ?? 'acc-1';
  const holdingId = world.holdingId ?? SPOT_HOLDING_ID;
  let metadata: Metadata = { binanceAsset: SPOT_ASSET, ...world.metadata };

  const seed = (walkId: WalkId, marks: WalkMarks): void => {
    metadata = withWalkMarks(metadata, accountId, walkId, marks);
  };

  for (const walkId of WALK_IDS) {
    seed(walkId, world.marks?.[walkId] ?? {});
  }

  const writes: WalkWrite[] = [];

  const apply = (writer: jest.Mock, key: string, value: unknown): void => {
    const owner = OWNER_OF_KEY.get(key);

    if (owner === undefined) {
      throw new Error(`walkStateFake: no walk mark is stored under "${key}"`);
    }

    const write = { ...owner, value, order: writer.mock.invocationCallOrder.at(-1) ?? 0 };

    writes.push(write);
    world.onWrite?.(write);
    metadata = { ...metadata, [key]: value };
  };

  /** Each call is a set of writers that count their own calls but share the one stored state. */
  const freshDeps = (): WalkStateDeps => {
    const mocks: WalkStateDeps = {
      writeWalkCursor: jest.fn(async (_holdingId, key, cursorMs) => {
        apply(mocks.writeWalkCursor, key, cursorMs);
      }),
      writeWalkPending: jest.fn(async (_holdingId, key, ranges) => {
        apply(mocks.writeWalkPending, key, ranges);
      }),
      writeWalkHints: jest.fn(async (_holdingId, key, hints) => {
        apply(mocks.writeWalkHints, key, hints);
      }),
    };

    return mocks;
  };

  return {
    deps: freshDeps(),
    freshDeps,
    seed,
    writes: (): WalkWrite[] => [...writes],
    marksOf: (walkId: WalkId): WalkMarks => walkMarksOf(metadata, accountId, walkId),
    listHoldings: async (): Promise<HoldingRow[]> =>
      [{ id: holdingId, metadata }] as unknown as HoldingRow[],
  };
};
