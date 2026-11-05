import { commitExchangeSpan } from './exchange-span';
import { NO_HINTS, type WalkMarks, type WalkPlan } from './walk';

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
});
