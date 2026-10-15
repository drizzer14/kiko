import {
  type BinanceRunBudget,
  type BudgetLane,
  BINANCE_REQUEST_INTERVAL_MS,
  COSTS,
  createBinanceHistoryRun,
  createBinanceRunBudget,
  IP_BUDGET_1M,
  LANE_CALL_CAPS,
  LANE_NARROWING_CALLS,
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
      transfer: 80,
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
    ['transfer', COSTS.transfer, 80],
    ['earn', COSTS.earn, 30],
  ] as const)('caps the %s lane at %i calls', (lane, cost, cap) => {
    const budget = createBinanceRunBudget();

    spendCalls(budget, lane, cap - 1);
    expect(budget.canAfford(lane, cost)).toBe(true);

    spendCalls(budget, lane, 1);
    expect(budget.canAfford(lane, cost)).toBe(false);
  });

  // The withdraw history reports a per-second UID weight only, so the walk never
  // sees a per-minute reading for it; the cap alone must keep a run under the ceiling.
  it('keeps the withdraw lane under the UID minute ceiling with no weight reading at all', () => {
    const budget = createBinanceRunBudget();
    let calls = 0;

    while (budget.canAfford('capitalWithdraw', COSTS.withdraw)) {
      spendCalls(budget, 'capitalWithdraw', 1);
      calls += 1;
    }

    expect(calls * COSTS.withdraw.uid).toBeLessThanOrEqual(UID_WEIGHT_BUDGET_1M);
  });

  it('leaves another lane affordable when one lane spent its cap', () => {
    const budget = createBinanceRunBudget();

    spendCalls(budget, 'capitalWithdraw', 9);

    expect(budget.canAfford('capitalWithdraw', COSTS.withdraw)).toBe(false);
    expect(budget.canAfford('pay', COSTS.pay)).toBe(true);
    expect(budget.canAfford('capitalDeposit', COSTS.deposit)).toBe(true);
  });
});

describe('createBinanceRunBudget — calls kept for later', () => {
  it('refuses a call that would leave fewer than the calls to keep under the lane cap', () => {
    const budget = createBinanceRunBudget();

    spendCalls(budget, 'capitalWithdraw', 6);

    expect(budget.canAfford('capitalWithdraw', COSTS.withdraw, 2)).toBe(true);

    spendCalls(budget, 'capitalWithdraw', 1);

    expect(budget.canAfford('capitalWithdraw', COSTS.withdraw, 2)).toBe(false);
    expect(budget.canAfford('capitalWithdraw', COSTS.withdraw, 1)).toBe(true);
    expect(budget.canAfford('capitalWithdraw', COSTS.withdraw)).toBe(true);
  });

  it('counts the calls to keep in the weight of a UID call too', () => {
    const budget = createBinanceRunBudget();
    budget.record('pay', { ...NO_READING, usedUidWeight1m: 171_001 });

    expect(budget.canAfford('pay', COSTS.pay, 2)).toBe(false);
    expect(budget.canAfford('pay', COSTS.pay, 1)).toBe(true);
  });

  it('counts the calls to keep in the weight of an IP call too', () => {
    const budget = createBinanceRunBudget();
    budget.record('earn', { ...NO_READING, usedIpWeight1m: 5_701 });

    expect(budget.canAfford('earn', COSTS.earn, 1)).toBe(false);
    expect(budget.canAfford('earn', COSTS.earn, 0)).toBe(true);
  });
});

