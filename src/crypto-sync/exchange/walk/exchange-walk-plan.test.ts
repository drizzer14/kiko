import {
  NO_HINTS,
  type OwedGround,
  type OwedWindow,
  type SpanCommit,
  type WalkMarks,
  type WalkPass,
  type WalkPlan,
  type WindowOutcome,
} from './walk';
import { runExchangeWalkPlan } from './exchange-walk-plan';

type Lane = 'only';
type Cost = { weight: number };

class OwedWindowError extends Error {}

const LANE: Lane = 'only';
const COST: Cost = { weight: 1 };
const NOW = 7_000;
const PAGE = { kind: 'page', page: 'page-1' };
const COMMITTED: SpanCommit = { imported: 3, owed: false, returned: [], stuck: [] };

const owed = (start: number): OwedWindow => ({ start, end: start + 10 });

const planOf = (patch: Partial<WalkPlan>): WalkPlan => ({
  forward: [],
  pending: [],
  points: [],
  rescan: [],
  rescanEnd: 0,
  pendingRanges: [],
  ranAt: 0,
  ...patch,
});

// The walk moves these marks as it reads, so each run gets its own.
const marksOf = (patch: Partial<WalkMarks> = {}): WalkMarks => ({
  cursor: null,
  rescanCursor: null,
  pointCursor: null,
  rangeCursor: null,
  hints: NO_HINTS,
  pending: [],
  ...patch,
});

const runOver = (input: {
  plan: WalkPlan;
  marks?: WalkMarks;
  canAfford?: (lane: Lane, cost: Cost, keep?: number) => boolean;
  isCoolingDown?: (accountId: string, now: number) => boolean;
  isUnreadableWindowError?: (error: unknown) => boolean;
  read?: jest.Mock;
  commit?: jest.Mock;
  callsOf?: (window: OwedWindow) => number;
  owedFirst?: boolean;
  readOnPastUnreadableForward?: boolean;
  outcomeOf?: (pass: WalkPass, window: OwedWindow, outcome: WindowOutcome) => WindowOutcome;
}) => {
  const read = input.read ?? jest.fn(async () => undefined);
  const commit = input.commit ?? jest.fn(async () => COMMITTED);
  const canAfford = jest.fn(input.canAfford ?? (() => true));
  const isCoolingDown = jest.fn(input.isCoolingDown ?? (() => false));
  const write = jest.fn(async () => undefined);
  const marks = input.marks ?? marksOf();

  return {
    read,
    commit,
    canAfford,
    isCoolingDown,
    write,
    marks,
    result: runExchangeWalkPlan({
      context: {
        deps: { now: () => NOW },
        run: { budget: { canAfford } },
        accountId: 'acc-1',
        marks,
        plan: input.plan,
        write,
      },
      lane: LANE,
      cost: COST,
      isCoolingDown,
      isUnreadableWindowError: input.isUnreadableWindowError ?? (() => false),
      read,
      commit,
      callsOf: input.callsOf,
      owedFirst: input.owedFirst,
      readOnPastUnreadableForward: input.readOnPastUnreadableForward,
      outcomeOf: input.outcomeOf,
    }),
  };
};

