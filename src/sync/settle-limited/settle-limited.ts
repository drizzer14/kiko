/**
 * Cap on how many account syncs run CONCURRENTLY during one fan-out. The
 * multi-connection fan-out (`useAutoSync` on app open, `useSyncAll` on
 * pull-to-refresh) can now drive N connected accounts at once; firing every
 * provider request simultaneously would spike device load and risk provider
 * rate limits on a user with many connections. A small pool of 3 keeps a
 * background sync gentle while still overlapping the slow, 60s-gated Monobank
 * runs with the light crypto balance fetches. (User decision — multi-account
 * plan, Phase 3.)
 */
export const SYNC_CONCURRENCY_LIMIT = 3;

const settleOne = <T>(task: () => Promise<T>): Promise<PromiseSettledResult<T>> => {
  return task().then(
    (value): PromiseSettledResult<T> => ({ status: 'fulfilled', value }),
    (reason): PromiseSettledResult<T> => ({ status: 'rejected', reason }),
  );
};

/**
 * `Promise.allSettled` with a bounded worker pool: run the tasks with at most
 * `limit` in flight at once, and return every result in the ORIGINAL task order
 * so a caller can align `results[index]` to its own `jobs[index]` (as
 * `useSyncAll` does to name the failed accounts). Tasks are FACTORIES
 * (`() => Promise<T>`), not started promises, so the pool starts them lazily —
 * a task beyond the cap does not begin until a worker frees up. Like
 * `Promise.allSettled`, a rejected task never rejects the batch; its rejection
 * is captured as a `rejected` result.
 */
export const settleAllLimited = async <T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<PromiseSettledResult<T>[]> => {
  const results: PromiseSettledResult<T>[] = [];
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await settleOne(tasks[index]);
    }
  };

  const workerCount = Math.min(Math.max(limit, 1), tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
};
