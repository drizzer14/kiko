/**
 * The one place a test reaches the marks of a Binance history walk (its cursors, owed ground and
 * span hints), so the place those marks live in is named here and in no test.
 */
import type { HoldingRow } from '@kiko/db';
import {
  type ExchangeStatePatch,
  exchangeStatePatched,
} from '@kiko/crypto-sync/exchange/walk-state';
import type { DatabaseSync } from 'node:sqlite';
import type { ExchangeStateDeps } from '@kiko/crypto-sync/exchange/walk';

export type WalkName =
  | 'capital'
  | 'pay'
  | 'transfer'
  | 'earn'
  | 'convert'
  | 'p2p'
  | 'fiatOrders'
  | 'fiatPayments';

export type WalkField =
  | 'cursor'
  | 'rescan'
  | 'pending'
  | 'pointCursor'
  | 'rangeCursor'
  | 'backfillCursor'
  | 'spanHints'
  | 'behindRun'
  | 'rescanTurn'
  | 'rescanStuck'
  | 'multiCoinSince'
  | 'multiCoinSeen';

/** Any value, because a test also seeds a malformed mark to prove the walk reads it as none. */
export type WalkMarkSeed = Partial<Record<WalkField, unknown>>;

/** The stored JSON of `sync_state.exchange_state`, with each walk's entry as the test seeded it. */
export type ExchangeStateSeed = {
  version: 1;
  walks: Partial<Record<WalkName, Record<string, unknown>>>;
  oversizedCoins?: { history?: string[] };
  notImported?: string[];
  /** Any value, because a test also seeds an unreadable stamp. */
  balanceSyncedAt?: unknown;
};

const SPOT_HOLDING_ID = 'h-spot';

const SPOT_ASSET = 'BTC';

/** The marks a walk writes as one number: a cursor, a re-scan mark or a round-robin's cursor. */
export const NUMBER_MARK_FIELDS = ['cursor', 'rescan', 'pointCursor', 'rangeCursor'] as const;

const FIELDS: readonly WalkField[] = [
  ...NUMBER_MARK_FIELDS,
  'backfillCursor',
  'pending',
  'spanHints',
  'behindRun',
  'rescanTurn',
  'rescanStuck',
  'multiCoinSince',
  'multiCoinSeen',
];

export const WALK_NAMES: readonly WalkName[] = [
  'capital',
  'pay',
  'transfer',
  'earn',
  'convert',
  'p2p',
  'fiatOrders',
  'fiatPayments',
];

const isNumberField = (field: WalkField): boolean =>
  NUMBER_MARK_FIELDS.some((numberField) => numberField === field);

const emptyState = (): ExchangeStateSeed => ({ version: 1, walks: {} });

/** A mark given as `undefined` is left out, as a seed with no such field. */
const definedMarks = (marks: WalkMarkSeed): Record<string, unknown> =>
  Object.fromEntries(
    FIELDS.filter((field) => marks[field] !== undefined).map((field) => [field, marks[field]]),
  );

type MarksSource = DatabaseSync | ExchangeStateSeed;

const isDatabase = (source: MarksSource): source is DatabaseSync =>
  'prepare' in source && typeof source.prepare === 'function';

const storedStateOf = (database: DatabaseSync, accountId: string): ExchangeStateSeed => {
  const row = database
    .prepare('SELECT exchange_state FROM sync_state WHERE account_id = ?')
    .get(accountId) as { exchange_state: string | null } | undefined;

  return row?.exchange_state ? (JSON.parse(row.exchange_state) as ExchangeStateSeed) : emptyState();
};

/** A field is left out of the result when the walk holds no mark for it. */
export const walkMarksOf = (
  source: MarksSource,
  accountId: string,
  walkName: WalkName,
): WalkMarkSeed => {
  const state = isDatabase(source) ? storedStateOf(source, accountId) : source;
  const entry = state.walks[walkName] ?? {};

  return Object.fromEntries(
    FIELDS.filter((field) => field in entry).map((field) => [field, entry[field]]),
  );
};

/** The state with the given marks in one walk's entry, over the marks the entry already holds. */
export const withWalkMarks = (
  seed: Partial<ExchangeStateSeed>,
  _accountId: string,
  walkName: WalkName,
  marks: WalkMarkSeed,
): ExchangeStateSeed => ({
  ...seed,
  version: 1,
  walks: {
    ...seed.walks,
    [walkName]: { ...seed.walks?.[walkName], ...definedMarks(marks) },
  },
});

