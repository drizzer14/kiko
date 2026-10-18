import { createExchangeRun, type RunBudget } from './budget';

type SampleLane = 'balance' | 'history';

type SampleBudget = RunBudget<SampleLane, { weight: number }, { used: number | undefined }>;

const sampleBudget = (): SampleBudget => ({ canAfford: () => true, record: () => undefined });

describe('createExchangeRun', () => {
  it('paces the gate at the interval it is given', async () => {
    const sleep = jest.fn(async (_milliseconds: number) => undefined);
    const run = createExchangeRun({
      intervalMs: 250,
      clock: { now: () => 1_000, sleep },
      budget: sampleBudget(),
    });

    await run.gate.wait();
    await run.gate.wait();

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it('shares the budget it is given with every walk of the run', () => {
    const budget = sampleBudget();
    const run = createExchangeRun({
      intervalMs: 250,
      clock: { now: () => 1_000, sleep: async () => undefined },
      budget,
    });

    expect(run.budget).toBe(budget);
  });

  it('gives each run its own gate, so one run never delays the first request of another', async () => {
    const sleep = jest.fn(async (_milliseconds: number) => undefined);
    const clock = { now: () => 1_000, sleep };
    const first = createExchangeRun({ intervalMs: 250, clock, budget: sampleBudget() });
    const second = createExchangeRun({ intervalMs: 250, clock, budget: sampleBudget() });

    await first.gate.wait();
    await second.gate.wait();

    expect(sleep).not.toHaveBeenCalled();
  });
});
