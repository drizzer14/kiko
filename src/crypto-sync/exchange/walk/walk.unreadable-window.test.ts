import {
  runWalkPlan,
  type WalkPass,
  type WalkPlan,
  type WalkWindow,
  type WindowOutcome,
} from './walk';

/** An exchange-neutral stand-in for the one failure a window of owed ground can end with. */
class UnreadableWindowError extends Error {
  constructor(public readonly label: string) {
    super('unreadable window');
    this.name = 'UnreadableWindowError';
    Object.setPrototypeOf(this, UnreadableWindowError.prototype);
  }
}

/** A failure that stops the run: a rate limit, an auth failure, a clock skew or the network. */
class StopError extends Error {
  constructor(public readonly kind: string) {
    super(kind);
    this.name = 'StopError';
    Object.setPrototypeOf(this, StopError.prototype);
  }
}

const isUnreadableWindowError = (error: unknown): boolean => error instanceof UnreadableWindowError;

const window = (start: number): WalkWindow => ({ start, end: start + 1 });
const owedWindow = (start: number): WalkWindow => ({ start, end: start + 10 });

const plan: WalkPlan = {
  forward: [window(0)],
  pending: [owedWindow(5), owedWindow(20), owedWindow(40)],
  points: [{ start: 500, end: 502 }],
  rescan: [window(10)],
  rescanEnd: 11,
  pendingRanges: [],
};

const planWithTwoPoints: WalkPlan = {
  ...plan,
  points: [
    { start: 500, end: 502 },
    { start: 600, end: 602 },
  ],
};

const read = (imported: number): WindowOutcome => ({
  imported,
  complete: true,
  owed: false,
  started: true,
});

type Call = [number, WalkPass];

/**
 * Runs the plan over a window reader and records what was asked: every window in order, and the
 * ranges and points the round-robins were moved past.
 */
const runPlanOver = (input: {
  runWindow: (window: WalkWindow, pass: WalkPass) => Promise<WindowOutcome>;
  plan?: WalkPlan;
  canAfford?: () => boolean;
  predicate?: (error: unknown) => boolean;
}) => {
  const calls: Call[] = [];
  const marked = { ranges: [] as number[], points: [] as number[] };
  const result = runWalkPlan({
    plan: input.plan ?? plan,
    canAfford: input.canAfford ?? (() => true),
    isUnreadableWindowError: input.predicate,
    runWindow: async (owed, pass) => {
      calls.push([owed.start, pass]);

      return input.runWindow(owed, pass);
    },
    markRangeRead: async (owed) => {
      marked.ranges.push(owed.start);
    },
    markPointRead: async (owed) => {
      marked.points.push(owed.start);
    },
  });

  return { result, calls, marked };
};

/** A reader that throws `failure` for the windows of `starts` in `pass`, and reads the rest. */
const failingAt =
  (pass: WalkPass, failures: Map<number, Error>) =>
  async (owed: WalkWindow, ran: WalkPass): Promise<WindowOutcome> => {
    const failure = ran === pass ? failures.get(owed.start) : undefined;

    if (failure !== undefined) {
      throw failure;
    }

    return read(1);
  };

describe('runWalkPlan, with a window that cannot be read', () => {
  it('goes on to the next owed window, the re-scan and the points past an unreadable owed range', async () => {
    const first = new UnreadableWindowError('first');
    const second = new UnreadableWindowError('second');
    const { result, calls, marked } = runPlanOver({
      runWindow: failingAt(
        'pending',
        new Map<number, Error>([
          [5, first],
          [40, second],
        ]),
      ),
      predicate: isUnreadableWindowError,
    });

    await expect(result).rejects.toBe(first);
    expect(calls).toEqual([
      [0, 'forward'],
      [5, 'pending'],
      [20, 'pending'],
      [40, 'pending'],
      [10, 'rescan'],
      [500, 'pending'],
    ]);
    expect(marked).toEqual({ ranges: [5, 20, 40], points: [500] });
  });

  it.each([
    [
      'goes on to the next owed point past an unreadable one',
      new UnreadableWindowError('point'),
      7,
    ],
    ['stops at the failure of a point with no further call: a 429', new StopError('429'), 6],
  ])('%s', async (_label, failure, windowsRead) => {
    const { result, calls } = runPlanOver({
      plan: planWithTwoPoints,
      runWindow: failingAt('pending', new Map<number, Error>([[500, failure]])),
      predicate: isUnreadableWindowError,
    });

    await expect(result).rejects.toBe(failure);
    expect(calls.map(([start]) => start)).toEqual(
      [0, 5, 20, 40, 10, 500, 600].slice(0, windowsRead),
    );
  });

  it.each(['forward', 'rescan'] as const)(
    'stops the run at an unreadable window of the %s pass, as before',
    async (pass) => {
      const failure = new UnreadableWindowError(pass);
      const { result, calls } = runPlanOver({
        runWindow: failingAt(
          pass,
          new Map<number, Error>([[pass === 'forward' ? 0 : 10, failure]]),
        ),
        predicate: isUnreadableWindowError,
      });

      await expect(result).rejects.toBe(failure);
      expect(calls.at(-1)).toEqual([pass === 'forward' ? 0 : 10, pass]);
      expect(calls.map(([, ran]) => ran)).not.toContain('point');
    },
  );

  it('still lets the budget end the owed windows past an unreadable one', async () => {
    let calls = 2;
    const { result, calls: asked } = runPlanOver({
      plan: { ...plan, forward: [] },
      canAfford: () => {
        calls -= 1;

        return calls >= 0;
      },
      runWindow: async () => {
        throw new UnreadableWindowError('pending');
      },
      predicate: isUnreadableWindowError,
    });

    await expect(result).rejects.toBeInstanceOf(UnreadableWindowError);
    expect(asked).toEqual([
      [5, 'pending'],
      [20, 'pending'],
    ]);
  });

  describe('a failure that is not an unreadable window', () => {
    it.each([
      ['a 429 rate limit', new StopError('429')],
      ['a 418 ban', new StopError('418')],
      ['an auth failure', new StopError('auth')],
      ['a clock skew (-1021)', new StopError('-1021')],
      ['a network failure', new StopError('network')],
    ])('stops the run at once with no further call: %s', async (_label, failure) => {
      const { result, calls } = runPlanOver({
        runWindow: failingAt('pending', new Map<number, Error>([[5, failure]])),
        predicate: isUnreadableWindowError,
      });

      await expect(result).rejects.toBe(failure);
      expect(calls).toEqual([
        [0, 'forward'],
        [5, 'pending'],
      ]);
    });

    it('stops the run at an unreadable window as well when no test is given', async () => {
      const failure = new UnreadableWindowError('pending');
      const { result, calls } = runPlanOver({
        runWindow: failingAt('pending', new Map<number, Error>([[5, failure]])),
      });

      await expect(result).rejects.toBe(failure);
      expect(calls).toEqual([
        [0, 'forward'],
        [5, 'pending'],
      ]);
    });
  });
});
