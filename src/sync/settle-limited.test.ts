import { SYNC_CONCURRENCY_LIMIT, settleAllLimited } from './settle-limited';

const deferred = <T>(value: T, delayMs: number): (() => Promise<T>) => {
  return () => new Promise((resolve) => setTimeout(() => resolve(value), delayMs));
};

describe('settleAllLimited', () => {
  it('returns an empty array for no tasks', async () => {
    expect(await settleAllLimited([], SYNC_CONCURRENCY_LIMIT)).toEqual([]);
  });

  it('returns results in the ORIGINAL task order regardless of settle order', async () => {
    // Task 0 settles LAST, task 1 first — the result array must still be [1, 2, 3].
    const results = await settleAllLimited(
      [deferred(1, 30), deferred(2, 5), deferred(3, 15)],
      SYNC_CONCURRENCY_LIMIT,
    );

    const values = results.map((result) => (result.status === 'fulfilled' ? result.value : null));

    expect(values).toEqual([1, 2, 3]);
  });

  it('captures a rejected task without failing the whole batch', async () => {
    const boom = new Error('boom');
    const results = await settleAllLimited(
      [() => Promise.resolve('ok'), () => Promise.reject(boom)],
      SYNC_CONCURRENCY_LIMIT,
    );

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'ok' });
    expect(results[1]).toEqual({ status: 'rejected', reason: boom });
  });

  it('never runs more than `limit` tasks at once', async () => {
    let active = 0;
    let maxActive = 0;
    const track = (): (() => Promise<void>) => {
      return async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);

        await new Promise((resolve) => setTimeout(resolve, 10));

        active -= 1;
      };
    };

    await settleAllLimited([track(), track(), track(), track(), track()], 2);

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('starts tasks LAZILY so an unstarted task never runs beyond the cap', async () => {
    const started: number[] = [];
    const make = (index: number): (() => Promise<void>) => {
      return async () => {
        started.push(index);

        await new Promise((resolve) => setTimeout(resolve, 10));
      };
    };

    const run = settleAllLimited([make(0), make(1), make(2), make(3)], 2);
    // Synchronously after the call only the first `limit` tasks have begun.
    expect(started).toEqual([0, 1]);

    await run;

    expect(started).toEqual([0, 1, 2, 3]);
  });
});
