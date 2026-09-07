import { createRequestGate } from './throttle';

describe('createRequestGate', () => {
  const makeClock = (start: number) => {
    let current = start;

    return {
      now: () => current,
      sleep: jest.fn(async (milliseconds: number) => {
        current += milliseconds;
      }),
      advance: (milliseconds: number) => {
        current += milliseconds;
      },
    };
  };

  it('does not sleep before the first request', async () => {
    const clock = makeClock(0);
    const gate = createRequestGate({ intervalMs: 60_000, now: clock.now, sleep: clock.sleep });

    await gate.wait();

    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it('sleeps the full interval between two back-to-back requests', async () => {
    const clock = makeClock(0);
    const gate = createRequestGate({ intervalMs: 60_000, now: clock.now, sleep: clock.sleep });

    await gate.wait();
    await gate.wait();

    expect(clock.sleep).toHaveBeenCalledTimes(1);
    expect(clock.sleep).toHaveBeenCalledWith(60_000);
  });

  it('sleeps only the remainder when time has already passed', async () => {
    const clock = makeClock(0);
    const gate = createRequestGate({ intervalMs: 60_000, now: clock.now, sleep: clock.sleep });

    await gate.wait();
    clock.advance(45_000);
    await gate.wait();

    expect(clock.sleep).toHaveBeenCalledWith(15_000);
  });

  it('does not sleep when the interval has fully elapsed', async () => {
    const clock = makeClock(0);
    const gate = createRequestGate({ intervalMs: 60_000, now: clock.now, sleep: clock.sleep });

    await gate.wait();
    clock.advance(60_001);
    await gate.wait();

    expect(clock.sleep).not.toHaveBeenCalled();
  });
});
