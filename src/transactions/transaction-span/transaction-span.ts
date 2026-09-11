/**
 * The earliest and latest of a list of epoch-ms times, in ONE O(n) pass with no
 * argument spread.
 *
 * `Math.min(...times)` / `Math.max(...times)` spread the whole array onto the
 * call stack: that is a second and third pass AND it throws a RangeError
 * ("Maximum call stack size exceeded") once the array is large enough — a
 * long-lived account's full transaction history reaches that size, so the Home
 * screen's date-range span was both slow and crash-prone on every reactive
 * re-render during a sync. This single loop reads each element once and never
 * spreads. An empty list has no span, so both bounds fall back to `fallback`.
 */
export const transactionSpan = (
  times: readonly number[],
  fallback: number,
): { start: number; end: number } => {
  if (times.length === 0) {
    return { start: fallback, end: fallback };
  }

  let start = times[0];
  let end = times[0];

  for (let index = 1; index < times.length; index += 1) {
    const time = times[index];
    if (time < start) {
      start = time;
    }
    if (time > end) {
      end = time;
    }
  }

  return { start, end };
};