/** The marks of several walks at once; a walk the seeds leave out gets no entry. */
export const withWalkMarkSeeds = (
  seed: Partial<ExchangeStateSeed>,
  accountId: string,
  seeds: Partial<Record<WalkName, WalkMarkSeed>>,
): ExchangeStateSeed =>
  WALK_NAMES.reduce<ExchangeStateSeed>(
    (state, walkName) =>
      walkName in seeds ? withWalkMarks(state, accountId, walkName, seeds[walkName] ?? {}) : state,
    { ...emptyState(), ...seed },
  );

/**
 * Sets the given marks of one walk on the account's state row in a migrated database, over the
 * marks it already holds; a field given as `undefined` is removed.
 */
export const seedWalkMarks = (
  database: DatabaseSync,
  accountId: string,
  walkName: WalkName,
  marks: WalkMarkSeed,
): void => {
  const withMarks = withWalkMarks(storedStateOf(database, accountId), accountId, walkName, marks);
  const removed = FIELDS.filter((field) => field in marks && marks[field] === undefined);
  const entry = Object.fromEntries(
    Object.entries(withMarks.walks[walkName] ?? {}).filter(
      ([field]) => !removed.some((removedField) => removedField === field),
    ),
  );

  database
    .prepare(
      `INSERT INTO sync_state (account_id, exchange_state) VALUES (?, ?)
       ON CONFLICT(account_id) DO UPDATE SET exchange_state = excluded.exchange_state`,
    )
    .run(
      accountId,
      JSON.stringify({ ...withMarks, walks: { ...withMarks.walks, [walkName]: entry } }),
    );
};

/** `order` is the jest call order of the write, to compare with a call of any other mock. */
type WalkWrite = {
  accountId: string;
  walkName: WalkName;
  field: WalkField;
  value: unknown;
  order: number;
};

type WalkPatch = Extract<ExchangeStatePatch, { kind: 'walk' }>;

type PatchMock = jest.Mock<Promise<void>, Parameters<ExchangeStateDeps['patchExchangeState']>>;

type CoinListPatch = Extract<ExchangeStatePatch, { kind: 'coinList' }>;

const isWalkPatch = (patch: ExchangeStatePatch): patch is WalkPatch => patch.kind === 'walk';

const isCoinListPatch = (patch: ExchangeStatePatch): patch is CoinListPatch =>
  patch.kind === 'coinList';

const isNotImportedPatch = (patch: ExchangeStatePatch): boolean => patch.kind === 'notImported';

const isListPatch = (patch: ExchangeStatePatch): boolean =>
  isCoinListPatch(patch) || isNotImportedPatch(patch);

/** The writes of one call, in the order of its patches: each a little after the call it is in. */
const writesOfCall = (
  accountId: string,
  patches: readonly WalkPatch[],
  callOrder: number,
): WalkWrite[] =>
  patches.map((patch, patchIndex) => ({
    accountId,
    walkName: patch.walkId as WalkName,
    field: patch.field,
    value: patch.value,
    order: callOrder + patchIndex / patches.length,
  }));

/** Every walk-mark write the deps' patch writer took, in the order it took them. */
const writesOf = (deps: Partial<ExchangeStateDeps>): WalkWrite[] => {
  const mock = deps.patchExchangeState as PatchMock | undefined;

  return (mock?.mock.calls ?? []).flatMap(([accountId, patches], callIndex) =>
    writesOfCall(
      accountId,
      patches.filter(isWalkPatch),
      mock?.mock.invocationCallOrder[callIndex] ?? 0,
    ),
  );
};

/** The number marks share one group: `last` compares the latest write among them. */
const groupOf = (field: WalkField): string => (isNumberField(field) ? 'number' : field);

type WriteOptions = { last?: boolean };

export const expectWalkMarkWritten = (
  deps: Partial<ExchangeStateDeps>,
  accountId: string,
  walkName: WalkName,
  field: WalkField,
  value: unknown,
  { last = false }: WriteOptions = {},
): void => {
  const expected = { accountId, walkName, field, value };
  const writes = writesOf(deps).map(({ order: _order, ...write }) => write);

  if (last) {
    expect(writes.filter((write) => groupOf(write.field) === groupOf(field)).at(-1)).toEqual(
      expected,
    );
  } else {
    expect(writes).toContainEqual(expected);
  }
};

/** Several fields give the writes of all of them, in the order they were made. */
export const walkMarkWritesOf = (
  deps: Partial<ExchangeStateDeps>,
  walkName: WalkName,
  field: WalkField | readonly WalkField[],
): unknown[] => {
  const fields = typeof field === 'string' ? [field] : field;

  return writesOf(deps)
    .filter((write) => write.walkName === walkName && fields.includes(write.field))
    .map((write) => write.value);
};