describe('runExchangeWalkPlan', () => {
  it('reads a window when the lane affords it and the account is not cooling down', async () => {
    const { read, canAfford, isCoolingDown, result } = runOver({
      plan: planOf({ forward: [owed(100)] }),
    });

    await result;

    expect(read).toHaveBeenCalledTimes(1);
    expect(canAfford).toHaveBeenCalledWith(LANE, COST, expect.any(Number));
    expect(isCoolingDown).toHaveBeenCalledWith('acc-1', NOW);
  });

  it("reads no window while the exchange's own cooldown test says the account is cooling down", async () => {
    const { read, result } = runOver({
      plan: planOf({ forward: [owed(100)] }),
      isCoolingDown: () => true,
    });

    await expect(result).resolves.toEqual({ imported: 0, complete: false });
    expect(read).not.toHaveBeenCalled();
  });

  it('reads no window the lane cannot afford', async () => {
    const { read, result } = runOver({
      plan: planOf({ forward: [owed(100)] }),
      canAfford: () => false,
    });

    await expect(result).resolves.toEqual({ imported: 0, complete: false });
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ['reads on past a failure its own test names', true, 2],
    ['stops at a failure its own test does not name', false, 1],
  ])('%s', async (_title, unreadable, windowsRead) => {
    const failure = new OwedWindowError('unreadable');
    const { read, result } = runOver({
      plan: planOf({ pending: [owed(100), owed(200)] }),
      isUnreadableWindowError: (error) => unreadable && error instanceof OwedWindowError,
      read: jest.fn(async () => {
        throw failure;
      }),
    });

    await expect(result).rejects.toBe(failure);
    expect(read).toHaveBeenCalledTimes(windowsRead);
  });

  describe('the commit of a span', () => {
    it.each<[string, Partial<WalkPlan>, WalkPass]>([
      ['forward', { forward: [owed(100)] }, 'forward'],
      ['pending', { pending: [owed(100)] }, 'pending'],
      ['rescan', { rescan: [owed(100)] }, 'rescan'],
      ['points', { points: [owed(100)] }, 'pending'],
    ])('commits the %s window with its span, its page and its pass', async (_name, plan, pass) => {
      const { commit, result } = runOver({
        plan: planOf(plan),
        read: jest.fn(async () => PAGE),
      });

      await expect(result).resolves.toEqual({ imported: 3, complete: true });
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith(owed(100), { start: 100, end: 110 }, 'page-1', pass);
    });

    it('hands the read the window it was given and the span to read', async () => {
      const read = jest.fn(async () => PAGE);

      await runOver({ plan: planOf({ forward: [owed(100)] }), read }).result;

      expect(read).toHaveBeenCalledWith(owed(100), { start: 100, end: 110 }, 0);
    });

    it('stops the walk when the commit stops', async () => {
      const { commit, result } = runOver({
        plan: planOf({ forward: [owed(100), owed(200)] }),
        read: jest.fn(async () => PAGE),
        commit: jest.fn(async () => undefined),
      });

      await expect(result).resolves.toEqual({ imported: 0, complete: false });
      expect(commit).toHaveBeenCalledTimes(1);
    });
  });

  describe('the owed points a window read', () => {
    const POINT: OwedGround = { start: 102, end: 103, kind: 'point', since: 50 };
    const readPoint: SpanCommit = { ...COMMITTED, returned: [POINT] };

    it('takes a point off the list once its window was read to its end', async () => {
      const { write, marks, result } = runOver({
        plan: planOf({ pending: [owed(100)] }),
        marks: marksOf({ pending: [POINT] }),
        read: jest.fn(async () => PAGE),
        commit: jest.fn(async () => readPoint),
      });

      await result;

      expect(write).toHaveBeenCalledWith([{ field: 'pending', value: [] }]);
      expect(marks.pending).toEqual([]);
    });

    it('leaves the list to the forward pass, which reads no owed ground', async () => {
      const { write, marks, result } = runOver({
        plan: planOf({ forward: [owed(100)] }),
        marks: marksOf({ pending: [POINT] }),
        read: jest.fn(async () => PAGE),
        commit: jest.fn(async () => readPoint),
      });

      await result;

      expect(write).not.toHaveBeenCalledWith([{ field: 'pending', value: [] }]);
      expect(marks.pending).toEqual([POINT]);
    });
  });

  describe('the round-robin marks', () => {
    it('stores the point cursor once the read of a point has started', async () => {
      const { write, result } = runOver({
        plan: planOf({ points: [owed(100)] }),
        read: jest.fn(async () => PAGE),
      });

      await result;

      expect(write).toHaveBeenCalledWith([{ field: 'pointCursor', value: 100 }]);
    });

    it('stores the range cursor at the end of a window owed for every coin', async () => {
      const { write, result } = runOver({
        plan: planOf({ pending: [owed(100)] }),
        read: jest.fn(async () => PAGE),
      });

      await result;

      expect(write).toHaveBeenCalledWith([{ field: 'rangeCursor', value: 110 }]);
    });

    it('stores the backfill cursor at the end of a window owed to the backfill', async () => {
      const { write, result } = runOver({
        plan: planOf({ pending: [{ ...owed(100), scope: 'backfill' }] }),
        read: jest.fn(async () => PAGE),
      });

      await result;

      expect(write).toHaveBeenCalledWith([{ field: 'backfillCursor', value: 110 }]);
      expect(write).not.toHaveBeenCalledWith([{ field: 'rangeCursor', value: 110 }]);
    });

    it('gives the turn to the backfill when a budget of one window left its window owed', async () => {
      const { write, result } = runOver({
        plan: planOf({ pending: [owed(100), { ...owed(200), scope: 'backfill' }] }),
        canAfford: (_lane, _cost, keep = 0) => keep === 0,
        read: jest.fn(async () => PAGE),
        commit: jest.fn(async () => ({ ...COMMITTED, owed: true })),
      });

      await result;

      expect(write).toHaveBeenCalledWith([{ field: 'backfillTurn', value: true }]);
    });

    it('drops a stored hint that no window of the plan holds', async () => {
      const { write, result } = runOver({
        plan: planOf({ forward: [owed(100)] }),
        marks: marksOf({ hints: { ...NO_HINTS, point: [{ start: 5, end: 6 }] } }),
      });

      await result;

      expect(write).toHaveBeenCalledWith([{ field: 'spanHints', value: NO_HINTS }]);
    });

    it('starts a window with the stored hint that holds its start', async () => {
      const read = jest.fn(async () => undefined);

      await runOver({
        plan: planOf({ forward: [owed(100)] }),
        marks: marksOf({ hints: { ...NO_HINTS, forward: [{ start: 100, end: 105 }] } }),
        read,
      }).result;

      expect(read).toHaveBeenCalledWith(owed(100), { start: 100, end: 105 }, 0);
    });
  });

  describe('the calls a read of a window costs', () => {
    it('enters a window only when every call of it fits beside the calls kept', async () => {
      const { read, canAfford, result } = runOver({
        plan: planOf({ forward: [owed(100)] }),
        callsOf: () => 3,
        canAfford: (_lane, _cost, keep = 0) => keep < 2,
      });

      await expect(result).resolves.toEqual({ imported: 0, complete: false });
      expect(canAfford).toHaveBeenCalledWith(LANE, COST, 2);
      expect(read).not.toHaveBeenCalled();
    });

    it('counts one call for a window read when the walk names no cost', async () => {
      const { read, canAfford, result } = runOver({
        plan: planOf({ forward: [owed(100)] }),
        canAfford: (_lane, _cost, keep = 0) => keep < 2,
      });

      await result;

      expect(canAfford).toHaveBeenCalledWith(LANE, COST, 0);
      expect(read).toHaveBeenCalledTimes(1);
    });
  });

  describe('the order of the passes', () => {
    const startsRead = (read: jest.Mock): number[] =>
      read.mock.calls.map(([window]: [OwedWindow]) => window.start);

    it.each([
      ['reads the forward window before the owed ones by default', undefined, [100, 200]],
      ['reads the forward window before the owed ones when owedFirst is false', false, [100, 200]],
      ['reads the owed windows before the forward window when owedFirst is true', true, [200, 100]],
    ])('%s', async (_title, owedFirst, starts) => {
      const read = jest.fn(async () => undefined);

      await runOver({
        plan: planOf({ forward: [owed(100)], pending: [owed(200)] }),
        owedFirst,
        read,
      }).result;

      expect(startsRead(read)).toEqual(starts);
    });
  });

  describe('the outcome hook', () => {
    const halved = () =>
      jest
        .fn()
        .mockResolvedValueOnce({ kind: 'split', half: { start: 100, end: 105 } })
        .mockResolvedValue(undefined);

    it('hands each window outcome to the hook before the plan keeps it, and leaves it as it is with none', async () => {
      const outcomeOf = jest.fn((_pass, _window, outcome: WindowOutcome) => ({
        ...outcome,
        hint: { start: 100, end: 102 },
      }));
      const hooked = runOver({
        plan: planOf({ forward: [owed(100)] }),
        read: halved(),
        outcomeOf,
      });
      const plain = runOver({ plan: planOf({ forward: [owed(100)] }), read: halved() });

      await hooked.result;
      await plain.result;

      expect(outcomeOf).toHaveBeenCalledWith(
        'forward',
        owed(100),
        expect.objectContaining({ hint: { start: 100, end: 105 } }),
      );
      expect(hooked.write).toHaveBeenCalledWith([
        { field: 'spanHints', value: { ...NO_HINTS, forward: [{ start: 100, end: 102 }] } },
      ]);
      expect(plain.write).toHaveBeenCalledWith([
        { field: 'spanHints', value: { ...NO_HINTS, forward: [{ start: 100, end: 105 }] } },
      ]);
    });
  });

  describe('a forward window that cannot be read', () => {
    it.each([
      ['reads the owed ground behind it when the walk says so', true, 2],
      ['throws at it otherwise', undefined, 1],
    ])('%s', async (_title, readOnPastUnreadableForward, windowsRead) => {
      const failure = new OwedWindowError('unreadable');
      const { read, result } = runOver({
        plan: planOf({ forward: [owed(100)], pending: [owed(200)] }),
        isUnreadableWindowError: (error) => error instanceof OwedWindowError,
        readOnPastUnreadableForward,
        read: jest.fn(async () => {
          throw failure;
        }),
      });

      await expect(result).rejects.toBe(failure);
      expect(read).toHaveBeenCalledTimes(windowsRead);
    });
  });
});
