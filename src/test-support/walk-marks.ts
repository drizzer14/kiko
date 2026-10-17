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
import { isRecord } from '@kiko/type-guards';
import type { DatabaseSync } from 'node:sqlite';
import type { BinanceWalkWriteDeps } from '@kiko/crypto-sync/exchange/walk';

export type WalkName = 'capital' | 'pay' | 'transfer' | 'earn';

export type WalkField =
  | 'cursor'
  | 'rescan'
  | 'pending'
  | 'pointCursor'
  | 'rangeCursor'
  | 'spanHints';

/** Any value, because a test also seeds a malformed mark to prove the walk reads it as none. */
export type WalkMarkSeed = Partial<Record<WalkField, unknown>>;

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
} as const satisfies Record<WalkName, Record<WalkField, string>>;

export const WALK_NAMES = Object.keys(KEYS) as WalkName[];

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

const isDatabase = (source: MarksSource): source is DatabaseSync =>
  'prepare' in source && typeof source.prepare === 'function';

type StoredSpot = { id: string; metadata: string };

/** The Spot holding the walks read: the first Spot BTC holding of the account. */
const storedSpotOf = (database: DatabaseSync, accountId: string): StoredSpot => {
  const stored = database
    .prepare(
      `SELECT id, metadata FROM holdings
        WHERE account_id = ? AND json_extract(metadata, '$.binanceAsset') = ?
        ORDER BY sort_order, created_at LIMIT 1`,
    )
    .get(accountId, SPOT_ASSET) as StoredSpot | undefined;

  if (stored === undefined) {
    throw new Error(`walk-marks: account "${accountId}" has no Spot ${SPOT_ASSET} holding`);
  }

  return stored;
};

const metadataOf = (source: MarksSource, accountId: string): Metadata => {
  if (Array.isArray(source)) {
    const spot = source.find(
      (holding) => isRecord(holding.metadata) && holding.metadata.binanceAsset === SPOT_ASSET,
    );

    if (!isRecord(spot?.metadata)) {
      throw new Error(`walk-marks: no Spot ${SPOT_ASSET} holding among the ${source.length} given`);
    }

    return spot.metadata;
  }

  if (isDatabase(source)) {
    return JSON.parse(storedSpotOf(source, accountId).metadata) as Metadata;
  }

  return source;
};

/** A field is left out of the result when the walk holds no mark for it. */
export const walkMarksOf = (
  source: MarksSource,
  accountId: string,
  walkName: WalkName,
): WalkMarkSeed => {
  const metadata = metadataOf(source, accountId);

  return Object.fromEntries(
    FIELDS.filter((field) => KEYS[walkName][field] in metadata).map((field) => [
      field,
      metadata[KEYS[walkName][field]],
    ]),
  );
};

/** A mark given as `undefined` is left out, as a seed with no such key. */
export const withWalkMarks = (
  seed: Metadata,
  _accountId: string,
  walkName: WalkName,
  marks: WalkMarkSeed,
): Metadata => ({
  ...seed,
  ...Object.fromEntries(
    FIELDS.filter((field) => marks[field] !== undefined).map((field) => [
      KEYS[walkName][field],
      marks[field],
    ]),
  ),
});

/** The marks of several walks at once, each over what the seed already holds. */
export const withWalkMarkSeeds = (
  seed: Metadata,
  accountId: string,
  seeds: Partial<Record<WalkName, WalkMarkSeed>>,
): Metadata =>
  WALK_NAMES.reduce(
    (metadata, walkName) => withWalkMarks(metadata, accountId, walkName, seeds[walkName] ?? {}),
    seed,
  );

/**
 * Sets the given marks of one walk on the account's Spot holding in a migrated database, over the
 * marks it already holds; a field given as `undefined` is removed.
 */
export const seedWalkMarks = (
  database: DatabaseSync,
  accountId: string,
  walkName: WalkName,
  marks: WalkMarkSeed,
): void => {
  const spot = storedSpotOf(database, accountId);
  const removed: string[] = FIELDS.filter(
    (field) => field in marks && marks[field] === undefined,
  ).map((field) => KEYS[walkName][field]);
  const metadata = Object.fromEntries(
    Object.entries(
      withWalkMarks(JSON.parse(spot.metadata) as Metadata, accountId, walkName, marks),
    ).filter(([key]) => !removed.includes(key)),
  );

  database
    .prepare('UPDATE holdings SET metadata = ? WHERE id = ?')
    .run(JSON.stringify(metadata), spot.id);
};

