/**
 * A single-slot request gate: `wait()` resolves immediately the first time and
 * thereafter only once `intervalMs` has elapsed since the previous resolution.
 *
 * WHY THIS EXISTS: Monobank's personal API allows at most one request per 60
 * seconds PER TOKEN, not per call site. A local `isFirstRequest` flag scoped
 * to one `fetchAllStatements` invocation would let a second card's first
 * statement request fire with zero delay — a 429 that would propagate out of
 * `runSync`, leave `setLastSyncAt` unwritten, and stop every card after the
 * first from importing at all. One gate, created once per
 * `runSync` and threaded through EVERY request in that invocation (including
 * `fetchClientInfo`), is the only shape that respects a per-token limit.
 *
 * `now` and `sleep` are injected so tests run instantly against a fake clock.
 */
export type RequestGate = { wait: () => Promise<void> };

export const createRequestGate = (input: {
  intervalMs: number;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}): RequestGate => {
  let lastRequestAt: number | null = null;

  return {
    wait: async (): Promise<void> => {
      if (lastRequestAt !== null) {
        const remaining = input.intervalMs - (input.now() - lastRequestAt);

        if (remaining > 0) {
          await input.sleep(remaining);
        }
      }

      lastRequestAt = input.now();
    },
  };
};