/** Every coin-list patch the deps' patch writer took, in the order it took them. */
export const coinListPatchesOf = (deps: Partial<ExchangeStateDeps>): CoinListPatch[] =>
  ((deps.patchExchangeState as PatchMock | undefined)?.mock.calls ?? []).flatMap(([, patches]) =>
    patches.filter(isCoinListPatch),
  );

/** Every number mark any walk wrote, so a write to a walk the run never owned is counted too. */
export const numberMarkWritesOfAnyWalk = (deps: Partial<ExchangeStateDeps>): number[] =>
  writesOf(deps)
    .filter((write) => isNumberField(write.field))
    .map((write) => write.value as number);

type WalkWorld = {
  accountId?: string;
  marks?: Partial<Record<WalkName, WalkMarkSeed>>;
  /** Stored JSON this build does not read (a top-level key, an unknown walk id), kept as it is. */
  unknown?: { keys?: Record<string, unknown>; walks?: Record<string, unknown> };
  /** Holdings listed after the Spot holding, such as a Funding or an Earn one. */
  alongside?: HoldingRow[];
  /** Called before the fake applies the write, so a test can log the order of writes. */
  onWrite?: (write: WalkWrite) => void;
};

type WalkStateDeps = { patchExchangeState: PatchMock; readExchangeState: jest.Mock };

/**
 * Throws on a patch no walk owns, bar the coin lists a walk writes: a fake that accepted any other
 * would hide a mistyped mark.
 */
export const walkStateFake = (world: WalkWorld = {}) => {
  const accountId = world.accountId ?? 'acc-1';
  const seeded = withWalkMarkSeeds({}, accountId, world.marks ?? {});
  let state: ExchangeStateSeed = {
    ...world.unknown?.keys,
    ...seeded,
    walks: { ...world.unknown?.walks, ...seeded.walks },
  };

  const seed = (walkName: WalkName, marks: WalkMarkSeed): void => {
    state = withWalkMarks(state, accountId, walkName, marks);
  };

  const writes: WalkWrite[] = [];

  const apply = (
    patchMock: PatchMock,
    written: string,
    patches: readonly ExchangeStatePatch[],
  ): void => {
    const other = patches.find((patch) => !isWalkPatch(patch) && !isListPatch(patch));

    if (other !== undefined) {
      throw new Error(`walkStateFake: no walk mark is stored under "${other.kind}"`);
    }

    if (written === accountId) {
      state = JSON.parse(
        exchangeStatePatched(JSON.stringify(state), patches.filter(isListPatch)) ?? '',
      ) as ExchangeStateSeed;
    }

    const walkPatches = patches.filter(isWalkPatch);

    writesOfCall(written, walkPatches, patchMock.mock.invocationCallOrder.at(-1) ?? 0).forEach(
      (write, index) => {
        writes.push(write);
        world.onWrite?.(write);

        if (written === accountId) {
          state = JSON.parse(
            exchangeStatePatched(JSON.stringify(state), [walkPatches[index]]) ?? '',
          ) as ExchangeStateSeed;
        }
      },
    );
  };

  /**
   * Each call is a set of deps that count their own calls but share the one stored state. The state
   * is the one account's row: a read for another account finds no row, and a write for another
   * account is recorded but changes nothing.
   */
  const freshDeps = (): WalkStateDeps => {
    const mocks: WalkStateDeps = {
      readExchangeState: jest.fn(async (read: string) =>
        read === accountId ? JSON.stringify(state) : null,
      ),
      patchExchangeState: jest.fn(async (written: string, patches) => {
        apply(mocks.patchExchangeState, written, patches);
      }),
    };

    return mocks;
  };

  const listHoldings = async (): Promise<HoldingRow[]> =>
    [
      { id: SPOT_HOLDING_ID, metadata: { binanceAsset: SPOT_ASSET } },
      ...(world.alongside ?? []),
    ] as unknown as HoldingRow[];

  return {
    deps: freshDeps(),
    freshDeps,
    seed,
    writes: (): WalkWrite[] => [...writes],
    marksOf: (walkName: WalkName): WalkMarkSeed => walkMarksOf(state, accountId, walkName),
    notImported: (): string[] => state.notImported ?? [],
    listHoldings,
  };
};

/** The reads and writers of a walk over one stored state, seeded with the given marks. */
export const walkStateDeps = (world: WalkWorld = {}) => {
  const { deps, listHoldings } = walkStateFake(world);

  return { ...deps, listHoldings };
};