type WriteOptions = { last?: boolean };

export const expectWalkMarkWritten = (
  deps: Partial<BinanceWalkWriteDeps>,
  _accountId: string,
  walkName: WalkName,
  field: WalkField,
  value: unknown,
  { last = false }: WriteOptions = {},
): void => {
  const writer = expect(deps[WRITERS[field]]);

  if (last) {
    writer.toHaveBeenLastCalledWith(SPOT_HOLDING_ID, KEYS[walkName][field], value);
  } else {
    writer.toHaveBeenCalledWith(SPOT_HOLDING_ID, KEYS[walkName][field], value);
  }
};

/** Several fields give the writes of all of them, in the order they were made across writers. */
export const walkMarkWritesOf = (
  deps: Partial<BinanceWalkWriteDeps>,
  walkName: WalkName,
  field: WalkField | readonly WalkField[],
): unknown[] => {
  const fields = typeof field === 'string' ? [field] : field;
  const keys = new Set<string>(fields.map((each) => KEYS[walkName][each]));
  const writers = new Set(fields.map((each) => WRITERS[each]));

  return [...writers]
    .flatMap((writer) => {
      const mock = deps[writer] as jest.Mock | undefined;

      return (mock?.mock.calls ?? []).map((call, index) => ({
        key: call[1] as string,
        value: call[2] as unknown,
        order: mock?.mock.invocationCallOrder[index] ?? 0,
      }));
    })
    .filter((write) => keys.has(write.key))
    .sort((left, right) => left.order - right.order)
    .map((write) => write.value);
};

/** Every number mark any walk wrote, so a write to a walk the run never owned is counted too. */
export const numberMarkWritesOfAnyWalk = (deps: Partial<BinanceWalkWriteDeps>): number[] =>
  ((deps.writeWalkCursor as jest.Mock | undefined)?.mock.calls ?? []).map(
    (call) => call[2] as number,
  );

/** `order` is the jest call order of the writer, to compare with a call of any other mock. */
type WalkWrite = {
  walkName: WalkName;
  field: WalkField;
  value: unknown;
  order: number;
};

type WalkWorld = {
  accountId?: string;
  marks?: Partial<Record<WalkName, WalkMarkSeed>>;
  /** Holdings listed after the Spot holding, such as a Funding or an Earn one. */
  alongside?: HoldingRow[];
  /** Called before the fake applies the write, so a test can log the order of writes. */
  onWrite?: (write: WalkWrite) => void;
};

type WalkStateDeps = {
  [Writer in WalkWriter]: jest.Mock<Promise<void>, Parameters<BinanceWalkWriteDeps[Writer]>>;
};

type WalkOwner = { walkName: WalkName; field: WalkField };

const OWNER_OF_KEY = new Map<string, WalkOwner>(
  WALK_NAMES.flatMap((walkName) =>
    FIELDS.map((field): [string, WalkOwner] => [KEYS[walkName][field], { walkName, field }]),
  ),
);

/** Throws on a key no walk owns: a fake that accepted one would hide a mistyped mark. */
export const walkStateFake = (world: WalkWorld = {}) => {
  const accountId = world.accountId ?? 'acc-1';
  let metadata: Metadata = { binanceAsset: SPOT_ASSET };

  const seed = (walkName: WalkName, marks: WalkMarkSeed): void => {
    metadata = withWalkMarks(metadata, accountId, walkName, marks);
  };

  for (const walkName of WALK_NAMES) {
    seed(walkName, world.marks?.[walkName] ?? {});
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

  const listHoldings = async (): Promise<HoldingRow[]> =>
    [{ id: SPOT_HOLDING_ID, metadata }, ...(world.alongside ?? [])] as unknown as HoldingRow[];

  return {
    deps: freshDeps(),
    freshDeps,
    seed,
    writes: (): WalkWrite[] => [...writes],
    marksOf: (walkName: WalkName): WalkMarkSeed => walkMarksOf(metadata, accountId, walkName),
    listHoldings,
  };
};

/** The reads and writers of a walk over one stored state, seeded with the given marks. */
export const walkStateDeps = (world: WalkWorld = {}) => {
  const { deps, listHoldings } = walkStateFake(world);

  return { ...deps, listHoldings };
};
