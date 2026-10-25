import {
  type BinanceRunBudget,
  type BudgetLane,
  API_IP_BUDGET_1M,
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
      convert: 20,
      dust: 1,
      p2p: 20,
      fiatOrders: 3,
      fiatPayments: 10,
      market: 150,
      tradeSymbols: 1,
      trades: 100,
    });
  });

  it('keeps the trade lane and the symbol list under the /api/* budget when both spend their caps', () => {
    expect(
      LANE_CALL_CAPS.trades * COSTS.myTrades.api +
        LANE_CALL_CAPS.tradeSymbols * COSTS.exchangeInfo.api,
    ).toBeLessThanOrEqual(API_IP_BUDGET_1M);
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
    { lane: 'pay', cost: COSTS.pay, cap: 20 },
    { lane: 'transfer', cost: COSTS.transfer, cap: 80 },
    { lane: 'earn', cost: COSTS.earn, cap: 30 },
    { lane: 'convert', cost: COSTS.convert, cap: 20 },
    { lane: 'p2p', cost: COSTS.p2p, cap: 20 },
    { lane: 'fiatOrders', cost: COSTS.fiatOrders, cap: 3 },
    { lane: 'fiatPayments', cost: COSTS.fiatPayments, cap: 10 },
  ] as const)('caps the $lane lane at $cap calls', ({ lane, cost, cap }) => {
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

  it('gives the Convert lane no narrowing call past its cap, and 20 calls fit the UID ceiling', () => {
    const budget = createBinanceRunBudget();

    spendCalls(budget, 'convert', 20);

    expect(budget.canAfford('convert', COSTS.convert, 0, true)).toBe(false);
    expect(LANE_CALL_CAPS.convert * COSTS.convert.uid).toBeLessThanOrEqual(UID_WEIGHT_BUDGET_1M);
  });

  it('allows one dust call and refuses the second', () => {
    const budget = createBinanceRunBudget();

    expect(budget.canAfford('dust', COSTS.dust)).toBe(true);

    spendCalls(budget, 'dust', 1);

    expect(budget.canAfford('dust', COSTS.dust)).toBe(false);
    expect(budget.canAfford('dust', COSTS.dust, 0, true)).toBe(false);
  });

  it('judges a dust call by the SAPI IP reading', () => {
    const refused = createBinanceRunBudget();
    const allowed = createBinanceRunBudget();
    refused.record('pay', { ...NO_READING, usedIpWeight1m: 6_000 });
    allowed.record('pay', { ...NO_READING, usedIpWeight1m: 5_999 });

    expect(refused.canAfford('dust', COSTS.dust)).toBe(false);
    expect(allowed.canAfford('dust', COSTS.dust)).toBe(true);
  });

  it('allows one symbol-list call and refuses the second', () => {
    const budget = createBinanceRunBudget();

    expect(budget.canAfford('tradeSymbols', COSTS.exchangeInfo)).toBe(true);

    spendCalls(budget, 'tradeSymbols', 1);

    expect(budget.canAfford('tradeSymbols', COSTS.exchangeInfo)).toBe(false);
    expect(budget.canAfford('tradeSymbols', COSTS.exchangeInfo, 0, true)).toBe(false);
  });

  it('judges a symbol-list call by the /api/* reading', () => {
    const refused = createBinanceRunBudget();
    const allowed = createBinanceRunBudget();
    refused.record('market', { ...NO_READING, usedApiWeight1m: 2_981 });
    allowed.record('market', { ...NO_READING, usedApiWeight1m: 2_980 });

    expect(refused.canAfford('tradeSymbols', COSTS.exchangeInfo)).toBe(false);
    expect(allowed.canAfford('tradeSymbols', COSTS.exchangeInfo)).toBe(true);
  });

  it('allows 100 trade calls and refuses the 101st', () => {
    const budget = createBinanceRunBudget();

    spendCalls(budget, 'trades', 99);
    expect(budget.canAfford('trades', COSTS.myTrades)).toBe(true);

    spendCalls(budget, 'trades', 1);
    expect(budget.canAfford('trades', COSTS.myTrades)).toBe(false);
    expect(budget.canAfford('trades', COSTS.myTrades, 0, true)).toBe(false);
  });

  it('judges an order re-read by its own weight, with the calls to keep counted in it', () => {
    const budget = createBinanceRunBudget();
    budget.record('market', { ...NO_READING, usedApiWeight1m: 2_970 });

    expect(budget.canAfford('trades', COSTS.orderFills, 5)).toBe(true);
    expect(budget.canAfford('trades', COSTS.orderFills, 6)).toBe(false);
    expect(budget.canAfford('trades', COSTS.myTrades, 1)).toBe(false);
  });

  it('counts the calls to keep in the weight of an IP call too', () => {
    const budget = createBinanceRunBudget();
    budget.record('earn', { ...NO_READING, usedIpWeight1m: 5_701 });

    expect(budget.canAfford('earn', COSTS.earn, 1)).toBe(false);
    expect(budget.canAfford('earn', COSTS.earn, 0)).toBe(true);
  });
});