describe('createBinanceRunBudget — narrowing calls', () => {
  const NARROWING_CALLS = LANE_NARROWING_CALLS.transfer;

  it('holds the narrowing calls of each lane: only the Transfer lane has any', () => {
    expect(LANE_NARROWING_CALLS).toEqual({
      capitalWithdraw: 0,
      capitalDeposit: 0,
      pay: 0,
      transfer: 397,
      earn: 0,
    });
  });

  it('refuses a call that is not narrowing at the cap, however many narrowing calls are left', () => {
    const budget = createBinanceRunBudget();

    spendCalls(budget, 'transfer', 80);

    expect(budget.canAfford('transfer', COSTS.transfer)).toBe(false);
    expect(budget.canAfford('transfer', COSTS.transfer, 0, false)).toBe(false);
  });

  it('charges a narrowing call to the narrowing calls, so the lane cap stays whole', () => {
    const budget = createBinanceRunBudget();

    for (let call = 0; call < NARROWING_CALLS; call += 1) {
      expect(budget.canAfford('transfer', COSTS.transfer, 0, true)).toBe(true);
      budget.record('transfer', NO_READING, true);
    }

    expect(budget.canAfford('transfer', COSTS.transfer, 79)).toBe(true);
    spendCalls(budget, 'transfer', 79);
    expect(budget.canAfford('transfer', COSTS.transfer)).toBe(true);
    spendCalls(budget, 'transfer', 1);
    expect(budget.canAfford('transfer', COSTS.transfer)).toBe(false);
  });

  it('spends the lane cap once the narrowing calls are spent, and refuses at the cap beyond them', () => {
    const budget = createBinanceRunBudget();

    for (let call = 0; call < NARROWING_CALLS + 80; call += 1) {
      expect(budget.canAfford('transfer', COSTS.transfer, 0, true)).toBe(true);
      budget.record('transfer', NO_READING, true);
    }

    expect(budget.canAfford('transfer', COSTS.transfer, 0, true)).toBe(false);
  });

  it('does not keep calls out of the narrowing calls, and keeps them out of the lane cap after', () => {
    const budget = createBinanceRunBudget();

    for (let call = 0; call < NARROWING_CALLS - 1; call += 1) {
      budget.record('transfer', NO_READING, true);
    }

    expect(budget.canAfford('transfer', COSTS.transfer, 79, true)).toBe(true);

    budget.record('transfer', NO_READING, true);
    spendCalls(budget, 'transfer', 20);

    expect(budget.canAfford('transfer', COSTS.transfer, 59, true)).toBe(true);
    expect(budget.canAfford('transfer', COSTS.transfer, 60, true)).toBe(false);
  });

  it('judges a narrowing call by the weight reading as any other call', () => {
    const budget = createBinanceRunBudget();
    budget.record('transfer', { ...NO_READING, usedIpWeight1m: IP_BUDGET_1M }, true);

    expect(budget.canAfford('transfer', COSTS.transfer, 0, true)).toBe(false);
  });

  it('counts the calls to keep in the weight of a narrowing call', () => {
    const budget = createBinanceRunBudget();
    budget.record('transfer', { ...NO_READING, usedIpWeight1m: IP_BUDGET_1M - 2 }, true);

    expect(budget.canAfford('transfer', COSTS.transfer, 1, true)).toBe(true);
    expect(budget.canAfford('transfer', COSTS.transfer, 2, true)).toBe(false);
  });

  it.each([
    ['capitalWithdraw', COSTS.withdraw],
    ['pay', COSTS.pay],
    ['earn', COSTS.earn],
  ] as const)(
    'gives the %s lane no narrowing calls: a narrowing call is held to its cap',
    (lane, cost) => {
      const budget = createBinanceRunBudget();

      spendCalls(budget, lane, LANE_CALL_CAPS[lane]);

      expect(budget.canAfford(lane, cost, 0, true)).toBe(false);
    },
  );

  it('keeps the narrowing calls of one run out of another', () => {
    const first = createBinanceRunBudget();
    const second = createBinanceRunBudget();

    for (let call = 0; call < NARROWING_CALLS + 80; call += 1) {
      first.record('transfer', NO_READING, true);
    }

    expect(first.canAfford('transfer', COSTS.transfer, 0, true)).toBe(false);
    expect(second.canAfford('transfer', COSTS.transfer, 0, true)).toBe(true);
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
