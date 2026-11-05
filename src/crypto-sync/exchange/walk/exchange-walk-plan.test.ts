import { runExchangeWalkPlan } from './exchange-walk-plan';
import { NO_HINTS, type OwedWindow, type WalkMarks, type WalkPlan } from './walk';

type Lane = 'only';
type Cost = { weight: number };

class OwedWindowError extends Error {}

const LANE: Lane = 'only';
const COST: Cost = { weight: 1 };
const NOW = 7_000;

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

const marks: WalkMarks = {
  cursor: null,
  rescanCursor: null,
  pointCursor: null,
  rangeCursor: null,
  hints: NO_HINTS,
  pending: [],
};

const runOver = (input: {
  plan: WalkPlan;
  canAfford?: (lane: Lane, cost: Cost, keep?: number) => boolean;
  isCoolingDown?: (accountId: string, now: number) => boolean;
  isUnreadableWindowError?: (error: unknown) => boolean;
  read?: jest.Mock;
}) => {
  const read = input.read ?? jest.fn(async () => undefined);
  const canAfford = jest.fn(input.canAfford ?? (() => true));
  const isCoolingDown = jest.fn(input.isCoolingDown ?? (() => false));

  return {
    read,
    canAfford,
    isCoolingDown,
    result: runExchangeWalkPlan({
      context: {
        deps: { now: () => NOW },
        run: { budget: { canAfford } },
        accountId: 'acc-1',
        marks,
        plan: input.plan,
        write: jest.fn(async () => undefined),
      },
      lane: LANE,
      cost: COST,
      isCoolingDown,
      isUnreadableWindowError: input.isUnreadableWindowError ?? (() => false),
      read,
      commit: jest.fn(async () => undefined),
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
});