describe('createBinanceRunBudget — P2P and fiat lanes', () => {
  it('keeps each new UID lane at its cap within the minute budget', () => {
    expect(LANE_CALL_CAPS.p2p * COSTS.p2p.uid).toBeLessThanOrEqual(UID_WEIGHT_BUDGET_1M);
    expect(LANE_CALL_CAPS.fiatOrders * COSTS.fiatOrders.uid).toBeLessThanOrEqual(
      UID_WEIGHT_BUDGET_1M,
    );
    expect(LANE_CALL_CAPS.fiatPayments * COSTS.fiatPayments.ip).toBeLessThanOrEqual(IP_BUDGET_1M);
  });

  it('keeps the P2P and fiat order lanes, which share one UID minute, within it when both spend their caps', () => {
    expect(
      LANE_CALL_CAPS.p2p * COSTS.p2p.uid + LANE_CALL_CAPS.fiatOrders * COSTS.fiatOrders.uid,
    ).toBeLessThanOrEqual(UID_WEIGHT_BUDGET_1M);
  });

  it('refuses a fourth fiat order call in a run, though the weight alone would allow it', () => {
    const budget = createBinanceRunBudget();

    spendCalls(budget, 'fiatOrders', 3);

    expect(budget.canAfford('fiatOrders', COSTS.fiatOrders)).toBe(false);
    expect(budget.canAfford('convert', COSTS.fiatOrders)).toBe(true);
  });

  it('refuses the first fiat order call above a reading of 135000 and allows it at 135000', () => {
    const allowed = createBinanceRunBudget();
    const refused = createBinanceRunBudget();
    allowed.record('pay', { ...NO_READING, usedUidWeight1m: 135_000 });
    refused.record('pay', { ...NO_READING, usedUidWeight1m: 135_001 });

    expect(allowed.canAfford('fiatOrders', COSTS.fiatOrders)).toBe(true);
    expect(refused.canAfford('fiatOrders', COSTS.fiatOrders)).toBe(false);
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
      convert: 0,
      dust: 0,
      p2p: 0,
      fiatOrders: 0,
      fiatPayments: 0,
      market: 0,
      tradeSymbols: 0,
      trades: 0,
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
      convert: { uid: 3_000 },
      dust: { ip: 1 },
      p2p: { uid: 900 },
      fiatOrders: { uid: 45_000 },
      fiatPayments: { ip: 1 },
      klines: { api: 2 },
      exchangeInfo: { api: 20 },
      myTrades: { api: 20 },
      orderFills: { api: 5 },
    });
  });

  it('holds the /api/* IP budget at half of the 6000 a minute that endpoints share', () => {
    expect(API_IP_BUDGET_1M).toBe(3_000);
  });

  it('affords an /api/* call that lands exactly on its budget, not one weight over', () => {
    const atBudget = createBinanceRunBudget();
    atBudget.record('market', { ...NO_READING, usedApiWeight1m: 2_998 });
    const overBudget = createBinanceRunBudget();
    overBudget.record('market', { ...NO_READING, usedApiWeight1m: 2_999 });

    expect(atBudget.canAfford('market', COSTS.klines)).toBe(true);
    expect(overBudget.canAfford('market', COSTS.klines)).toBe(false);
  });

  it('counts the calls to keep in the weight of an /api/* call too', () => {
    const budget = createBinanceRunBudget();
    budget.record('market', { ...NO_READING, usedApiWeight1m: 2_996 });

    expect(budget.canAfford('market', COSTS.klines, 1)).toBe(true);
    expect(budget.canAfford('market', COSTS.klines, 2)).toBe(false);
  });

  it('judges an /api/* call by its own reading, never by the SAPI IP or UID reading', () => {
    const budget = createBinanceRunBudget();
    budget.record('market', { usedUidWeight1m: 179_999, usedIpWeight1m: 6_000 });

    expect(budget.canAfford('market', COSTS.klines)).toBe(true);
  });

  it('keeps the SAPI IP calls out of the /api/* reading', () => {
    const budget = createBinanceRunBudget();
    budget.record('market', { ...NO_READING, usedApiWeight1m: 3_000 });

    expect(budget.canAfford('capitalDeposit', COSTS.deposit)).toBe(true);
    expect(budget.canAfford('pay', COSTS.pay)).toBe(true);
  });

  it('keeps the last /api/* reading when a later response carries none', () => {
    const budget = createBinanceRunBudget();
    budget.record('market', { ...NO_READING, usedApiWeight1m: 2_999 });
    budget.record('market', NO_READING);

    expect(budget.canAfford('market', COSTS.klines)).toBe(false);
  });

  it('caps the market lane at 150 calls', () => {
    const budget = createBinanceRunBudget();

    spendCalls(budget, 'market', 149);
    expect(budget.canAfford('market', COSTS.klines)).toBe(true);

    spendCalls(budget, 'market', 1);
    expect(budget.canAfford('market', COSTS.klines)).toBe(false);
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
