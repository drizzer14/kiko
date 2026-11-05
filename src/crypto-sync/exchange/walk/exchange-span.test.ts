import {
  NO_HINTS,
  type OwedGround,
  type OwedWindow,
  type WalkMarks,
  type WalkPass,
  type WalkPlan,
} from './walk';
import { commitExchangeSpan } from './exchange-span';

const SPAN = { start: 1_000, end: 2_000 };

const plan: WalkPlan = {
  forward: [SPAN],
  pending: [],
  points: [],
  rescan: [],
  rescanEnd: 0,
  pendingRanges: [],
  ranAt: 5_000,
};

const marks: WalkMarks = {
  cursor: null,
  rescanCursor: null,
  pointCursor: null,
  rangeCursor: null,
  hints: NO_HINTS,
  pending: [],
};

describe('commitExchangeSpan', () => {
  it('places the settled rows as given, adds what it placed, then moves the marks', async () => {
    const order: string[] = [];
    const place = jest.fn(async (planned: string[]) => planned.map((row) => `placed:${row}`));
    const addTransactions = jest.fn(async (rows: string[]) => {
      order.push('add');

      return rows.length;
    });
    const write = jest.fn(async () => {
      order.push('marks');
    });

    const committed = await commitExchangeSpan({
      context: {
        deps: { addTransactions, patchExchangeState: jest.fn() },
        accountId: 'acc-1',
        marks,
        plan,
        write,
      },
      pass: 'forward',
      span: SPAN,
      settled: { rows: ['one', 'two'], codes: [], owed: [], returned: [] },
      place,
      restartMs: 0,
    });

    expect(place).toHaveBeenCalledWith(['one', 'two']);
    expect(addTransactions).toHaveBeenCalledWith(['placed:one', 'placed:two']);
    expect(order).toEqual(['add', 'marks']);
    expect(committed).toMatchObject({ imported: 2, owed: false });
  });

  it('writes the coins a span met through the account state before its marks', async () => {
    const patchExchangeState = jest.fn(async () => undefined);
    const write = jest.fn(async () => undefined);

    await commitExchangeSpan({
      context: {
        deps: { addTransactions: jest.fn(async () => 0), patchExchangeState },
        accountId: 'acc-1',
        marks,
        plan,
        write,
      },
      pass: 'forward',
      span: SPAN,
      settled: { rows: [], codes: [], owed: [], returned: [], untracked: ['ABC'] },
      place: async () => [],
      restartMs: 0,
    });

    expect(patchExchangeState).toHaveBeenCalledWith('acc-1', [
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['ABC'] },
    ]);
    expect(patchExchangeState.mock.invocationCallOrder[0]).toBeLessThan(
      write.mock.invocationCallOrder[0],
    );
  });

  describe('what a span hands the commit and its marks', () => {
    const POINT: OwedGround = { start: 1_500, end: 1_501, kind: 'point' };

    // The walk moves these marks as it writes them, so each commit gets its own.
    const commitWith = (input: {
      pass: WalkPass;
      settled: Partial<Parameters<typeof commitExchangeSpan>[0]['settled']>;
      pending?: OwedGround[];
      series?: OwedWindow['series'];
      scope?: OwedWindow['scope'];
      forwardOwes?: readonly string[];
    }) => {
      const patchExchangeState = jest.fn(async () => undefined);
      const write = jest.fn(async () => undefined);
      const committed = commitExchangeSpan({
        context: {
          deps: { addTransactions: jest.fn(async () => 0), patchExchangeState },
          accountId: 'acc-1',
          marks: { ...marks, pending: input.pending ?? [] },
          plan,
          write,
        },
        pass: input.pass,
        span: SPAN,
        settled: { rows: [], codes: [], owed: [], returned: [], ...input.settled },
        place: async () => [],
        restartMs: 0,
        series: input.series,
        scope: input.scope,
        forwardOwes: input.forwardOwes,
      });

      return { committed, patchExchangeState, write };
    };

    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warn.mockRestore();
    });

    it('takes off the list only the ground of the series the window was read in', async () => {
      const { write, committed } = commitWith({
        pass: 'pending',
        pending: [
          { start: 1_000, end: 2_000, series: 'deposit' },
          { start: 1_000, end: 2_000, series: 'withdraw' },
        ],
        series: ['deposit'],
        settled: {},
      });

      await committed;

      expect(write).toHaveBeenCalledWith([
        { field: 'pending', value: [{ start: 1_000, end: 2_000, series: 'withdraw' }] },
      ]);
    });

    it('takes off the list the ground of every series when the window was read in none', async () => {
      const { write, committed } = commitWith({
        pass: 'pending',
        pending: [
          { start: 1_000, end: 2_000, series: 'deposit' },
          { start: 1_000, end: 2_000, series: 'withdraw' },
        ],
        settled: {},
      });

      await committed;

      expect(write).toHaveBeenCalledWith([{ field: 'pending', value: [] }]);
    });

    it('leaves on the list the ground owed for every coin when the window was read for the backfill', async () => {
      const { write, committed } = commitWith({
        pass: 'pending',
        pending: [
          { start: 1_000, end: 2_000 },
          { start: 1_000, end: 2_000, scope: 'backfill' },
        ],
        scope: 'backfill',
        settled: {},
      });

      await committed;

      expect(write).toHaveBeenCalledWith([
        { field: 'pending', value: [{ start: 1_000, end: 2_000 }] },
      ]);
    });

    it('owes what the window left again to the scope it was read in', async () => {
      const { write, committed } = commitWith({
        pass: 'pending',
        scope: 'backfill',
        settled: { owed: [POINT] },
      });

      await committed;

      expect(write).toHaveBeenCalledWith([
        { field: 'pending', value: [{ ...POINT, scope: 'backfill', since: plan.ranAt }] },
      ]);
    });

    it.each([
      ['goes past a record whose code the forward pass owes', ['amount-precision'], true],
      ['leaves the span uncommitted for a code the forward pass does not owe', [], false],
    ])('%s', async (_title, forwardOwes, goesPast) => {
      const { write, committed } = commitWith({
        pass: 'forward',
        settled: { codes: ['amount-precision'], owed: [POINT] },
        forwardOwes,
      });

      await expect(committed).resolves.toEqual(
        goesPast ? expect.objectContaining({ owed: true }) : undefined,
      );
      expect(write).toHaveBeenCalledTimes(goesPast ? 1 : 0);
    });

    it('lists the oversized coins of a span, before its marks move', async () => {
      const { patchExchangeState, write, committed } = commitWith({
        pass: 'forward',
        settled: { oversized: ['BIG'] },
      });

      await committed;

      expect(patchExchangeState).toHaveBeenCalledWith('acc-1', [
        { kind: 'coinList', coins: 'oversizedCoins', list: 'history', tickers: ['BIG'] },
      ]);
      expect(patchExchangeState.mock.invocationCallOrder[0]).toBeLessThan(
        write.mock.invocationCallOrder[0],
      );
    });

    it('lists the oversized coins of a span that stops the forward pass', async () => {
      const { patchExchangeState, write, committed } = commitWith({
        pass: 'forward',
        settled: { oversized: ['BIG'], codes: ['amount-too-large'] },
      });

      await expect(committed).resolves.toBeUndefined();

      expect(patchExchangeState).toHaveBeenCalledWith('acc-1', [
        { kind: 'coinList', coins: 'oversizedCoins', list: 'history', tickers: ['BIG'] },
      ]);
      expect(write).not.toHaveBeenCalled();
    });

    it('lists the not-imported entries of a span, before its marks move', async () => {
      const { patchExchangeState, write, committed } = commitWith({
        pass: 'forward',
        settled: { notImported: ['entry-1'] },
      });

      await committed;

      expect(patchExchangeState).toHaveBeenCalledWith('acc-1', [
        { kind: 'notImported', entries: ['entry-1'] },
      ]);
      expect(patchExchangeState.mock.invocationCallOrder[0]).toBeLessThan(
        write.mock.invocationCallOrder[0],
      );
    });
  });
});
