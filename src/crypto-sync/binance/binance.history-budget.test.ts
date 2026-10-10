import {
  type BinanceRunBudget,
  type BudgetLane,
  BINANCE_REQUEST_INTERVAL_MS,
  COSTS,
  createBinanceHistoryRun,
  createBinanceRunBudget,
  IP_BUDGET_1M,
  LANE_CALL_CAPS,
  UID_WEIGHT_BUDGET_1M,
} from './binance.history-budget';

const NO_READING = { usedUidWeight1m: undefined, usedIpWeight1m: undefined };

const spendCalls = (budget: BinanceRunBudget, lane: BudgetLane, count: number): void => {
  for (let call = 0; call < count; call += 1) {
    budget.record(lane, NO_READING);
  }
};

describe('LANE_CALL_CAPS', () => {
  it('holds the per-run call cap of each lane', () => {
    expect(LANE_CALL_CAPS).toEqual({
      capitalWithdraw: 9,
      capitalDeposit: Infinity,
      pay: 20,
      transfer: 60,
      earn: 30,
    });
  });
});

describe('createBinanceRunBudget — per-lane call caps', () => {
  it('allows the 9th withdraw call and refuses the 10th', () => {
    const budget = createBinanceRunBudget();

    spendCalls(budget, 'capitalWithdraw', 8);
    expect(budget.canAfford('capitalWithdraw', COSTS.withdraw)).toBe(true);

    spendCalls(budget, 'capitalWithdraw', 1);
    expect(budget.canAfford('capitalWithdraw', COSTS.withdraw)).toBe(false);
  });

  it('never caps the deposit lane by count', () => {
    const budget = createBinanceRunBudget();

    spendCalls(budget, 'capitalDeposit', 5_000);

    expect(budget.canAfford('capitalDeposit', COSTS.deposit)).toBe(true);
  });

  it.each([
    ['pay', COSTS.pay, 20],
    ['transfer', COSTS.transfer, 60],
    ['earn', COSTS.earn, 30],
  ] as const)('caps the %s lane at %i calls', (lane, cost, cap) => {
    const budget = createBinanceRunBudget();

    spendCalls(budget, lane, cap - 1);
    expect(budget.canAfford(lane, cost)).toBe(true);

    spendCalls(budget, lane, 1);
    expect(budget.canAfford(lane, cost)).toBe(false);
  });

  it('leaves another lane affordable when one lane spent its cap', () => {
    const budget = createBinanceRunBudget();

    spendCalls(budget, 'capitalWithdraw', 9);

    expect(budget.canAfford('capitalWithdraw', COSTS.withdraw)).toBe(false);
    expect(budget.canAfford('pay', COSTS.pay)).toBe(true);
    expect(budget.canAfford('capitalDeposit', COSTS.deposit)).toBe(true);
  });
});

describe('createBinanceRunBudget — weight readings', () => {
  it('holds the Binance ceilings and per-call costs of the old withdraw rule', () => {
    expect(UID_WEIGHT_BUDGET_1M).toBe(180_000);
    expect(IP_BUDGET_1M).toBe(6_000);
    expect(COSTS).toEqual({
      withdraw: { uid: 18_000 },
      deposit: { ip: 1 },
      pay: { uid: 3_000 },
      account: { ip: 20 },
      transfer: { ip: 1 },
      earn: { ip: 150 },
    });
  });

  it('affords a UID call that lands exactly on the ceiling, not one weight over', () => {
    const atCeiling = createBinanceRunBudget();
    atCeiling.record('capitalWithdraw', { ...NO_READING, usedUidWeight1m: 162_000 });
    const overCeiling = createBinanceRunBudget();
    overCeiling.record('capitalWithdraw', { ...NO_READING, usedUidWeight1m: 162_001 });

    expect(atCeiling.canAfford('capitalWithdraw', COSTS.withdraw)).toBe(true);
    expect(overCeiling.canAfford('capitalWithdraw', COSTS.withdraw)).toBe(false);
  });

  it('affords an IP call that lands exactly on the budget, not one weight over', () => {
    const atBudget = createBinanceRunBudget();
    atBudget.record('earn', { ...NO_READING, usedIpWeight1m: 5_850 });
    const overBudget = createBinanceRunBudget();
    overBudget.record('earn', { ...NO_READING, usedIpWeight1m: 5_851 });

    expect(atBudget.canAfford('earn', COSTS.earn)).toBe(true);
    expect(overBudget.canAfford('earn', COSTS.earn)).toBe(false);
  });

  it('judges a cost of one kind only against the reading of that kind', () => {
    const budget = createBinanceRunBudget();
    budget.record('pay', { usedUidWeight1m: 179_999, usedIpWeight1m: 1 });

    expect(budget.canAfford('capitalDeposit', COSTS.deposit)).toBe(true);
    expect(budget.canAfford('pay', COSTS.pay)).toBe(false);

    const ipBudget = createBinanceRunBudget();
    ipBudget.record('pay', { usedUidWeight1m: 1, usedIpWeight1m: 6_000 });

    expect(ipBudget.canAfford('capitalDeposit', COSTS.deposit)).toBe(false);
    expect(ipBudget.canAfford('capitalWithdraw', COSTS.withdraw)).toBe(true);
  });

  it('applies only the call caps when no response ever carried a header', () => {
    const budget = createBinanceRunBudget();

    spendCalls(budget, 'pay', 19);

    expect(budget.canAfford('pay', COSTS.pay)).toBe(true);
    expect(budget.canAfford('earn', COSTS.earn)).toBe(true);
  });

  it('keeps the last reading when a later response carries none', () => {
    const budget = createBinanceRunBudget();
    budget.record('capitalWithdraw', { ...NO_READING, usedUidWeight1m: 170_000 });
    budget.record('capitalWithdraw', NO_READING);

    expect(budget.canAfford('capitalWithdraw', COSTS.withdraw)).toBe(false);
  });

  it('replaces a reading with the newest defined one, lower or higher', () => {
    const budget = createBinanceRunBudget();
    budget.record('capitalWithdraw', { ...NO_READING, usedUidWeight1m: 170_000 });
    budget.record('capitalWithdraw', { ...NO_READING, usedUidWeight1m: 1_000 });

    expect(budget.canAfford('capitalWithdraw', COSTS.withdraw)).toBe(true);
  });

  it('counts a response without any header as a call on its lane', () => {
    const budget = createBinanceRunBudget();

    spendCalls(budget, 'capitalWithdraw', 9);

    expect(budget.canAfford('capitalWithdraw', COSTS.withdraw)).toBe(false);
  });
});

describe('createBinanceHistoryRun', () => {
  it('builds a gate paced at the Binance request interval and a fresh budget', async () => {
    const sleep = jest.fn(async (_milliseconds: number) => undefined);
    const run = createBinanceHistoryRun({ now: () => 1_000, sleep });

    await run.gate.wait();
    await run.gate.wait();

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(BINANCE_REQUEST_INTERVAL_MS);
    expect(run.budget.canAfford('pay', COSTS.pay)).toBe(true);
  });

  it('gives every run its own budget', () => {
    const clock = { now: () => 1_000, sleep: async () => undefined };
    const first = createBinanceHistoryRun(clock);
    const second = createBinanceHistoryRun(clock);

    spendCalls(first.budget, 'pay', 20);

    expect(first.budget.canAfford('pay', COSTS.pay)).toBe(false);
    expect(second.budget.canAfford('pay', COSTS.pay)).toBe(true);
  });
});
