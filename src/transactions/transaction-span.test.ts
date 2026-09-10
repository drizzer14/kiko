import { transactionSpan } from './transaction-span';

describe('transactionSpan', () => {
  it('returns the fallback for both bounds when the list is empty', () => {
    expect(transactionSpan([], 1_700_000_000_000)).toEqual({
      start: 1_700_000_000_000,
      end: 1_700_000_000_000,
    });
  });

  it('finds the earliest and latest time regardless of order', () => {
    // Both the min (5) and the max (45) sit in the interior, not at index 0.
    expect(transactionSpan([30, 10, 45, 5, 25], 0)).toEqual({ start: 5, end: 45 });
  });

  it('handles a single element', () => {
    expect(transactionSpan([42], 0)).toEqual({ start: 42, end: 42 });
  });

  // The reason this helper exists: Math.min(...times)/Math.max(...times) throw a
  // RangeError on a large enough array, so the Home span computation crashed on a
  // long history. This helper must handle a large array without spreading.
  it('handles a very large array that a spread call would overflow the stack on', () => {
    const size = 500_000;
    const times = new Array<number>(size);
    for (let index = 0; index < size; index += 1) {
      // A deterministic non-monotonic fill so the min and max are interior, not
      // the endpoints: values wrap so the smallest and largest sit mid-array.
      times[index] = ((index * 7919) % size) - 123;
    }

    // Guard the premise: the spread form the helper replaces DOES overflow here.
    expect(() => Math.min(...times)).toThrow(RangeError);

    const span = transactionSpan(times, 0);

    expect(span.start).toBe(-123);
    expect(span.end).toBe(size - 1 - 123);
  });
});
