import {
  type BybitLane,
  type BybitRunBudget,
  BYBIT_LANE_CALL_CAPS,
  BYBIT_REQUEST_INTERVAL_MS,
  createBybitHistoryRun,
  createBybitRunBudget,
  NO_WEIGHTS,
  recordBybitFailedCall,
} from './bybit.history-budget';

const LANES: readonly BybitLane[] = ['capital', 'transfer', 'log', 'convert', 'fundingLedger'];

const spendCalls = (budget: BybitRunBudget, lane: BybitLane, count: number): void => {
  for (let call = 0; call < count; call += 1) {
    budget.record(lane, NO_WEIGHTS);
  }
};

describe('the Bybit gate interval and lane caps', () => {
  it('holds the interval at 1100 ms, which keeps the slowest route (60 a minute) in its limit', () => {
    expect(BYBIT_REQUEST_INTERVAL_MS).toBe(1_100);
    expect(Math.ceil(60_000 / BYBIT_REQUEST_INTERVAL_MS)).toBeLessThanOrEqual(55);
  });

  it('holds the per-run call cap of the five lanes: log 20 windows, convert 10 pages, Funding ledger 20', () => {
    expect(BYBIT_LANE_CALL_CAPS).toEqual({
      capital: 30,
      transfer: 20,
      log: 20,
      convert: 10,
      fundingLedger: 20,
    });
  });
});

describe('createBybitRunBudget', () => {
  it.each([
    { lane: 'capital', cap: 30 },
    { lane: 'transfer', cap: 20 },
    { lane: 'log', cap: 20 },
    { lane: 'convert', cap: 10 },
    { lane: 'fundingLedger', cap: 20 },
  ] as const)('allows call $cap of the $lane lane and refuses the next', ({ lane, cap }) => {
    const budget = createBybitRunBudget();

    spendCalls(budget, lane, cap - 1);
    expect(budget.canAfford(lane, NO_WEIGHTS)).toBe(true);

    spendCalls(budget, lane, 1);
    expect(budget.canAfford(lane, NO_WEIGHTS)).toBe(false);
  });

  it('leaves the other lane whole when one lane spent its cap', () => {
    const budget = createBybitRunBudget();

    spendCalls(budget, 'capital', 30);

    expect(budget.canAfford('capital', NO_WEIGHTS)).toBe(false);
    expect(budget.canAfford('transfer', NO_WEIGHTS)).toBe(true);
  });

  it.each(LANES)('leaves every other lane whole when the %s lane spent its cap', (spent) => {
    const budget = createBybitRunBudget();

    spendCalls(budget, spent, BYBIT_LANE_CALL_CAPS[spent]);

    LANES.filter((lane) => lane !== spent).forEach((lane) => {
      expect(budget.canAfford(lane, NO_WEIGHTS)).toBe(true);
    });
  });

  it('refuses a call that would leave fewer than the calls to keep under the lane cap', () => {
    const budget = createBybitRunBudget();

    spendCalls(budget, 'transfer', 17);

    expect(budget.canAfford('transfer', NO_WEIGHTS, 2)).toBe(true);

    spendCalls(budget, 'transfer', 1);

    expect(budget.canAfford('transfer', NO_WEIGHTS, 2)).toBe(false);
    expect(budget.canAfford('transfer', NO_WEIGHTS, 1)).toBe(true);
    expect(budget.canAfford('transfer', NO_WEIGHTS)).toBe(true);
  });

  it.each(LANES)('gives the %s lane no narrowing call past its cap', (lane) => {
    const budget = createBybitRunBudget();

    spendCalls(budget, lane, BYBIT_LANE_CALL_CAPS[lane]);

    expect(budget.canAfford(lane, NO_WEIGHTS, 0, true)).toBe(false);
  });

  it('counts a call recorded as narrowing against the lane cap, as no lane has narrowing calls', () => {
    const budget = createBybitRunBudget();

    for (let call = 0; call < 20; call += 1) {
      budget.record('transfer', NO_WEIGHTS, true);
    }

    expect(budget.canAfford('transfer', NO_WEIGHTS)).toBe(false);
  });

  it('judges a call by its lane cap alone, whatever the headers of earlier responses said', () => {
    const budget = createBybitRunBudget();

    spendCalls(budget, 'capital', 29);

    expect(budget.canAfford('capital', NO_WEIGHTS)).toBe(true);
  });

  it('keeps the counts of one run out of another', () => {
    const first = createBybitRunBudget();
    const second = createBybitRunBudget();

    spendCalls(first, 'capital', 30);

    expect(first.canAfford('capital', NO_WEIGHTS)).toBe(false);
    expect(second.canAfford('capital', NO_WEIGHTS)).toBe(true);
  });
});

describe('createBybitHistoryRun', () => {
  it('builds a gate paced at the Bybit request interval and a fresh budget', async () => {
    const sleep = jest.fn(async (_milliseconds: number) => undefined);
    const run = createBybitHistoryRun({ now: () => 1_000, sleep });

    await run.gate.wait();
    await run.gate.wait();

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1_100);
    expect(run.budget.canAfford('capital', NO_WEIGHTS)).toBe(true);
  });

  it('gives every run its own budget', () => {
    const clock = { now: () => 1_000, sleep: async () => undefined };
    const first = createBybitHistoryRun(clock);
    const second = createBybitHistoryRun(clock);

    spendCalls(first.budget, 'transfer', 20);

    expect(first.budget.canAfford('transfer', NO_WEIGHTS)).toBe(false);
    expect(second.budget.canAfford('transfer', NO_WEIGHTS)).toBe(true);
  });
});

describe('recordBybitFailedCall', () => {
  it('counts a refused request as a call of its lane, so the cap holds when requests fail', () => {
    const run = createBybitHistoryRun({ now: () => 1_000, sleep: async () => undefined });

    for (let call = 0; call < 19; call += 1) {
      recordBybitFailedCall(run, 'transfer');
    }

    expect(run.budget.canAfford('transfer', NO_WEIGHTS)).toBe(true);

    recordBybitFailedCall(run, 'transfer');

    expect(run.budget.canAfford('transfer', NO_WEIGHTS)).toBe(false);
    expect(run.budget.canAfford('capital', NO_WEIGHTS)).toBe(true);
  });
});
